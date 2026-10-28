import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { noteDeclined } from "@/server/services/learning";

/**
 * "Not now" on a Confirm card (owner decision, 28 October 2026: "What Brenda has learned"): the card's own signed token
 * says which action the person turned down, noted as one of their signals (nothing when learning is off, before 0067 or
 * while someone else is signed in as them). Nothing runs and nothing is claimed: `{ noted }`.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const b = await parseBody(req, z.object({ token: z.string().min(10).max(40_000) }));
  return ok(noteDeclined(ctx, b.token));
});
