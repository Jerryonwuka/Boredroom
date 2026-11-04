import { z } from "zod";
import { route, orgContext, parseBody, ok } from "@/server/lib/api";
import { addServer, listServers } from "@/server/connectors/mcp/servers";

const auth = z.object({ kind: z.enum(["none", "bearer", "header"]), key: z.string().max(4000).optional(), header: z.string().max(60).optional() });
const schema = z.object({ name: z.string().max(200), url: z.string().max(500), useFor: z.string().max(400).nullable().optional(), auth });

/** The workspace's MCP servers and their tools (owners and HR; owner decisions, 4 November 2026: phase 1). Never a key. */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok({ servers: await listServers(ctx) });
});

/** Adds a server: Boredroom connects and lists its tools first, and saves it with every tool off. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await addServer(ctx, await parseBody(req, schema, { maxBytes: 8192 })), 201);
});
