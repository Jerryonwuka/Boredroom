import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { createRecording, createRecordingSchema } from "@/server/services/recording";

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "VIDEO_RECORDING");
  const body = await parseBody(req, createRecordingSchema);
  return ok(await createRecording(ctx, body, requestId), 201);
});
