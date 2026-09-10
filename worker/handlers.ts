import { withWorker } from "../src/server/db";
import { notify, audit } from "../src/server/services/common";

export type JobContext = { jobId: string; attempt: number };
export type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

/**
 * Sends the end-of-day reminder once per member per day (dedup key on notification).
 * Re-running the job never duplicates the reminder.
 */
const reportReminder: Handler = async (payload) => {
  const { organisationId, membershipId, localDate, slug } = payload as { organisationId: string; membershipId: string; localDate: string; slug: string };
  await withWorker(async (db) => {
    const existing = await db.maybeOne(`SELECT 1 FROM daily_reports WHERE membership_id = $1 AND local_date = $2 AND status <> 'draft'`, [membershipId, localDate]);
    if (existing) return;
    await notify(db, { organisationId, recipientMembershipId: membershipId, type: "report.reminder", title: `Your daily report for ${localDate} is due soon`, body: "Review today's sessions, add blockers and next priorities, then submit. No penalty applies for late reports.", href: `/app/${slug}/my-day`, dedupKey: `report.reminder:${localDate}` });
  });
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

export const handlers: Record<string, Handler> = {
  "report.reminder": reportReminder,
  "recording.retention_delete": retentionDelete,
  "recording.assemble": assembleRecording,
  "deliverable.scan": scanDeliverable,
  "system.purge_expired": purgeExpired,
};
