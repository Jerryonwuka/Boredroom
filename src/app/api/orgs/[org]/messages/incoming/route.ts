import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { incomingMessages } from "@/server/services/messaging";

/** Messages from other people since a moment; the browser asks after a realtime event and shows a toast per message. */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { after } = parseQuery(req, z.object({ after: z.string().datetime({ offset: true }) }));
  return ok({ messages: await incomingMessages(ctx, after) });
});
