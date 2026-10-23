import { route, orgContext, ok, uuid } from "@/server/lib/api";
import { requireConnectors } from "@/server/connectors/connections";
import { hideItem } from "@/server/connectors/items";

/** Hide an item from the viewer's own My Day (only they see this). */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  await hideItem(ctx, uuid.parse(params.id), true);
  return ok({ ok: true });
});

/** Show it again. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  await hideItem(ctx, uuid.parse(params.id), false);
  return ok({ ok: true });
});
