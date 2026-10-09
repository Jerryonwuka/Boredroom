import { z } from "zod";
import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { STANDUP_BODY_MAX, saveStandupSettings, standupSettings, type StandupSettingsPatch } from "@/server/services/standup";

/**
 * A team's async standup (owner decisions, 8–9 October 2026: phase 7c, option B): `StandupSettingsView`, readable by
 * every member of the workspace; 404 when the team is not there. Before migration 0050 `{ ready: false, enabled: false,
 * … }`.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => ok(await standupSettings(await orgContext(params.org), params.id)));

/**
 * Changes it: `{ enabled?, time?: "HH:MM", cutoff?: "HH:MM", days?: number[] }` (0 = Sunday … 6 = Saturday, on the
 * organisation's clock) → `StandupSettingsView`. The team's lead, the owner or HR only (403); the rollup at least 30
 * minutes after the drafts and 1 to 7 days (400); switching it on while the workspace does not offer standup 409
 * STANDUP_NOT_OFFERED; switching it off ends today's standup at once; 503 NOT_READY before migration 0050.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.record(z.string(), z.unknown()), { maxBytes: STANDUP_BODY_MAX });
  return idempotent(req, ctx.user, "standup.settings", { id: params.id, ...body }, async () => ({
    status: 200, body: await saveStandupSettings(ctx, params.id, body as StandupSettingsPatch),
  }));
});
