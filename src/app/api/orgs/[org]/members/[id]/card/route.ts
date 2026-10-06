import { route, orgContext, ok, uuid } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { memberCard } from "@/server/services/workspace";

/** The hover card for a person: name, role, teams, id, status. Email only for the organisation account. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  // An id that is not an id is a person who does not exist (404), not a database error (500).
  if (!uuid.safeParse(params.id).success) throw notFound("That person is not an active member.");
  return ok(await memberCard(ctx, params.id));
});
