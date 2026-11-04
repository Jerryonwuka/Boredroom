import { z } from "zod";
import { route, orgContext, parseBody, ok, uuid } from "@/server/lib/api";
import { removeServer, updateServer } from "@/server/connectors/mcp/servers";

const auth = z.object({ kind: z.enum(["none", "bearer", "header"]), key: z.string().max(4000).optional(), header: z.string().max(60).optional() });
const schema = z.object({ name: z.string().max(200).optional(), useFor: z.string().max(400).nullable().optional(), paused: z.boolean().optional(), auth: auth.optional() });

/** Renames a server, says what it's for, pauses or resumes it, or changes its key (checked first). Owners and HR. */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await updateServer(ctx, uuid.parse(params.id), await parseBody(req, schema, { maxBytes: 8192 })));
});

/** Removes a server with its key and tools. Owners and HR. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await removeServer(ctx, uuid.parse(params.id)));
});
