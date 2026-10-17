import { route, orgContext, ok } from "@/server/lib/api";
import { listJobs } from "@/server/services/jobs";

/**
 * The person's own Jobs list (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "a private Jobs
 * list on the web (only the person)"; contract N.1): their background jobs from the last 30 days, newest first. Never
 * anyone else's, whatever the role. Before 0060: `{ready: false, jobs: []}`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await listJobs(ctx));
});
