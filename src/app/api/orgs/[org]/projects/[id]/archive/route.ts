import { route, orgContext, ok } from "@/server/lib/api";
import { archiveProject } from "@/server/services/tasks";

export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await archiveProject(ctx, params.id);
  return ok({ ok: true });
});
