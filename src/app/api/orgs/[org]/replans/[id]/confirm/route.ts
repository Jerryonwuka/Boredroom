import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { confirmReplan } from "@/server/services/replans";

const bodySchema = z.object({ dueAt: z.string().datetime({ offset: true }).nullable().optional() });

/**
 * Confirm a suggested new due date (owner decisions, 8 October 2026: phase 7b; never automatic): `{ dueAt? }` (the
 * suggestion when left out). The lead alone; the task's due date is changed as them, with their own permission.
 * `{ replan }`. Anyone else 404, already answered or stale 409 ITEM_CLOSED, the task changed since 409 VERSION_CONFLICT,
 * 403 when they may not change it (or someone else is signed in as them), 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 4096 });
  return idempotent(req, ctx.user, "replans.confirm", { id: params.id, dueAt: body.dueAt ?? null }, async () => ({ status: 200, body: { replan: await confirmReplan(ctx, params.id, { dueAt: body.dueAt ?? null }) } }));
});
