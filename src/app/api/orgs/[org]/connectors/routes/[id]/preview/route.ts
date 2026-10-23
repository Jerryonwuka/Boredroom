import { route, orgContext, ok, uuid, requireRole } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { requireConnectors } from "@/server/connectors/connections";
import { previewRoute } from "@/server/connectors/posting/post";

/** What the route would post now, from today's real data, and its readback (owners and HR). */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  requireRole(ctx, "owner", "hr");
  const p = await previewRoute(uuid.parse(params.id), ctx.org.id);
  if (!p) throw notFound();
  return ok(p);
});
