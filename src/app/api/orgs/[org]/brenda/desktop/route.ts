import { route, orgContext, ok } from "@/server/lib/api";
import { desktopState } from "@/server/services/desktop";

/**
 * Everything the desktop notch shows, in one read. `?opener=0`: the notch has already shown today's first card, so the
 * morning opener is not built (review, 8 October 2026: it is the day's first card only, and the notch polls every 20
 * seconds). Without the parameter (an older notch) it is built as before.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const opener = new URL(req.url).searchParams.get("opener") !== "0";
  return ok(await desktopState(await orgContext(params.org), { opener }));
});
