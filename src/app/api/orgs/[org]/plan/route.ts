import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { setDailyPlan, planSchema } from "@/server/services/tasks";

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, planSchema);
  await setDailyPlan(ctx, body);
  return ok({ ok: true });
});
