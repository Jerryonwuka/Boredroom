import { route, orgContext, ok } from "@/server/lib/api";
import { memberCard } from "@/server/services/workspace";

/** The hover card for a person: name, role, teams, id, status. Email only for the organisation account. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await memberCard(ctx, params.id));
});
