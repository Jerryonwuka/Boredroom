import { route, ok } from "@/server/lib/api";
import { macContext } from "@/server/lib/mac-context";
import { ACT_SMALL_BODY, readActBody } from "@/server/services/act";
import { jobState, jobStateSchema } from "@/server/services/jobs";

/**
 * A job paused while the person's Mac slept or lost Boredroom, or carries on (Brenda and her helpers, build 1; owner's
 * approved brief, 12 October 2026: "Mac jobs pause when the Mac sleeps and resume"; contract G.6). Rust alone calls it;
 * content-free; only while the job lives.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  const body = await readActBody(req, jobStateSchema, ACT_SMALL_BODY);
  return ok(await jobState(mc, params.id, body));
});
