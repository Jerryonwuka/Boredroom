import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { planFromText, planRequestSchema } from "@/server/services/assistant";

/**
 * Turns a typed or dictated note into proposed to-dos. Nothing is created here: the member reviews the
 * proposals in the browser and confirms, which goes through the normal to-do endpoint.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, planRequestSchema);
  return ok(await planFromText(ctx, body));
});
