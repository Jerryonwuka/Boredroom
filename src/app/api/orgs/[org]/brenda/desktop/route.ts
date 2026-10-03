import { route, orgContext, ok } from "@/server/lib/api";
import { desktopState } from "@/server/services/desktop";

/** Everything the desktop notch shows, in one read. */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await desktopState(await orgContext(params.org))));
