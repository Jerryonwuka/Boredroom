import { route, orgContext, ok } from "@/server/lib/api";
import { deleteLearned } from "@/server/services/learning";

/**
 * Deletes one learned habit (owner decision, 28 October 2026: "What Brenda has learned"): `{ deleted: true }`; it is not
 * learned again. 404 when it is not theirs; 403 while someone else is signed in as them; 503 before migration 0067.
 */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const r = await deleteLearned(await orgContext(params.org), params.id);
  return ok({ deleted: r.deleted });
});
