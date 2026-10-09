import { withWorker } from "../src/server/db";
import { enqueueJob } from "../src/server/services/common";
import { reportRecipients } from "../src/server/services/daily-report";
import { localDate, localTimeOn, weekdayOf } from "../src/server/lib/time";
import { schema0039Ready } from "../src/server/lib/schema-0039";
import { schema0041Ready } from "../src/server/lib/schema-0041";
import { schema0043Ready } from "../src/server/lib/schema-0043";
import { schema0046Ready } from "../src/server/lib/schema-0046";
import { schema0048Ready } from "../src/server/lib/schema-0048";
import { LOOP_LIMITS } from "../src/lib/commitments";
import { NOTE_SETTLE_GRACE_MINUTES } from "../src/server/services/assistant-items";

/**
 * Brenda's end-of-day team report (owner decision, 5 October 2026): on each working day of an organisation that keeps
 * it on, one job per recipient at the time set in Settings (organisation local time), scheduled at most an hour ahead
 * and deduplicated per recipient per local date. The time is read on the local clock (localTimeOn), not added to local
 * midnight, so it holds on the days the clocks change. Who receives one is decided in services/daily-report.ts; the
 * job checks everything again when it runs. `organisationId` narrows it (the smoke script).
 */
export async function scheduleDailyReports(opts: { now?: Date; organisationId?: string } = {}) {
  const now = opts.now ?? new Date();
  return withWorker(async (db) => {
    const orgs = await db.query<{ id: string; timezone: string; working_days: number[]; report_time: string; org_wide: boolean }>(
      `SELECT o.id, o.timezone, COALESCE(s.working_days, '{1,2,3,4,5}'::int[]) AS working_days,
              to_char(COALESCE(b.daily_report_time, '18:00'::time), 'HH24:MI') AS report_time, COALESCE(b.daily_report_org_wide, true) AS org_wide
       FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id
       LEFT JOIN LATERAL (SELECT working_days FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
       WHERE o.status = 'active' AND COALESCE(b.daily_report_enabled, true) AND ($1::uuid IS NULL OR o.id = $1)`, [opts.organisationId ?? null]);
    let queued = 0;
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      if (!org.working_days.includes(weekdayOf(today))) continue;
      const runAt = localTimeOn(today, org.report_time, org.timezone);
      // The time can change in Settings after today's jobs were queued: those still waiting move to the new time (the
      // dedup key would otherwise keep the old one).
      await db.query(
        `UPDATE jobs SET next_run_at = $3 WHERE type = 'brenda.daily_report' AND state = 'pending' AND attempts = 0
           AND dedup_key LIKE $1 AND payload->>'organisationId' = $2 AND next_run_at <> $3`, [`brenda.daily_report:%:${today}`, org.id, runAt]);
      if (runAt.getTime() > now.getTime() + 60 * 60000) continue; // schedule at most an hour ahead
      for (const r of await reportRecipients(db, org.id, org.org_wide)) {
        await enqueueJob(db, "brenda.daily_report", { organisationId: org.id, membershipId: r.id, localDate: today }, { dedupKey: `brenda.daily_report:${r.id}:${today}`, runAt });
        queued++;
      }
    }
    return { queued };
  });
}

/**
 * The workspace's own collection of updates before the end-of-day report (owner decision, 8 October 2026: personal
 * assistants, phase 4). For each active organisation that keeps the report and switched the collection on, on a working
 * day: one followup.collect job at the report time less the lead set in Settings (30 minutes to 2 hours), on the local
 * clock (localTimeOn, so it holds on the days the clocks change), queued at most an hour ahead and deduplicated per
 * organisation per local date. A job still waiting moves when the time or the lead changes, as the reports' do; none is
 * queued once the report time has passed. Nothing before migration 0039. `organisationId` narrows it (tests).
 */
export async function scheduleFollowUpCollection(opts: { now?: Date; organisationId?: string } = {}) {
  const now = opts.now ?? new Date();
  return withWorker(async (db) => {
    if (!(await schema0039Ready(db))) return { queued: 0 };
    const orgs = await db.query<{ id: string; timezone: string; working_days: number[]; report_time: string; lead_minutes: number }>(
      `SELECT o.id, o.timezone, COALESCE(s.working_days, '{1,2,3,4,5}'::int[]) AS working_days,
              to_char(b.daily_report_time, 'HH24:MI') AS report_time, b.followup_collect_minutes::int AS lead_minutes
       FROM organisations o JOIN brenda_settings b ON b.organisation_id = o.id
       LEFT JOIN LATERAL (SELECT working_days FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
       WHERE o.status = 'active' AND b.daily_report_enabled AND b.followup_collect AND ($1::uuid IS NULL OR o.id = $1)`, [opts.organisationId ?? null]);
    let queued = 0;
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      if (!org.working_days.includes(weekdayOf(today))) continue;
      const reportAt = localTimeOn(today, org.report_time, org.timezone);
      if (reportAt.getTime() <= now.getTime()) continue; // the report has gone (or is going) out: nothing left to collect for
      const runAt = new Date(reportAt.getTime() - org.lead_minutes * 60_000);
      const dedupKey = `followup.collect:${org.id}:${today}`;
      // The report time or the lead changed after today's job was queued: the job still waiting moves with it.
      await db.query(`UPDATE jobs SET next_run_at = $2 WHERE type = 'followup.collect' AND state = 'pending' AND attempts = 0 AND dedup_key = $1 AND next_run_at <> $2`, [dedupKey, runAt]);
      if (runAt.getTime() > now.getTime() + 60 * 60000) continue; // queued at most an hour ahead
      await enqueueJob(db, "followup.collect", { organisationId: org.id, localDate: today }, { dedupKey, runAt });
      queued++;
    }
    return { queued };
  });
}

/**
 * The follow-ups sweep (phase 4): deadlines, anything stuck, batches left open. Queued in the minute something is due
 * (an ask past its deadline, or a row left pending or half-answered with nobody holding it; deduplicated on the minute),
 * and once an hour as a safety net (a batch whose last row closed without closing it). Jobs are never purged, so the
 * sweep is queued only when it has work, not every minute something is merely open (integration review, 8 October 2026).
 */
export async function scheduleFollowUpSweep(now: Date = new Date()) {
  return withWorker(async (db) => {
    if (!(await schema0039Ready(db))) return { queued: false, due: false };
    const minute = Math.floor(now.getTime() / 60_000);
    // The same rows sweepFollowUps picks up (the partial indexes on deadline_at and updated_at answer this).
    const due = await db.maybeOne(
      `SELECT 1 FROM follow_ups
       WHERE (status = 'asking' AND deadline_at <= $1::timestamptz)
          OR (status IN ('pending', 'answering') AND updated_at < $1::timestamptz - interval '1 minute' AND (lease_until IS NULL OR lease_until < $1::timestamptz))
       LIMIT 1`, [now.toISOString()]);
    if (due) await enqueueJob(db, "followup.sweep", {}, { dedupKey: `followup.sweep:${minute}` });
    // Once an hour whatever happens (its own key, so a loop that misses a minute still runs it).
    await enqueueJob(db, "followup.sweep", {}, { dedupKey: `followup.sweep:h${Math.floor(minute / 60)}` });
    return { queued: true, due: !!due };
  });
}

/**
 * The mentions sweep (owner decision, 8 October 2026: personal assistants, phase 5): Confirms past their time, and
 * mentions nobody is answering (pending for more than 30 seconds with nobody holding them, or thinking with the lease run
 * out: a restart, a model that did not answer). Queued in the minute something is due, deduplicated on the minute, and
 * once an hour as a safety net; jobs are never purged, so only when there is work. "Due" is the processor's own
 * definition (staleMentions), so the sweep is never queued for a row it would not pick up. Nothing before 0041.
 */
export async function scheduleMentionSweep(now: Date = new Date()) {
  if (!(await withWorker((db) => schema0041Ready(db)))) return { queued: false, due: false };
  const { staleMentions, ownerMentionsToSync } = await import("../src/server/services/mentions");
  const stale = await staleMentions({ now, limit: 1 });
  // Phase 6: a thread where someone else's assistant asked its owner and the follow-up has closed since (none before 0043).
  const toSync = stale.length ? [] : await ownerMentionsToSync({ limit: 1 }).catch(() => [] as string[]);
  return withWorker(async (db) => {
    const minute = Math.floor(now.getTime() / 60_000);
    const expired = stale.length || toSync.length ? null : await db.maybeOne(
      `SELECT 1 FROM assistant_mentions WHERE status = 'waiting_confirm' AND confirm_until <= $1::timestamptz LIMIT 1`, [now.toISOString()]);
    const due = stale.length > 0 || toSync.length > 0 || !!expired;
    if (due) await enqueueJob(db, "mention.sweep", {}, { dedupKey: `mention.sweep:${minute}` });
    // Once an hour whatever happens (its own key, so a loop that misses a minute still runs it).
    await enqueueJob(db, "mention.sweep", {}, { dedupKey: `mention.sweep:h${Math.floor(minute / 60)}` });
    return { queued: true, due };
  });
}

/**
 * The assistant items sweep (owner decision, 8 October 2026: personal assistants, phase 6): requests past their time,
 * accepted requests left half-done (decided more than 5 minutes ago with the lease run out), and report notes whose
 * report time has passed. Queued in the minute something is due (deduplicated on the minute) and once an hour as a
 * safety net; jobs are never purged, so only when there is work. Reads also settle on the spot, so expiry works with an
 * older worker too. Nothing before migration 0043.
 */
export async function scheduleAssistantItemSweep(now: Date = new Date()) {
  return withWorker(async (db) => {
    if (!(await schema0043Ready(db))) return { queued: false, due: false };
    const minute = Math.floor(now.getTime() / 60_000);
    const at = now.toISOString();
    // The same rows sweepAssistantItems picks up (the partial indexes on expires_at and decided_at answer this).
    const due = await db.maybeOne(
      `SELECT 1 FROM assistant_items
       WHERE (kind = 'request' AND status IN ('delivered', 'seen') AND expires_at <= $1::timestamptz)
          OR (status = 'accepted' AND decided_at < $1::timestamptz - interval '5 minutes' AND (lease_until IS NULL OR lease_until < $1::timestamptz))
          OR (kind = 'report_note' AND status = 'delivered' AND expires_at <= $1::timestamptz - make_interval(mins => $2))
       LIMIT 1`, [at, NOTE_SETTLE_GRACE_MINUTES]);
    if (due) await enqueueJob(db, "assistant_item.sweep", {}, { dedupKey: `assistant_item.sweep:${minute}` });
    await enqueueJob(db, "assistant_item.sweep", {}, { dedupKey: `assistant_item.sweep:h${Math.floor(minute / 60)}` });
    return { queued: true, due: !!due };
  });
}

/**
 * Routines (owner decision, 8 October 2026: phase 7a): one `routine.run` job per routine whose next run is due within
 * the minute, at its due time, deduplicated by routine and due time. A routine has one next run, so after any downtime
 * each gets at most one job (claimRun records a run missed by more than two hours as missed and moves on, never a
 * flood). Returns at once before migration 0046. `now` for the tests.
 */
export async function scheduleRoutines(now: Date = new Date()) {
  if (!(await withWorker((db) => schema0046Ready(db)))) return { queued: 0 };
  const { dueRoutines } = await import("../src/server/services/routines");
  const due = await dueRoutines({ now, limit: 200 });
  if (!due.length) return { queued: 0 };
  return withWorker(async (db) => {
    let queued = 0;
    for (const r of due) {
      const at = new Date(r.dueAt ?? r.next_run_at);
      if (Number.isNaN(at.getTime())) continue;
      const dueAt = at.toISOString();
      await enqueueJob(db, "routine.run", { routineId: r.id, dueAt }, { dedupKey: `routine.run:${r.id}:${dueAt}`, runAt: at });
      queued++;
    }
    return { queued };
  });
}

/**
 * Deliveries held for someone's quiet hours whose hold has ended (phase 7a): one `routine.release` job per person,
 * deduplicated on the minute; the job delivers them together (two or more as one notification), or holds them again when
 * the person is still quiet. Nothing before migration 0046.
 */
export async function scheduleRoutineReleases(now: Date = new Date()) {
  const { heldReleasesDue } = await import("../src/server/services/routines");
  const due = await heldReleasesDue(now);
  if (!due.length) return { queued: 0 };
  const minute = Math.floor(now.getTime() / 60_000);
  return withWorker(async (db) => {
    for (const r of due) await enqueueJob(db, "routine.release", { membershipId: r.membershipId }, { dedupKey: `routine.release:${r.membershipId}:${minute}` });
    return { queued: due.length };
  });
}

/**
 * The workspace's look at tracked group conversations for commitments (owner decisions, 8 October 2026: phase 7b): one
 * `commitments.scan` job per organisation with tracking on and something new in a tracked conversation, deduplicated
 * per organisation per 5-minute bucket, so a busy channel is read at most every five minutes. Nothing before 0048.
 */
export async function scheduleCommitmentScans(now: Date = new Date()) {
  const { trackedOrgsDue } = await import("../src/server/services/commitment-detect");
  const orgs = await trackedOrgsDue({ now });
  if (!orgs.length) return { queued: 0 };
  const bucket = Math.floor(now.getTime() / (LOOP_LIMITS.scanEveryMinutes * 60_000));
  return withWorker(async (db) => {
    for (const o of orgs) await enqueueJob(db, "commitments.scan", { organisationId: o.organisationId }, { dedupKey: `commitments.scan:${o.organisationId}:${bucket}` });
    return { queued: orgs.length };
  });
}

/**
 * The commitments sweep (phase 7b): queued in the minute something waits on nobody (commitments.ts `commitmentsDue`:
 * an expiry, an open ask past its grace period, a to-do done or archived, an interrupted accept), on a 15-minute bucket
 * while a due reminder may be waiting (commitment-followthrough), and once an hour whatever happens (stalled notes, thread
 * follow-ups, blocks to settle). Jobs are never purged, so only when there is work. Nothing before 0048.
 */
export async function scheduleCommitmentSweep(now: Date = new Date()) {
  if (!(await withWorker((db) => schema0048Ready(db)))) return { queued: false, due: false };
  const { commitmentsDue } = await import("../src/server/services/commitments");
  const { followThroughDue } = await import("../src/server/services/commitment-followthrough");
  const minute = Math.floor(now.getTime() / 60_000);
  const due = await commitmentsDue({ now }).catch((err) => { console.error("[worker] commitments due", (err as Error).message); return false; });
  const reminders = due ? false : await followThroughDue({ now }).catch(() => false);
  return withWorker(async (db) => {
    if (due) await enqueueJob(db, "commitments.sweep", {}, { dedupKey: `commitments.sweep:${minute}` });
    else if (reminders) await enqueueJob(db, "commitments.sweep", {}, { dedupKey: `commitments.sweep:q${Math.floor(minute / 15)}` });
    await enqueueJob(db, "commitments.sweep", {}, { dedupKey: `commitments.sweep:h${Math.floor(minute / 60)}` });
    return { queued: true, due: due || reminders };
  });
}

/**
 * The loose-ends sweep (phase 7b): follow-ups people scheduled with "Follow up later", asked once their time comes.
 * Queued in the minute one is due and once an hour. Nothing before 0048.
 */
export async function scheduleLooseEndSweep(now: Date = new Date()) {
  if (!(await withWorker((db) => schema0048Ready(db)))) return { queued: false, due: false };
  const { looseEndsDue } = await import("../src/server/services/loose-ends");
  const minute = Math.floor(now.getTime() / 60_000);
  const due = await looseEndsDue({ now }).catch((err) => { console.error("[worker] loose ends due", (err as Error).message); return false; });
  return withWorker(async (db) => {
    if (due) await enqueueJob(db, "loose_ends.sweep", {}, { dedupKey: `loose_ends.sweep:${minute}` });
    await enqueueJob(db, "loose_ends.sweep", {}, { dedupKey: `loose_ends.sweep:h${Math.floor(minute / 60)}` });
    return { queued: true, due };
  });
}

/**
 * The async standup (owner decisions, 8–9 October 2026: phase 7c, option B). For each team that runs one today (switched
 * on, its organisation active, the workspace offering standup, today one of its days; standup.ts standupDaysDue): one
 * `standup.open` at the day's post time on the organisation's clock, queued at most an hour ahead (or at once when the
 * time has passed and the cutoff has not), deduplicated per team per local date, and moved when the time changed while it
 * still waits, as the daily report's jobs are. For each open rollup whose cutoff is within the hour: one `standup.rollup`
 * at the cutoff (moved the same way). The sweep in the minute anything is due (standupSweepDue), and once an hour whatever
 * happens. Returns at once before migration 0050. `now` for the tests.
 */
export async function scheduleStandups(now: Date = new Date()) {
  const none = { opens: 0, rollups: 0, sweep: false };
  try {
    const { schema0050Ready } = await import("../src/server/lib/schema-0050");
    if (!(await withWorker((db) => schema0050Ready(db)))) return none;
  } catch { return none; }
  const { standupDaysDue, standupRollupsDue, standupSweepDue } = await import("../src/server/services/standup");
  const days = (await standupDaysDue(now)).filter((d) => !d.opened);
  const rollups = await standupRollupsDue(now, 60);
  const due = await standupSweepDue(now).catch((err) => { console.error("[worker] standup sweep due", (err as Error).message); return false; });
  return withWorker(async (db) => {
    let opens = 0, queuedRollups = 0;
    for (const d of days) {
      const runAt = new Date(d.postAt);
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() > now.getTime() + 60 * 60000) continue;
      const dedupKey = `standup.open:${d.teamId}:${d.localDate}`;
      // The post time changed after today's job was queued: the job still waiting moves with it.
      await db.query(`UPDATE jobs SET next_run_at = $2 WHERE type = 'standup.open' AND state = 'pending' AND attempts = 0 AND dedup_key = $1 AND next_run_at <> $2`, [dedupKey, runAt]);
      await enqueueJob(db, "standup.open", { teamId: d.teamId, localDate: d.localDate }, { dedupKey, runAt });
      opens++;
    }
    for (const r of rollups) {
      const runAt = new Date(r.cutoffAt);
      if (Number.isNaN(runAt.getTime())) continue;
      const dedupKey = `standup.rollup:${r.rollupId}`;
      await db.query(`UPDATE jobs SET next_run_at = $2 WHERE type = 'standup.rollup' AND state = 'pending' AND attempts = 0 AND dedup_key = $1 AND next_run_at <> $2`, [dedupKey, runAt]);
      await enqueueJob(db, "standup.rollup", { rollupId: r.rollupId }, { dedupKey, runAt });
      queuedRollups++;
    }
    const minute = Math.floor(now.getTime() / 60_000);
    if (due) await enqueueJob(db, "standup.sweep", {}, { dedupKey: `standup.sweep:${minute}` });
    // Once an hour whatever happens (its own key, so a loop that misses a minute still runs it).
    await enqueueJob(db, "standup.sweep", {}, { dedupKey: `standup.sweep:h${Math.floor(minute / 60)}` });
    return { opens, rollups: queuedRollups, sweep: due };
  });
}

/** A job as the worker claims it. */
export type ClaimedJob = { id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };

/**
 * Jobs another worker killed because it does not know them yet (correctness review, 8 October 2026; blocker fix,
 * 9 October 2026). While a worker deployed before a phase still runs against the same database, it claims about half
 * of the new jobs (follow-ups, mentions, assistant items, routines, commitments, loose ends, and phase 7c's standups) and marks each 'dead' at
 * once ("no handler for job type …"). Putting them back to 'pending' did not help: that worker, closer to the database
 * and polling just as often, took nearly every one of them again within a second, and killed it again, every 15
 * seconds, so a phase 7b job (the commitments scan) never ran. They are now claimed straight from 'dead' to 'running'
 * under THIS worker's name, which an older worker (it only ever takes 'pending' jobs) never sees, and this worker runs
 * them itself. Only types it has a handler for (`types`), killed in the last day, with attempts left: each claim counts
 * an attempt, so a job that also fails here ends dead with its real error instead of going round for ever. Harmless
 * once every worker runs the same code: then nothing matches. The proper fix is still deploying the worker before (or
 * with) the web.
 */
export async function claimKilledJobs(workerId: string, types: string[], limit = 50): Promise<ClaimedJob[]> {
  if (!types.length) return [];
  return withWorker((db) => db.query<ClaimedJob>(
    `UPDATE jobs SET state = 'running', attempts = attempts + 1, last_error = NULL, finished_at = NULL, locked_at = now(), locked_by = $1, next_run_at = now()
     WHERE id IN (SELECT id FROM jobs
                  WHERE state = 'dead' AND type = ANY($2::text[]) AND last_error LIKE 'no handler for job type %'
                    AND attempts < max_attempts AND created_at > now() - interval '1 day'
                  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $3)
     RETURNING id, type, payload, attempts, max_attempts`, [workerId, types, Math.max(1, Math.min(200, Math.round(limit)))]));
}

/**
 * Enqueues deduplicated scheduled jobs: Brenda's end-of-day team reports, retention deletions at expiry, housekeeping.
 * There is no end-of-day "submit your report" reminder any more: staff no longer write a daily report (owner
 * decision, 6 October 2026).
 */
export async function scheduleMaintenance() {
  await scheduleDailyReports().catch((err) => console.error("[worker] daily report schedule", (err as Error).message));
  // Follow-ups between assistants (phase 4): the workspace's collection before the report, and the sweep.
  await scheduleFollowUpCollection().catch((err) => console.error("[worker] follow-up collection schedule", (err as Error).message));
  await scheduleFollowUpSweep().catch((err) => console.error("[worker] follow-up sweep schedule", (err as Error).message));
  // @mentions in Messages (phase 5): expired Confirms and mentions nobody is answering.
  await scheduleMentionSweep().catch((err) => console.error("[worker] mention sweep schedule", (err as Error).message));
  // Assistants talking to each other (phase 6): requests past their time, interrupted accepts, report notes.
  await scheduleAssistantItemSweep().catch((err) => console.error("[worker] assistant item sweep schedule", (err as Error).message));
  // Routines (phase 7a): runs that are due, and deliveries held for quiet hours that may go now.
  await scheduleRoutines().catch((err) => console.error("[worker] routine schedule", (err as Error).message));
  await scheduleRoutineReleases().catch((err) => console.error("[worker] routine release schedule", (err as Error).message));
  // Loose ends and commitments (phase 7b): the workspace's scans of tracked group conversations, the commitments sweep
  // (with the follow-through and the blocks to settle) and the loose ends' scheduled follow-ups.
  await scheduleCommitmentScans().catch((err) => console.error("[worker] commitment scan schedule", (err as Error).message));
  await scheduleCommitmentSweep().catch((err) => console.error("[worker] commitment sweep schedule", (err as Error).message));
  await scheduleLooseEndSweep().catch((err) => console.error("[worker] loose end sweep schedule", (err as Error).message));
  // The async standup (phase 7c): days opening at their time, rollups at their cutoff, and the sweep.
  await scheduleStandups().catch((err) => console.error("[worker] standup schedule", (err as Error).message));
  // Jobs an older worker killed are claimed and run by this worker's loop (claimKilledJobs, worker/index.ts).
  await withWorker(async (db) => {
    const expiring = await db.query<{ id: string }>(`SELECT id FROM recordings WHERE deleted_at IS NULL AND upload_state <> 'deleted' AND expires_at <= now()`);
    for (const r of expiring) await enqueueJob(db, "recording.retention_delete", { recordingId: r.id, reason: "retention" }, { dedupKey: `recording.delete:${r.id}` });
    await enqueueJob(db, "system.purge_expired", {}, { dedupKey: `purge:${new Date().toISOString().slice(0, 13)}` });
  });
}
