import { route, orgContext, ok } from "@/server/lib/api";
import { listResearch } from "@/server/research/service";

/**
 * The person's own research list (Brenda's research in the background; owner decision, 28 October 2026): newest first,
 * at most 50, never anyone else's whatever the role. Before 0066: `{ ready: false, reports: [] }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await listResearch(ctx));
});
