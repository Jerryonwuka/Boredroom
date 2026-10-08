import { route, orgContext, ok } from "@/server/lib/api";
import { markOpenerSeen } from "@/server/services/routines";

/**
 * The opener was on screen (owner decision, 8 October 2026: phase 7a): marks it seen today → `{ seenAt }`. 403 while
 * someone else is signed in as the person (nothing saved); 503 NOT_READY before migration 0046. No body.
 */
export const POST = route<{ org: string }>(async (_req, { params }) => ok(await markOpenerSeen(await orgContext(params.org))));
