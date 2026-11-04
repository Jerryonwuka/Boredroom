import { z } from "zod";
import { route, orgContext, parseBody, ok, uuid } from "@/server/lib/api";
import { setToolAccess } from "@/server/connectors/mcp/servers";

const schema = z.object({ access: z.enum(["off", "read", "act"]) });

/** One tool off, or on as Read or Act, approved as the server describes it now. Owners and HR. */
export const PUT = route<{ org: string; id: string; tool: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { access } = await parseBody(req, schema, { maxBytes: 256 });
  return ok(await setToolAccess(ctx, uuid.parse(params.id), uuid.parse(params.tool), access));
});
