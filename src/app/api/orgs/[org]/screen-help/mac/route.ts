import { route, orgContext, ok, parseBody } from "@/server/lib/api";
import { saveMacState } from "@/server/services/screen-help";
import { macReportBodySchema } from "@/lib/screen-help";

/**
 * What Brenda for Mac says is on, on this Mac (Brenda for Mac, phase 3; owner request, 12 October 2026: the person sees
 * what is on; the employer still sees nothing; contract A.6, 0b.2). The notch page sends it through Brenda for Mac's own
 * session: which abilities are on, which permissions macOS has given, whether the companion shows and why not, and the
 * "Set up on my Mac" it just acted on. It is kept for the person alone (assistant_private: no owner, HR or lead reads it)
 * and shown only on their own Settings card. Only from Brenda for Mac (403), never while someone else is signed in as the
 * person (403); before migration 0059 nothing is kept (`{saved: false, ready: false}`). Never logged.
 */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, macReportBodySchema, { maxBytes: 16_000 });
  return ok(await saveMacState(ctx, body));
});
