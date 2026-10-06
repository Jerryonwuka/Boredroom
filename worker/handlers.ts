import { withWorker } from "../src/server/db";
import { audit } from "../src/server/services/common";

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
  "recording.retention_delete": retentionDelete,
  "recording.assemble": assembleRecording,
  "deliverable.scan": scanDeliverable,
  "system.purge_expired": purgeExpired,
};
