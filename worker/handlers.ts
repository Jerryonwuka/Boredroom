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

// ---- The async standup (owner decisions, 8–9 October 2026: phase 7c, option B) -------------------------------------------
// A team that switched standup on gets, on each of its days at its time (the organisation's clock), one draft per member
// written by that member's own assistant from their work (standup-compose.ts; the model allowed, one call per person),
// and at the cutoff the lead's one rollup. Posting is never here: it is always the person's own press. Every job is
// idempotent and re-derivable from the tables: a lost or killed job (the older worker on the same database kills types
// it does not know; claimKilledJobs brings them back) is finished by the sweep, which opens due days, drafts what is
// stale, sends due rollups, releases notices held for quiet hours and closes the day. Each returns at once before
// migration 0050.

/** Whether migration 0050 is applied (each standup job returns at once before it; a failed check says no). */
async function standupsReady(): Promise<boolean> {
  try {
    const { schema0050Ready } = await import("../src/server/lib/schema-0050");
    return await withWorker((db) => schema0050Ready(db));
  } catch { return false; }
}

/** A reason code for a draft that could not be written (at most 64 characters, never the error's words). */
const draftFailure = (err: unknown): string => {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && /^[0-9A-Z_]{1,40}$/i.test(code) ? `facts_${code}`.slice(0, 64) : "facts_unreadable";
};

/**
 * One claimed draft taken to the end: composed (the model when the person has it), saved (and announced, or held for
 * their quiet hours), or failed (tried again by the sweep up to 3 attempts). Never throws: no job retry after a claim.
 */
async function draftClaimed(claim: import("../src/server/services/standup").StandupClaim): Promise<void> {
  const svc = await import("../src/server/services/standup");
  try {
    const { composeStandup, standupModelFor } = await import("../src/server/services/standup-compose");
    let composed: Awaited<ReturnType<typeof composeStandup>>;
    try {
      const model = await standupModelFor(claim).catch(() => null);
      composed = await composeStandup(claim, { model });
    } catch (err) {
      console.error(`[worker] standup draft ${claim.entryId}: ${(err as Error)?.message ?? String(err)}`);
      await svc.failStandupDraft(claim.entryId, draftFailure(err), (err as Error)?.message);
      return;
    }
    await svc.saveStandupDraft(claim.entryId, composed, new Date());
  } catch (err) {
    console.error(`[worker] standup draft ${claim.entryId} not saved: ${(err as Error)?.message ?? String(err)}`);
    await svc.failStandupDraft(claim.entryId, "save_failed", (err as Error)?.message).catch(() => undefined);
  }
}

/** Claims and drafts one entry; true when it was drafted here (claimed), false when it was not this run's to do. */
async function draftEntry(entryId: string): Promise<boolean> {
  const { claimStandupDraft } = await import("../src/server/services/standup");
  const c = await claimStandupDraft(entryId, new Date());
  if ("skip" in c) return false;
  await draftClaimed(c);
  return true;
}

/** Composes and sends one rollup when it is due (rollupInput checks it is open and past its cutoff). */
async function sendRollupNow(rollupId: string): Promise<boolean> {
  const svc = await import("../src/server/services/standup");
  const input = await svc.rollupInput(rollupId, new Date());
  if ("skip" in input) return false;
  const { composeRollup } = await import("../src/server/services/standup-compose");
  const r = await svc.sendRollup(rollupId, composeRollup(input), new Date());
  console.log(`[worker] standup rollup ${rollupId}: ${r.notified} notified, ${r.held} held for quiet hours`);
  return true;
}

/** Each drafting entry of a day just opened gets its own draft job (deduplicated by entry and attempt). */
async function queueDrafts(entryIds: string[]): Promise<void> {
  const ids = [...new Set(entryIds.filter((x) => UUID.test(x)))];
  if (!ids.length) return;
  await withWorker(async (db) => {
    const rows = await db.query<{ id: string; attempts: number }>(`SELECT id, attempts FROM standup_entries WHERE id = ANY($1::uuid[]) AND status = 'drafting'`, [ids]);
    for (const r of rows) await enqueueJob(db, "standup.draft", { entryId: r.id }, { dedupKey: `standup.draft:${r.id}:${r.attempts}` });
  });
}

/**
 * `standup.open` (`teamId`, `localDate`): the team's day opened (its rollup row and one drafting entry per member), then a
 * draft job per entry and the rollup job at the cutoff. Idempotent: a second run finds the day open.
 */
const standupOpen: Handler = async (payload) => {
  const teamId = String(payload.teamId ?? "");
  const localDate = String(payload.localDate ?? "");
  if (!UUID.test(teamId) || !LOCAL_DATE.test(localDate) || !(await standupsReady())) return;
  const { openStandupDay } = await import("../src/server/services/standup");
  const r = await openStandupDay(teamId, localDate, new Date());
  if (r.status !== "opened" && r.status !== "exists") return;
  await queueDrafts(r.entryIds);
  const rollupId = r.rollupId;
  if (rollupId && UUID.test(rollupId)) {
    await withWorker(async (db) => {
      const row = await db.maybeOne<{ cutoff_at: string }>(`SELECT cutoff_at FROM standup_rollups WHERE id = $1 AND status = 'open'`, [rollupId]);
      if (row) await enqueueJob(db, "standup.rollup", { rollupId }, { dedupKey: `standup.rollup:${rollupId}`, runAt: new Date(row.cutoff_at) });
    });
  }
  if (r.entryIds.length) console.log(`[worker] standup: ${teamId} opened for ${localDate} (${r.entryIds.length} draft(s) queued)`);
};

/** `standup.draft` (`entryId`): claim, compose, save or fail. Never throws after the claim; the sweep owns retries. */
const standupDraft: Handler = async (payload) => {
  const entryId = String(payload.entryId ?? "");
  if (!UUID.test(entryId) || !(await standupsReady())) return;
  await draftEntry(entryId);
};

/** `standup.rollup` (`rollupId`): at the cutoff, the lead's one rollup composed and sent (held for quiet hours as needed). */
const standupRollup: Handler = async (payload) => {
  const rollupId = String(payload.rollupId ?? "");
  if (!UUID.test(rollupId) || !(await standupsReady())) return;
  await sendRollupNow(rollupId);
};

/**
 * `standup.sweep`: whatever a lost job left, bounded (standup.ts sweepStandups opens due days, releases held notices,
 * notes late posts, closes past days and cancels what no longer applies); then the stale drafts (at most 10, one by one,
 * the model allowed) and the due rollups (at most 10) are done here. A failure in one leaves the others to run.
 */
const standupSweep: Handler = async () => {
  if (!(await standupsReady())) return;
  const { sweepStandups } = await import("../src/server/services/standup");
  const r = await sweepStandups(new Date());
  let drafted = 0, sent = 0;
  for (const id of r.toDraft.slice(0, 10)) {
    if (await draftEntry(id).catch((err) => { console.error(`[worker] standup sweep draft ${id}: ${(err as Error)?.message ?? String(err)}`); return false; })) drafted++;
  }
  for (const id of r.rollupsDue.slice(0, 10)) {
    if (await sendRollupNow(id).catch((err) => { console.error(`[worker] standup sweep rollup ${id}: ${(err as Error)?.message ?? String(err)}`); return false; })) sent++;
  }
  const moved = r.opened + drafted + sent + r.released + r.lateNoted + r.missed + r.cancelled;
  if (moved) console.log(`[worker] standup: ${JSON.stringify({ opened: r.opened, drafted, sent, released: r.released, lateNoted: r.lateNoted, missed: r.missed, cancelled: r.cancelled })}`);
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

/**
 * Natural voice (fix review, 9 October 2026): one utterance to delete from the key's ElevenLabs History by ElevenLabs'
 * own ids for it, queued by the speech route with ids only (never the words) and run here when the web process's own
 * quick tries did not do it (a restart, ElevenLabs failing, a key without History access). Free requests; never TTS.
 */
const voiceHistoryForget: Handler = async (payload) => {
  const { runHistoryForgetJob } = await import("../src/server/services/natural-voice");
  await runHistoryForgetJob(payload);
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
  // Phase 7c (owner decisions, 8–9 October 2026): the async standup.
  "standup.open": standupOpen,
  "standup.draft": standupDraft,
  "standup.rollup": standupRollup,
  "standup.sweep": standupSweep,
  "recording.retention_delete": retentionDelete,
  "recording.assemble": assembleRecording,
  "deliverable.scan": scanDeliverable,
  "system.purge_expired": purgeExpired,
  "voice.history_forget": voiceHistoryForget,
};
