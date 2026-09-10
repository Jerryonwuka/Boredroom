import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { addComment } from "@/server/services/tasks";

export const POST = route<{ org: string; task: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { body } = await parseBody(req, z.object({ body: z.string().trim().min(1).max(4000) }));
  return ok(await addComment(ctx, params.task, body), 201);
});
