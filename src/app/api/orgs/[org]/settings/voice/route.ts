import { route, orgContext, ok, requireRole } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { voiceConnectionStatus } from "@/server/services/natural-voice";

/**
 * Natural voice for the workspace (owner request, 27 October 2026: "as long as we have the ElevenLabs API key it works for
 * all workspaces"). Owners and HR. GET → whether Boredroom's key is there and the workspace's characters today and this
 * month (`ready: false` before migration 0053). POST and DELETE (an old tab adding or removing a workspace key) answer 410
 * KEYS_REMOVED and change nothing: workspaces no longer store an ElevenLabs key.
 */
const KEYS_REMOVED = "Natural voices are provided by Boredroom now. There is no key to add or remove.";

export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await voiceConnectionStatus(ctx));
});

const gone = route<{ org: string }>(async (_req, { params }) => {
  await orgContext(params.org);
  throw new AppError(410, "KEYS_REMOVED", KEYS_REMOVED);
});
export const POST = gone;
export const DELETE = gone;
