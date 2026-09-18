import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { openDirect } from "@/server/services/messaging";

/** Opens (or finds) the direct thread between the caller and another member and returns its id. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ membershipId: z.uuid() }));
  return ok({ id: await openDirect(ctx, body.membershipId) });
});
