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
// that does not know the job only leaves it for this one (claimKilledJobs).

/** Requests past their time, accepted requests left half-done, report notes past the report: at most 50 a run. */
const assistantItemSweep: Handler = async () => {
  const { sweepAssistantItems } = await import("../src/server/services/assistant-items");
  const r = await sweepAssistantItems({ limit: 50 });
  if (r.expired || r.interrupted || r.notesSettled) console.log(`[worker] assistant items: ${r.expired} expired, ${r.interrupted} interrupted, ${r.notesSettled} report note(s) settled`);
};

// ---- Routines (owner decision, 8 October 2026: phase 7a) ----------------------------------------------------------------
// A person's own assistant on a schedule. One short job per run: claim it (once per routine and due time; stale, missed,
// gone, no rights or changed since the person enabled it are recorded as skipped), run the template as the person (no
// model; routine-templates.ts), finish it (deliver now, hold for quiet hours, or stay silent), then hand the follow-ups a
// chase made to followup.process as the workspace's collection does. Nothing is retried after the claim: a retry would
// find the run recorded and skip, so a run happens at most once. Each returns at once before migration 0046.

/** One routine run (`routineId`, `dueAt`). Never throws once the run is claimed. */
const routineRun: Handler = async (payload) => {
  const routineId = String(payload.routineId ?? "");
  const dueAt = String(payload.dueAt ?? "");
  if (!UUID.test(routineId) || Number.isNaN(Date.parse(dueAt))) return;
  const { claimRun, completeRun, failRun } = await import("../src/server/services/routines");
  const c = await claimRun({ routineId, dueAt, now: new Date() });
  if ("skip" in c) return;
  try {
    const { runTemplate } = await import("../src/server/services/routine-templates");
    let result: Awaited<ReturnType<typeof runTemplate>>;
    try { result = await runTemplate(c.ctx, c.routine, { mode: "run", runId: c.runId, now: new Date(), since: c.previousRunAt, timeZone: c.timeZone }); }
    catch (err) { await failRun(c.runId, "error", (err as Error)?.message ?? String(err)); return; }
    await completeRun(c.runId, result, { now: new Date() });
    // Follow-ups a chase asked are processed like the workspace's collection: in chunks of 10, no model.
    const ids = [...new Set(result.actions.filter((a) => a.done && a.followUpId && UUID.test(a.followUpId)).map((a) => a.followUpId as string))];
    if (ids.length) {
      await withWorker(async (db) => {
        for (let i = 0; i * FOLLOW_UP_PROCESS_CHUNK < ids.length; i++) {
          await enqueueJob(db, "followup.process", { ids: ids.slice(i * FOLLOW_UP_PROCESS_CHUNK, (i + 1) * FOLLOW_UP_PROCESS_CHUNK) }, { dedupKey: `followup.process:routine:${c.runId}:${i}` });
        }
      });
    }
  } catch (err) {
    // The run is recorded as failed (the person is told privately); the job itself never fails, so it is never re-run.
    console.error(`[worker] routine run ${c.runId}: ${(err as Error)?.message ?? String(err)}`);
    await failRun(c.runId, "error").catch(() => undefined);
  }
};

/** What was held for one person's quiet hours, delivered together now (or held again while they are still quiet). */
const routineRelease: Handler = async (payload) => {
  const membershipId = String(payload.membershipId ?? "");
  if (!UUID.test(membershipId)) return;
  const { releaseHeldRuns } = await import("../src/server/services/routines");
  const r = await releaseHeldRuns(membershipId, new Date());
  if (r.released) console.log(`[worker] routines: ${r.released} held run(s) delivered${r.bundled ? " together" : ""}`);
};

// ---- Loose ends and commitments (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed") ----------
// The workspace's assistant reads tracked group conversations for commitments every few minutes (one short job per
// organisation; it may call the model, bounded: 4 calls a run, 200 a day for the organisation, recorded as the
// workspace's own usage). The sweep moves what waits on nobody (expiries, open asks after their grace period, to-dos
// done, interrupted accepts), follows accepted commitments through (the due reminder, the stalled note, the optional
// thread follow-up) and settles "blocked on" questions that are no longer true. The loose-ends sweep asks the follow-ups
// people scheduled ("Follow up later"). Each returns at once before migration 0048.

/** Whether migration 0048 is applied (each job returns at once before it). */
async function loopsReady(): Promise<boolean> {
  const { schema0048Ready } = await import("../src/server/lib/schema-0048");
  return withWorker((db) => schema0048Ready(db)).catch(() => false);
}

/** One organisation's look at its tracked group conversations (`organisationId`). */
const commitmentsScan: Handler = async (payload) => {
  const organisationId = String(payload.organisationId ?? "");
  if (!UUID.test(organisationId) || !(await loopsReady())) return;
  const { scanWorkspaceCommitments } = await import("../src/server/services/commitment-detect");
  const r = await scanWorkspaceCommitments(organisationId);
  if (r.created || r.agreed) console.log(`[worker] commitments: ${r.created} noted, ${r.agreed} agreed in ${organisationId} (${r.read} read, ${r.candidates} looked at, ${r.engine})`);
};

/** Commitments moved on, followed through, and blocks settled: at most 50 of each a run. A failure in one leaves the others to run. */
const commitmentsSweep: Handler = async () => {
  if (!(await loopsReady())) return;
  const fail = (what: string) => (err: unknown) => { console.error(`[worker] ${what}: ${(err as Error)?.message ?? String(err)}`); return null; };
  const { sweepCommitments } = await import("../src/server/services/commitments");
  const a = await sweepCommitments({ limit: 50 }).catch(fail("sweeping commitments"));
  const { runCommitmentFollowThrough } = await import("../src/server/services/commitment-followthrough");
  const b = await runCommitmentFollowThrough({ limit: 50 }).catch(fail("following commitments through"));
  const { settleBlocks } = await import("../src/server/services/task-blocks");
  const c = await settleBlocks({ limit: 50 }).catch(fail("settling blocks"));
  const moved = (a ? a.expired + a.done + a.cancelled + a.interrupted + a.asksDelivered : 0) + (b ? b.reminded + b.stalledNoted + b.threadPosts : 0) + (c?.cleared ?? 0);
  if (moved) console.log(`[worker] commitments: ${JSON.stringify({ ...(a ?? {}), ...(b ?? {}), cleared: c?.cleared ?? 0 })}`);
};

/** "Follow up later" on a loose end, once its day comes: asked as the person, at most 25 a run. */
const looseEndsSweep: Handler = async () => {
  if (!(await loopsReady())) return;
  const { runDueLooseEndFollowUps } = await import("../src/server/services/loose-ends");
  const r = await runDueLooseEndFollowUps({ limit: 25 });
  if (r.asked || r.failed) console.log(`[worker] loose ends: ${r.asked} follow-up(s) asked, ${r.failed} could not be`);
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
  // Routines (phase 7a): what a routine reported is kept 30 days (each item once), then goes. No-op before 0046.
  const { pruneRoutineReportedItems, sweepInterruptedRuns } = await import("../src/server/services/routines");
  await pruneRoutineReportedItems().catch((err) => console.error("[worker] pruning routine keys", (err as Error).message));
  // A run a stopped worker left 'running' whose job never came back is recorded as failed (review, 8 October 2026).
  await sweepInterruptedRuns().catch((err) => console.error("[worker] sweeping interrupted routine runs", (err as Error).message));
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
  "routine.run": routineRun,
  "routine.release": routineRelease,
  "commitments.scan": commitmentsScan,
  "commitments.sweep": commitmentsSweep,
  "loose_ends.sweep": looseEndsSweep,
  "recording.retention_delete": retentionDelete,
  "recording.assemble": assembleRecording,
  "deliverable.scan": scanDeliverable,
  "system.purge_expired": purgeExpired,
};
