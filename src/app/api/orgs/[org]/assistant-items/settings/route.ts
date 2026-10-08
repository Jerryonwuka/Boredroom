import { z } from "zod";
import { withUser } from "@/server/db";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { reportNoteSettings, saveReportNoteSettings } from "@/server/services/assistant-items";

/**
 * "Let people add notes to the team report" (owner decision, 8 October 2026: personal assistants, phase 6):
 * `{ ready, enabled }`, on by default. Members may read it; before migration 0043 it reads `{ ready: false, enabled: true }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withUser(ctx.user.profileId, (db) => reportNoteSettings(db, ctx.org.id)));
});

/** Owners and HR: `{ enabled: boolean }`, saved at once and logged in Brenda's log. 503 before 0043. */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, z.object({ enabled: z.boolean({ error: "Say whether people may add notes." }) }), { maxBytes: 4096 });
  return ok(await saveReportNoteSettings(ctx, body));
});
