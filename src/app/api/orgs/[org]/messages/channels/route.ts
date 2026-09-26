import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { createChannel, channelSchema } from "@/server/services/messaging";

/** Creates a named channel with the caller and the chosen people; returns its id. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, channelSchema);
  return ok(await createChannel(ctx, body), 201);
});
