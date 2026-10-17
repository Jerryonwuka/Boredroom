import { route, ok } from "@/server/lib/api";
import { macContext } from "@/server/lib/mac-context";
import { ACT_SMALL_BODY, readActBody } from "@/server/services/act";
import { jobUndone, jobUndoneSchema } from "@/server/services/jobs";

/**
 * The person pressed Undo on a job on their Mac and it put things back (Brenda and her helpers, build 1; owner's approved
 * brief, 12 October 2026: "every change in an Undo manifest"; contract G.11). The manifest lives on the Mac; the server
 * keeps only that it was undone and how many items came back or had changed since. Rust alone calls it.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  const body = await readActBody(req, jobUndoneSchema, ACT_SMALL_BODY);
  return ok(await jobUndone(mc, params.id, body));
});
