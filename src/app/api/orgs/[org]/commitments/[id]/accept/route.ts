import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { acceptCommitment } from "@/server/services/commitments";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * Accept a commitment noted for the person, or take on an open ask (owner decisions, 8 October 2026: phase 7b; Accept is
 * the consent). The committer alone, while it waits: their own to-do is added as them (owners and HR: tracked without
 * one), linked to the message; `title` and `dueAt` may change what it says. `{ commitment, note }` (`note` says when the
 * to-do could not be added). Anyone else 404, already answered 409 ITEM_CLOSED, past its time 409 ITEM_EXPIRED, 403
 * while someone else is signed in as the person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 8192 });
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "commitments.accept", { id: params.id, ...body }, async () => ({ status: 200, body: await acceptCommitment(ctx, params.id, body) }));
});
