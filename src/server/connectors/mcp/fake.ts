/**
 * A pretend MCP server answered inside this process (owner decisions, 4 November 2026: MCP servers, phase 1), so tests
 * and `pnpm smoke:brenda-mcp` run Brenda's apps end to end without a network or an account. Registered through
 * connectors/http's in-process hosts, which never answer in production. It has one reading tool (search_notes) and one
 * that changes things (create_note), answers in JSON or as an event stream, may ask for a key, and records every call.
 */
import { registerInProcessHost } from "../http";

export type FakeMcpTool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };

export type FakeMcpOptions = {
  host?: string;
  /** Required as "Bearer <key>" when set. */
  key?: string;
  /** "sse" answers every request as an event stream (with a notification first). */
  mode?: "json" | "sse";
  tools?: FakeMcpTool[];
  /** Words a tool answers with (default: notes about the query). */
  answer?: (name: string, args: Record<string, unknown>) => string;
};

export type FakeMcpServer = {
  url: string;
  host: string;
  calls: { method: string; name?: string; args?: Record<string, unknown>; session: string | null; auth: string | null }[];
  notes: string[];
  setTools(tools: FakeMcpTool[]): void;
  stop(): void;
};

export const FAKE_MCP_TOOLS: FakeMcpTool[] = [
  {
    name: "search_notes", description: "Search the team's notes by words. Returns matching notes.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }, annotations: { readOnlyHint: true },
  },
  {
    name: "create_note", description: "Create a note everyone in the team can see.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title"] }, annotations: { readOnlyHint: false },
  },
];

export function startFakeMcpServer(o: FakeMcpOptions = {}): FakeMcpServer {
  const host = (o.host ?? "mcp.fake.test").toLowerCase();
  let tools = o.tools ?? FAKE_MCP_TOOLS;
  const session = `fake-session-${Math.random().toString(36).slice(2, 10)}`;
  const server: FakeMcpServer = {
    url: `https://${host}/mcp`, host, calls: [], notes: [],
    setTools: (t) => { tools = t; },
    stop: () => registerInProcessHost(host, null),
  };
  const reply = (id: unknown, result: unknown) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    if (o.mode === "sse") {
      const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "working" } })}\n\nevent: message\ndata: ${msg}\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": session } });
    }
    return new Response(msg, { status: 200, headers: { "content-type": "application/json", "mcp-session-id": session } });
  };
  registerInProcessHost(host, async (url, init) => {
    const h = new Headers(init.headers);
    const auth = h.get("authorization");
    if (url.pathname !== "/mcp") return new Response("not here", { status: 404 });
    if (o.key && auth !== `Bearer ${o.key}`) return new Response("no", { status: 401 });
    let body: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try { body = JSON.parse(String(init.body ?? "")); } catch { return new Response("bad", { status: 400 }); }
    const method = body.method ?? "";
    const params = body.params ?? {};
    const name = typeof params.name === "string" ? params.name : undefined;
    const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : undefined;
    server.calls.push({ method, ...(name ? { name } : {}), ...(args ? { args } : {}), session: h.get("mcp-session-id"), auth });
    if (method === "initialize") {
      return reply(body.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Fake notes", version: "1.0" } });
    }
    if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (h.get("mcp-session-id") !== session) return new Response("no session", { status: 404 });
    if (method === "tools/list") return reply(body.id, { tools });
    if (method === "tools/call") {
      if (!tools.some((t) => t.name === name)) return reply(body.id, { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true });
      if (name === "create_note") server.notes.push(String(args?.title ?? ""));
      const text = o.answer ? o.answer(name!, args ?? {}) : name === "search_notes" ? `Note: Launch checklist (matches "${String(args?.q ?? "")}")` : `Created note "${String(args?.title ?? "")}"`;
      return reply(body.id, { content: [{ type: "text", text }] });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return server;
}

/**
 * Development only: with MCP_FAKE=1 (never in production or tests, which start their own), https://mcp.fake.test/mcp
 * answers in this process with the fake's two tools and no key, so the Settings screens and Brenda can be tried locally.
 */
let devFake: FakeMcpServer | null = null;
export function devFakeMcp(): void {
  if (devFake || process.env.MCP_FAKE !== "1" || process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return;
  devFake = startFakeMcpServer();
}
