/**
 * A pretend MCP server answered inside this process (owner decisions, 4 November 2026: MCP servers, phase 1), so tests
 * and `pnpm smoke:brenda-mcp` run Brenda's apps end to end without a network or an account. Registered through
 * connectors/http's in-process hosts, which never answer in production. It has one reading tool (search_notes) and one
 * that changes things (create_note), answers in JSON or as an event stream, may ask for a key, and records every call.
 * With `oauth` (phase 1b) it signs in instead, as the MCP authorization spec has it: a 401 naming its resource metadata,
 * authorization server metadata, client registration, a token endpoint that checks PKCE, the redirect, the resource and
 * rotates refresh tokens, and revocation. Its sign-in page is `approve(url)` (tests) or the development route.
 */
import { createHash, randomBytes } from "node:crypto";
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
  /** Sign in with OAuth instead of a key. */
  oauth?: { authorizeUrl?: string; registration?: boolean; accessTtlSeconds?: number; scopes?: string[] };
};

export type FakeOAuthState = {
  clients: Map<string, { redirectUris: string[] }>;
  codes: Map<string, { clientId: string; redirectUri: string; challenge: string; resource: string; scope: string | null }>;
  access: Map<string, { expiresAt: number }>;
  refresh: Map<string, { clientId: string }>;
  revoked: string[];
  grants: { grant: string; resource: string | null }[];
};

export type FakeMcpServer = {
  url: string;
  host: string;
  calls: { method: string; name?: string; args?: Record<string, unknown>; session: string | null; auth: string | null }[];
  notes: string[];
  oauth: FakeOAuthState;
  setTools(tools: FakeMcpTool[]): void;
  /** The sign-in page: checks the authorize URL as a server would and answers where the browser goes back to. */
  approve(authorizeUrl: string, o?: { deny?: boolean }): { redirect: string; code: string | null; state: string | null };
  /** Every access token expires now. */
  expireAccess(): void;
  /** Every refresh token stops working. */
  revokeAll(): void;
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
  const origin = `https://${host}`;
  const oauth: FakeOAuthState = { clients: new Map(), codes: new Map(), access: new Map(), refresh: new Map(), revoked: [], grants: [] };
  const ttl = (o.oauth?.accessTtlSeconds ?? 3600) * 1000;
  const token = () => randomBytes(18).toString("base64url");
  const server: FakeMcpServer = {
    url: `${origin}/mcp`, host, calls: [], notes: [], oauth,
    setTools: (t) => { tools = t; },
    approve(authorizeUrl, a = {}) {
      const q = new URL(authorizeUrl).searchParams;
      const clientId = q.get("client_id") ?? "";
      const redirectUri = q.get("redirect_uri") ?? "";
      const client = oauth.clients.get(clientId);
      if (!client || !client.redirectUris.includes(redirectUri)) throw new Error("fake sign-in: unknown client or redirect");
      if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) throw new Error("fake sign-in: PKCE S256 required");
      if (q.get("resource") !== server.url) throw new Error("fake sign-in: wrong resource");
      const back = new URL(redirectUri);
      const state = q.get("state");
      if (state) back.searchParams.set("state", state);
      if (a.deny) { back.searchParams.set("error", "access_denied"); return { redirect: back.toString(), code: null, state }; }
      const code = token();
      oauth.codes.set(code, { clientId, redirectUri, challenge: q.get("code_challenge")!, resource: q.get("resource")!, scope: q.get("scope") });
      back.searchParams.set("code", code);
      return { redirect: back.toString(), code, state };
    },
    expireAccess() { for (const v of oauth.access.values()) v.expiresAt = 0; },
    revokeAll() { for (const k of oauth.refresh.keys()) oauth.revoked.push(k); oauth.refresh.clear(); },
    stop: () => registerInProcessHost(host, null),
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const issue = (clientId: string) => {
    const access = token(); const refresh = token();
    oauth.access.set(access, { expiresAt: Date.now() + ttl });
    oauth.refresh.set(refresh, { clientId });
    return json(200, { access_token: access, token_type: "Bearer", expires_in: Math.round(ttl / 1000), refresh_token: refresh });
  };
  const oauthRoute = (url: URL, init: RequestInit): Response | null => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return json(200, { resource: server.url, authorization_servers: [origin], scopes_supported: o.oauth?.scopes ?? ["notes:read", "notes:write"] });
    }
    if (method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: origin, authorization_endpoint: o.oauth?.authorizeUrl ?? `${origin}/authorize`, token_endpoint: `${origin}/token`,
        ...(o.oauth?.registration === false ? {} : { registration_endpoint: `${origin}/register` }), revocation_endpoint: `${origin}/revoke`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
      });
    }
    if (method === "POST" && url.pathname === "/register") {
      let b: { redirect_uris?: unknown };
      try { b = JSON.parse(String(init.body ?? "")); } catch { return json(400, { error: "invalid_client_metadata" }); }
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
      if (!uris.length) return json(400, { error: "invalid_redirect_uri" });
      const clientId = `fake-client-${oauth.clients.size + 1}`;
      oauth.clients.set(clientId, { redirectUris: uris });
      return json(201, { client_id: clientId, token_endpoint_auth_method: "none", redirect_uris: uris });
    }
    if (method === "POST" && (url.pathname === "/token" || url.pathname === "/revoke")) {
      const f = new URLSearchParams(String(init.body ?? ""));
      if (url.pathname === "/revoke") {
        const t = f.get("token") ?? "";
        oauth.revoked.push(t); oauth.refresh.delete(t); oauth.access.delete(t);
        return new Response(null, { status: 200 });
      }
      const grant = f.get("grant_type") ?? "";
      oauth.grants.push({ grant, resource: f.get("resource") });
      if (f.get("resource") !== server.url) return json(400, { error: "invalid_target" });
      if (grant === "authorization_code") {
        const c = oauth.codes.get(f.get("code") ?? "");
        if (!c) return json(400, { error: "invalid_grant" });
        oauth.codes.delete(f.get("code")!);
        const verifier = f.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
        if (c.clientId !== f.get("client_id") || c.redirectUri !== f.get("redirect_uri") || challenge !== c.challenge) return json(400, { error: "invalid_grant" });
        return issue(c.clientId);
      }
      if (grant === "refresh_token") {
        const r = oauth.refresh.get(f.get("refresh_token") ?? "");
        if (!r || r.clientId !== f.get("client_id")) return json(400, { error: "invalid_grant" });
        oauth.refresh.delete(f.get("refresh_token")!);
        return issue(r.clientId);
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    return null;
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
    if (o.oauth) {
      const answered = oauthRoute(url, init);
      if (answered) return answered;
    }
    if (url.pathname !== "/mcp") return new Response("not here", { status: 404 });
    if (o.key && auth !== `Bearer ${o.key}`) return new Response("no", { status: 401 });
    if (o.oauth) {
      const t = oauth.access.get(/^Bearer (.+)$/.exec(auth ?? "")?.[1] ?? "");
      if (!t || t.expiresAt <= Date.now()) {
        return new Response("sign in", { status: 401, headers: { "www-authenticate": `Bearer realm="fake", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"` } });
      }
    }
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
 * answers in this process with the fake's two tools and no key, and https://mcp-oauth.fake.test/mcp the same after
 * signing in, its sign-in page being /api/dev/mcp-authorize on this app (which approves at once), so the Settings screens
 * and Brenda can be tried locally.
 */
let devFake: FakeMcpServer | null = null;
let devOAuthFake: FakeMcpServer | null = null;
export const DEV_AUTHORIZE_PATH = "/api/dev/mcp-authorize";
export function devFakeMcp(): void {
  if (devFake || process.env.MCP_FAKE !== "1" || process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return;
  devFake = startFakeMcpServer();
  const origin = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
  devOAuthFake = startFakeMcpServer({ host: "mcp-oauth.fake.test", oauth: { authorizeUrl: `${origin}${DEV_AUTHORIZE_PATH}` } });
}

/** The development sign-in fake (null outside development with MCP_FAKE=1). */
export function devOAuthFakeMcp(): FakeMcpServer | null {
  devFakeMcp();
  return devOAuthFake;
}
