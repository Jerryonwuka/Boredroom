import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { setAssistantKey, clearAssistantKey, assistantKeySchema, assistantStatus } from "@/server/services/orgs";
import { testAssistantKey } from "@/server/services/assistant";

/** Connects the organisation's own Anthropic API key. The key is tested with one real request before it is stored. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  const body = await parseBody(req, assistantKeySchema);
  return ok(await setAssistantKey(ctx, body, testAssistantKey));
});

export const DELETE = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  await clearAssistantKey(ctx);
  return ok(await assistantStatus(ctx));
});
