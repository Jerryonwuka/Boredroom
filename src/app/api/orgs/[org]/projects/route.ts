import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { createProject, createProjectSchema } from "@/server/services/tasks";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, createProjectSchema);
  return ok(await createProject(ctx, body), 201);
});
