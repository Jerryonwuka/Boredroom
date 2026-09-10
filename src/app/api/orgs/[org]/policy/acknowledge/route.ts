import { route, orgContext, ok } from "@/server/lib/api";
import { acknowledgePolicy } from "@/server/services/orgs";

export const POST = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await acknowledgePolicy(ctx);
  return ok({ ok: true });
});
