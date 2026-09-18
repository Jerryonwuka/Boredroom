import { route, orgContext, ok } from "@/server/lib/api";
import { withdrawMessage } from "@/server/services/messaging";

/** Withdraws one of the caller's own messages. */
export const DELETE = route<{ org: string; message: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withdrawMessage(ctx, params.message));
});
