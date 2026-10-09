import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { getCommitment } from "@/server/services/commitments";
import { LOOP_WORDS } from "@/lib/commitments";

/**
 * One commitment (owner decisions, 8 October 2026: phase 7b): `{ commitment }` for its committer, the person who asked,
 * or (open and done only) someone who may view the committer's records; 404 for anyone else and before migration 0048.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  const commitment = await getCommitment(ctx, params.id);
  if (!commitment) throw notFound(LOOP_WORDS.errors.notFound);
  return ok({ commitment });
});
