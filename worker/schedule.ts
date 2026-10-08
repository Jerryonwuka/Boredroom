import { withWorker } from "../src/server/db";
import { enqueueJob } from "../src/server/services/common";
import { reportRecipients } from "../src/server/services/daily-report";
import { localDate, localTimeOn, weekdayOf } from "../src/server/lib/time";
import { schema0039Ready } from "../src/server/lib/schema-0039";

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
 * Follow-up jobs another worker killed because it does not know them yet (correctness review, 8 October 2026): while a
 * worker deployed before phase 4 still runs against the same database, it claims about half of the new jobs and marks
 * each 'dead' at once ("no handler for job type …"). A dead followup.collect would keep its per-day key and that
 * organisation would get no collection that day. This puts such jobs from the last day back in the queue (attempts
 * reset) for a worker that knows them; a job the old worker claims again comes back on the next run. Harmless once
 * every worker runs phase 4: then nothing matches. The proper fix is deploying the worker before (or with) this one.
 */
export async function rearmFollowUpJobs() {
  return withWorker(async (db) => {
    const r = await db.query<{ id: string }>(
      `UPDATE jobs SET state = 'pending', attempts = 0, last_error = NULL, finished_at = NULL, locked_at = NULL, locked_by = NULL, next_run_at = now()
       WHERE state = 'dead' AND type IN ('followup.collect', 'followup.process', 'followup.sweep')
         AND last_error LIKE 'no handler for job type %' AND created_at > now() - interval '1 day'
       RETURNING id`);
    return { rearmed: r.length };
  });
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
  await rearmFollowUpJobs().then((r) => { if (r.rearmed) console.warn(`[worker] ${r.rearmed} follow-up job(s) killed by a worker without phase 4 put back in the queue: deploy the worker everywhere`); }, (err) => console.error("[worker] follow-up job re-arm", (err as Error).message));
  await withWorker(async (db) => {
    const expiring = await db.query<{ id: string }>(`SELECT id FROM recordings WHERE deleted_at IS NULL AND upload_state <> 'deleted' AND expires_at <= now()`);
    for (const r of expiring) await enqueueJob(db, "recording.retention_delete", { recordingId: r.id, reason: "retention" }, { dedupKey: `recording.delete:${r.id}` });
    await enqueueJob(db, "system.purge_expired", {}, { dedupKey: `purge:${new Date().toISOString().slice(0, 13)}` });
  });
}
