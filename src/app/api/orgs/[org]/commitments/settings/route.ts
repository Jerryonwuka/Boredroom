import { withUser } from "@/server/db";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { commitmentSettings, commitmentSettingsSchema, saveCommitmentSettings } from "@/server/services/commitments";

/**
 * "Track commitments in group chats" and "Post gentle follow-ups in the thread" (owner decisions, 8 October 2026: phase
 * 7b; both off until an owner or HR turns them on): `{ ready, track, threadFollowUps, since }`. Members may read it;
 * before migration 0048 it reads `{ ready: false, track: false, … }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withUser(ctx.user.profileId, (db) => commitmentSettings(db, ctx.org.id)));
});

/** Owners and HR: `{ track?, threadFollowUps? }`, saved at once and logged in Brenda's log. 403 for anyone else, 503 before 0048. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, commitmentSettingsSchema, { maxBytes: 4096 });
  return ok(await saveCommitmentSettings(ctx, body));
});
