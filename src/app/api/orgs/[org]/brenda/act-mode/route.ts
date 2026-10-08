import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { actModeFor, saveActMode } from "@/server/services/act-mode";
import { ACT_MODES, ACT_WORDS } from "@/lib/act-mode";

/**
 * The person's permission mode (owner decision, 8 October 2026: act without asking, "just like the way it is on Claude
 * Code"): `ActState` (lib/act-mode), what they chose and whether it is in force. Read by Settings → Your assistant, the
 * composer's pill and the notch. Before migration 0045 it reads `ASK_STATE` (`ready: false`). Not plan-gated: a person
 * may always choose to be asked.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await actModeFor(await orgContext(params.org))));

/**
 * `{ mode: "ask" | "auto" }`, saved at once → `ActState`. 403 while someone else is signed in as the person, 403 for
 * 'auto' while the workspace has it off ('ask' always saves), 503 NOT_READY before 0045. Not logged: a personal
 * preference, as her voice.
 */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ mode: z.enum(ACT_MODES, { error: ACT_WORDS.errors.sayMode }) }), { maxBytes: 4096 });
  return ok(await saveActMode(ctx, body.mode));
});
