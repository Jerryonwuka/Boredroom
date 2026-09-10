import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { updateSchedule, scheduleSchema } from "@/server/services/orgs";

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, scheduleSchema);
  await updateSchedule(ctx, body);
  return ok({ ok: true });
});
