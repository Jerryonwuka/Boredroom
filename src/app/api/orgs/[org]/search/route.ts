import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { searchWorkspace, searchSchema } from "@/server/services/search";

/** Top-bar search: tasks, people, projects and teams the caller may see. */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { q } = parseQuery(req, searchSchema);
  return ok(await searchWorkspace(ctx, q));
});
