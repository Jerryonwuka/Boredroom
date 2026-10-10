import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { getCallView } from "@/server/services/calls";
import { CALL_WORDS } from "@/lib/calls";

/**
 * One call as the person sees it (owner decisions, 8 October 2026: phase 8, calls): `{ call: CallView }`, settled first
 * when something is past due. 404 for a call they may not see (they were not on it and do not read its conversation);
 * 503 NOT_READY before migration 0054.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const call = await getCallView(await orgContext(params.org), params.id);
  if (!call) throw notFound(CALL_WORDS.errors.notFound);
  return ok({ call });
});
