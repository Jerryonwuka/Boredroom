import { withWorker } from "../src/server/db";
import { enqueueJob } from "../src/server/services/common";
import { reportRecipients } from "../src/server/services/daily-report";
import { localDate, localTimeOn, weekdayOf } from "../src/server/lib/time";

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
 * Enqueues deduplicated scheduled jobs: Brenda's end-of-day team reports, retention deletions at expiry, housekeeping.
 * There is no end-of-day "submit your report" reminder any more: staff no longer write a daily report (owner
 * decision, 6 October 2026).
 */
export async function scheduleMaintenance() {
  await scheduleDailyReports().catch((err) => console.error("[worker] daily report schedule", (err as Error).message));
  await withWorker(async (db) => {
    const expiring = await db.query<{ id: string }>(`SELECT id FROM recordings WHERE deleted_at IS NULL AND upload_state <> 'deleted' AND expires_at <= now()`);
    for (const r of expiring) await enqueueJob(db, "recording.retention_delete", { recordingId: r.id, reason: "retention" }, { dedupKey: `recording.delete:${r.id}` });
    await enqueueJob(db, "system.purge_expired", {}, { dedupKey: `purge:${new Date().toISOString().slice(0, 13)}` });
  });
}
