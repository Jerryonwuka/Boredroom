import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { submitTask, submissionSchema } from "@/server/services/evidence";

export const POST = route<{ org: string; task: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, submissionSchema);
  return idempotent(req, ctx.user, `submissions:${params.task}`, body, async () => ({ status: 201, body: await submitTask(ctx, params.task, body, requestId) }));
});
