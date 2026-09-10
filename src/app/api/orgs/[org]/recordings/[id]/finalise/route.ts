import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { finaliseRecording, finaliseSchema } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, finaliseSchema);
  return ok(await finaliseRecording(ctx, params.id, body, requestId));
});
