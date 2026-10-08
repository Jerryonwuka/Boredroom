import { withUser } from "@/server/db";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { FOLLOW_UP_BODY_MAX, collectionSettingsSchema, followUpSettings, saveFollowUpSettings } from "@/server/services/follow-ups";

/**
 * The workspace's collection of updates before the end-of-day report (owner decision, 8 October 2026: personal
 * assistants, phase 4): `{ ready, collect, collectAsk, leadMinutes }`. Members may read it; before migration 0039 it
 * reads `ready: false` and off.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withUser(ctx.user.profileId, (db) => followUpSettings(db, ctx.org.id)));
});

/** Owners and HR: `{ collect?, collectAsk?, leadMinutes?: 30 | 60 | 90 | 120 }`, each change saved at once. 503 before 0039. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await saveFollowUpSettings(ctx, await parseBody(req, collectionSettingsSchema, { maxBytes: FOLLOW_UP_BODY_MAX })));
});
