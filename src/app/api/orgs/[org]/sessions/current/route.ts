import { route, orgContext, ok } from "@/server/lib/api";
import { currentSession } from "@/server/services/sessions";

export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await currentSession(ctx));
});
