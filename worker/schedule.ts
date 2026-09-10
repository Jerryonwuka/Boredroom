import { withWorker } from "../src/server/db";
import { enqueueJob } from "../src/server/services/common";
import { localDate, localMidnight, weekdayOf } from "../src/server/lib/time";

/**
 * Enqueues deduplicated scheduled jobs: one reminder per member per working day
 * (30 minutes before scheduled day end), retention deletions at expiry, housekeeping.
 */
export async function scheduleMaintenance() {
  await withWorker(async (db) => {
    const orgs = await db.query<{ id: string; slug: string; timezone: string; reminder: number; working_days: number[]; end_local: string }>(
      `SELECT o.id, o.slug, o.timezone, COALESCE(p.reminder_minutes_before_end, 30) AS reminder, s.working_days, s.end_local::text AS end_local
       FROM organisations o LEFT JOIN policies p ON p.id = o.current_policy_id
       JOIN LATERAL (SELECT working_days, end_local FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
       WHERE o.status = 'active'`);
    const now = new Date();
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      if (!org.working_days.includes(weekdayOf(today))) continue;
      const [h, m] = org.end_local.split(":").map(Number);
      const dayStart = localMidnight(today, org.timezone).getTime();
      const remindAt = new Date(dayStart + (h * 60 + m - org.reminder) * 60000);
      if (remindAt.getTime() > now.getTime() + 60 * 60000) continue; // schedule at most an hour ahead
      const members = await db.query<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active'`, [org.id]);
      for (const mem of members) {
        await enqueueJob(db, "report.reminder", { organisationId: org.id, membershipId: mem.id, localDate: today, slug: org.slug }, { dedupKey: `report.reminder:${mem.id}:${today}`, runAt: remindAt });
      }
    }
    const expiring = await db.query<{ id: string }>(`SELECT id FROM recordings WHERE deleted_at IS NULL AND upload_state <> 'deleted' AND expires_at <= now()`);
    for (const r of expiring) await enqueueJob(db, "recording.retention_delete", { recordingId: r.id, reason: "retention" }, { dedupKey: `recording.delete:${r.id}` });
    await enqueueJob(db, "system.purge_expired", {}, { dedupKey: `purge:${new Date().toISOString().slice(0, 13)}` });
  });
}
