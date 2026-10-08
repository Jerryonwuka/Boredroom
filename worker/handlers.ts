import { withWorker } from "../src/server/db";
import { audit, enqueueJob } from "../src/server/services/common";
import { localTimeOn } from "../src/server/lib/time";

export type JobContext = { jobId: string; attempt: number };
export type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

/**
 * Brenda's end-of-day team report for one recipient (services/daily-report.ts). The sent log makes a re-run a no-op;
 * a report that is off, out of date or no longer theirs is skipped.
 */
const brendaDailyReport: Handler = async (payload) => {
  const { runDailyReportJob } = await import("../src/server/services/daily-report");
  const { organisationId, membershipId, localDate } = payload as { organisationId: string; membershipId: string; localDate: string };
  await runDailyReportJob({ organisationId, membershipId, localDate });
};

// ---- Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4) ----------------------
// The fast path (gather, decide, answer) runs in the web process right after the Confirm; the worker owns what must
// happen even when nobody is looking: deadlines (no reply in time: answered from the person's work), anything stuck, and
// the workspace's collection before the end-of-day report. Every job stays short (the loop runs one job at a time) and
// none calls the model: the worker's answers are the template's. Each returns at once before migration 0039.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Rows one followup.process job handles: each is a few short transactions. */
export const FOLLOW_UP_PROCESS_CHUNK = 10;

/** Deadlines passed, rows stuck pending or half-answered, batches left open: at most 25 rows a run. */
const followUpSweep: Handler = async () => {
  const { sweepFollowUps } = await import("../src/server/services/follow-ups");
  const r = await sweepFollowUps({ limit: 25 });
  if (r.expired || r.retried || r.batchesClosed) console.log(`[worker] follow-ups: ${r.expired} past their deadline, ${r.retried} retried, ${r.batchesClosed} batch(es) closed`);
};

/**
 * The workspace's own collection of today's updates for one organisation, a set time before its report: inserts the
 * batch and its rows (deduplicated per organisation per day), then hands the rows to followup.process in chunks of 10.
 */
const followUpCollect: Handler = async (payload) => {
  const organisationId = String(payload.organisationId ?? "");
  const localDate = String(payload.localDate ?? "");
  if (!UUID.test(organisationId) || !LOCAL_DATE.test(localDate)) return;
  const { collectWorkspaceUpdates } = await import("../src/server/services/follow-ups");
  // The report time as it is now (Settings may have moved it since the job was queued), on the organisation's clock.
  const org = await withWorker((db) => db.maybeOne<{ timezone: string; report_time: string }>(
    `SELECT o.timezone, to_char(COALESCE(b.daily_report_time, '18:00'::time), 'HH24:MI') AS report_time
     FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = $1`, [organisationId]));
  if (!org) return;
  const reportAt = localTimeOn(localDate, org.report_time, org.timezone);
  const r = await collectWorkspaceUpdates({ organisationId, localDate, reportAt });
  if (!r.batchId || !r.pendingIds.length) return;
  const batchId = r.batchId;
  await withWorker(async (db) => {
    for (let i = 0; i * FOLLOW_UP_PROCESS_CHUNK < r.pendingIds.length; i++) {
      const ids = r.pendingIds.slice(i * FOLLOW_UP_PROCESS_CHUNK, (i + 1) * FOLLOW_UP_PROCESS_CHUNK);
      await enqueueJob(db, "followup.process", { ids }, { dedupKey: `followup.process:${batchId}:${i}` });
    }
  });
  console.log(`[worker] follow-ups: collecting today's updates for ${r.pendingIds.length} people (${organisationId})`);
};

/** Up to 10 follow-ups taken as far as they go now: answered from the facts, or the person asked once. Never the model. */
const followUpProcess: Handler = async (payload) => {
  const ids = Array.isArray(payload.ids) ? [...new Set((payload.ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, FOLLOW_UP_PROCESS_CHUNK) : [];
  if (!ids.length) return;
  const { processFollowUpIds } = await import("../src/server/services/follow-ups");
  await processFollowUpIds(ids, { useModel: false });
};

// ---- @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5) -------------------------------
// The fast path answers a mention in the web process right after the send (Next's after()); the worker owns what must
// happen even when nobody is looking: Confirms past their time, and mentions left pending or half-run (a restart, a model
// that did not answer). Unlike the follow-ups' jobs the worker may call the model here, bounded: one mention per job, at
// most 4 model steps. Each returns at once before migration 0041.

/**
 * Expired Confirms settled, then each stuck mention handed to its own mention.process job (at most 5 a run); and (phase
 * 6) the threads where someone else's assistant asked its owner brought up to date once the follow-up closed (at most 10).
 */
const mentionSweep: Handler = async () => {
  const { sweepMentions } = await import("../src/server/services/mention-processor");
  const r = await sweepMentions({ limit: 5 });
  if (r.settled || r.queued || r.synced) console.log(`[worker] mentions: ${r.settled} Confirm(s) expired, ${r.queued} queued again, ${r.synced} thread(s) brought up to date`);
};

/** One mention taken as far as it goes now; the next one waiting in the same conversation gets its own job. */
const mentionProcess: Handler = async (payload) => {
  const id = String(payload.id ?? "");
  if (!UUID.test(id)) return;
  const { processMentionJob } = await import("../src/server/services/mention-processor");
  await processMentionJob(id);
};

// ---- Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6) ------------------------
// Delivery, seen, replies, accepting and declining happen in the web process as the people do them; the worker owns
// what must happen even when nobody is looking: requests past their time expire (the sender is told), an accepted request
// a crash left half-done is closed as interrupted (never run again: no second to-do), and today's report notes settle
// once the report is written. No model. Returns at once before migration 0043 (the service checks), so an old worker
// that does not know the job only leaves it for this one (rearmFollowUpJobs).

/** Requests past their time, accepted requests left half-done, report notes past the report: at most 50 a run. */
const assistantItemSweep: Handler = async () => {
  const { sweepAssistantItems } = await import("../src/server/services/assistant-items");
  const r = await sweepAssistantItems({ limit: 50 });
  if (r.expired || r.interrupted || r.notesSettled) console.log(`[worker] assistant items: ${r.expired} expired, ${r.interrupted} interrupted, ${r.notesSettled} report note(s) settled`);
};

const retentionDelete: Handler = async (payload) => {
  const { deleteRecording } = await import("../src/server/services/recording");
  await deleteRecording(payload.recordingId as string, (payload.reason as "retention" | "incident" | "offboarding") ?? "retention");
};

const assembleRecording: Handler = async (payload) => {
  const { assembleRecording: assemble } = await import("../src/server/services/recording");
  await assemble(payload.recordingId as string);
};

const scanDeliverable: Handler = async (payload) => {
  const { scanDeliverable: scan } = await import("../src/server/services/evidence");
  await scan(payload.deliverableId as string);
};

const purgeExpired: Handler = async () => {
  await withWorker(async (db) => {
    await db.query(`DELETE FROM idempotency_keys WHERE expires_at < now()`);
    await db.query(`DELETE FROM auth_rate_limits WHERE window_start < now() - interval '1 day'`);
    await db.query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`);
    await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND expires_at < now()`);
    await audit(db, { organisationId: null, action: "worker.purge_expired", subjectType: "system" });
  });
};

import { controlCenterHandlers } from "./control-center";

export const handlers: Record<string, Handler> = {
  ...controlCenterHandlers,
  "brenda.daily_report": brendaDailyReport,
  "followup.sweep": followUpSweep,
  "followup.collect": followUpCollect,
  "followup.process": followUpProcess,
  "mention.sweep": mentionSweep,
  "mention.process": mentionProcess,
  "assistant_item.sweep": assistantItemSweep,
  "recording.retention_delete": retentionDelete,
  "recording.assemble": assembleRecording,
  "deliverable.scan": scanDeliverable,
  "system.purge_expired": purgeExpired,
};
