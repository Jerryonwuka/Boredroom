import { z } from "zod";
import { withUser } from "@/server/db";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { mentionSettings, saveMentionSettings } from "@/server/services/mentions";

/**
 * "Let people ask their assistant in Messages" (owner decision, 8 October 2026: personal assistants, phase 5):
 * `{ ready, enabled }`. Members may read it; before migration 0041 it reads `{ ready: false, enabled: true }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withUser(ctx.user.profileId, (db) => mentionSettings(db, ctx.org.id)));
});

/** Owners and HR: `{ enabled: boolean }`, saved at once. 503 before 0041. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, z.object({ enabled: z.boolean({ error: "Say whether assistants may reply." }) }), { maxBytes: 4096 });
  return ok(await saveMentionSettings(ctx, body));
});
