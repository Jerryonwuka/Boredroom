import { route, orgContext, ok } from "@/server/lib/api";
import { markCommitmentSeen } from "@/server/services/commitments";

/**
 * Opening a commitment's card marks it seen (owner decisions, 8 October 2026: phase 7b), on the web or the notch: the
 * committer alone; their notification is read. `{ ok: true }`. Anyone else 404, 403 while someone else is signed in as
 * the person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await markCommitmentSeen(ctx, params.id);
  return ok({ ok: true });
});
