import { route, orgContext, ok } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { assistantStatus } from "@/server/services/orgs";

/**
 * Brenda's AI connection (owner request, 27 October 2026: "remove every API key store … API keys stay on our back end").
 * Every workspace uses Boredroom's own key, so a workspace can no longer connect, replace or remove one: POST and DELETE
 * answer 410 KEYS_REMOVED (an old tab's form) and change nothing. GET → `{ source: "environment" | "none", model }`.
 */
const KEYS_REMOVED = "Brenda's AI is provided by Boredroom now. There is no key to add or remove.";

export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await assistantStatus(ctx));
});

const gone = route<{ org: string }>(async (_req, { params }) => {
  await orgContext(params.org);
  throw new AppError(410, "KEYS_REMOVED", KEYS_REMOVED);
});
export const POST = gone;
export const DELETE = gone;
