import { route, orgContext, ok } from "@/server/lib/api";
import { keepBrenda } from "@/server/services/assistant-profile";

/** "Keep Brenda" in "Meet your assistant": marks setup done and keeps the look as it is (owner decision, 7 October 2026: personal assistants). */
export const POST = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await keepBrenda(ctx));
});
