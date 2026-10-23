import { route, orgContext, ok, uuid } from "@/server/lib/api";
import { requireConnectors, syncNow } from "@/server/connectors/connections";

/** "Check now" (spec §4.3): every stream of the connection at once, at most once per 2 minutes (429 with words). */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  return ok(await syncNow(ctx, uuid.parse(params.id)));
});
