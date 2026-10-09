import { route, orgContext, idempotent } from "@/server/lib/api";
import { dismissReplan } from "@/server/services/replans";

/**
 * "Not now" on a suggested new due date (owner decisions, 8 October 2026: phase 7b): the due date stays as it is.
 * `{ replan }`. Anyone else 404, already answered 409 ITEM_CLOSED, 403 while someone else is signed in as the lead, 503
 * before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "replans.dismiss", { id: params.id }, async () => ({ status: 200, body: { replan: await dismissReplan(ctx, params.id) } }));
});
