import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { saveWorkspaceActSetting, workspaceActSettingFor } from "@/server/services/act-mode";
import { ACT_WORDS } from "@/lib/act-mode";

/**
 * "Allow people to let their assistant act without asking" (owner decision, 8 October 2026: act without asking):
 * `{ ready, allowed }`, on by default. Members may read it; before migration 0045 it reads `{ ready: false, allowed: true }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await workspaceActSettingFor(await orgContext(params.org))));

/**
 * Owners and HR: `{ allowed: boolean }` → `{ ready: true, allowed }`, saved at once under the organisation's Brenda
 * settings lock and logged in Brenda's log. 503 NOT_READY before 0045. Off, everyone's assistant asks whatever they chose.
 */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, z.object({ allowed: z.boolean({ error: ACT_WORDS.errors.sayAllowed }) }), { maxBytes: 4096 });
  return ok(await saveWorkspaceActSetting(ctx, body.allowed));
});
