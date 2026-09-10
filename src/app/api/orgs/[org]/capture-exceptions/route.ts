import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { requestCaptureException, exceptionSchema } from "@/server/services/recording";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, exceptionSchema);
  return ok(await requestCaptureException(ctx, body), 201);
});
