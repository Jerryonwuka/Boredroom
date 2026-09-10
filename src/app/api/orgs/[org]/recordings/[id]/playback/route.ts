import { route, orgContext, ok } from "@/server/lib/api";
import { authorisePlayback } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await authorisePlayback(ctx, params.id));
});
