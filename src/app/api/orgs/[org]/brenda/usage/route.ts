import { route, orgContext, ok } from "@/server/lib/api";
import { usageSummary } from "@/server/services/ai-usage";

/**
 * This month's requests to Claude and the tokens they used, for owners and HR (403 for everyone else): totals, by
 * purpose, the people who asked most and the workspace's own jobs (owner decision, 8 October 2026: personal assistants,
 * phase 3). No prices.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await usageSummary(await orgContext(params.org))));
