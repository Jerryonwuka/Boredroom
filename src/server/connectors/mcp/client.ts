/**
 * A small MCP client over Streamable HTTP (owner decisions, 4 November 2026: MCP servers, phase 1; no SDK, so the limits
 * stay ours). It speaks only what Brenda needs: `initialize` (then `notifications/initialized`), `tools/list` and
 * `tools/call`, with JSON or event-stream answers. Every request goes through the outbound guard (guard.ts: https, public
 * addresses only, no redirects) and:
 * - the whole call, initialize included, has one deadline (20 s by default);
 * - an answer is read up to 5 MB, and an event stream only until the answer to our request arrives;
 * - a server's own requests and notifications in a stream are ignored (no sampling, no elicitation, no roots);
 * - a session id is kept in memory for 5 minutes per server, and a 404 on it starts a new session once;
 * - errors carry a code and never a key, a header or a body.
 * Server-only.
 */
import { createHash } from "node:crypto";
import { BlockedAddress, guardedFetch } from "./guard";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_CALL_TIMEOUT_MS = 20_000;
export const MCP_MAX_BYTES = 5 * 1024 * 1024;
export const MCP_MAX_TOOLS = 200;
export const MCP_MAX_DESCRIPTION = 4000;
export const MCP_MAX_SCHEMA_BYTES = 32_000;
export const MCP_RESULT_CHARS = 20_000;
const SESSION_TTL_MS = 5 * 60_000;
const MAX_PAGES = 10;
const CLIENT_INFO = { name: "Boredroom", version: "1.0.0" };

export type McpErrorCode =
  | "BLOCKED_ADDRESS" | "TIMEOUT" | "TOO_LARGE" | "AUTH_FAILED" | "NOT_FOUND" | "RATE_LIMITED" | "SERVER_DOWN" | "REDIRECTED"
  | "BAD_RESPONSE" | "PROTOCOL";

/** `message` is for logs and is never shown; people see words chosen from `code`. */
export class McpError extends Error {
  constructor(public readonly code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpError";
  }
}

export type McpAuth = { kind: "none" } | { kind: "bearer"; key: string } | { kind: "header"; name: string; value: string };
export type McpServerRef = { id: string; url: string; auth: McpAuth };

export type McpToolInfo = {
  name: string; title: string | null; description: string; inputSchema: Record<string, unknown>;
  readOnlyHint: boolean | null; destructiveHint: boolean | null; hash: string;
};

export type McpCallResult = { isError: boolean; text: string; truncated: boolean };

// ---- Hashing a tool ---------------------------------------------------------------------------------------------------------

/** JSON with object keys sorted, so the same tool always hashes the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** What an admin approves: the tool's name, title, full description and input shape. */
export function toolHash(t: { name: string; title: string | null; description: string; inputSchema: unknown }): string {
  return createHash("sha256").update(stableJson({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema }), "utf8").digest("hex");
}

// ---- Sessions ------------------------------------------------------------------------------------------------------------

type Session = { id: string | null; version: string; label: string | null; until: number };
const sessions = new Map<string, Session>();
const sessionKey = (s: McpServerRef) => createHash("sha256").update(`${s.id}\n${s.url}\n${stableJson(s.auth)}`).digest("hex");

/** Tests only. */
export function forgetMcpSessions(): void {
  sessions.clear();
}

// ---- One request ------------------------------------------------------------------------------------------------------------

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; result?: unknown; error?: { code?: number; message?: string } };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const TOOL_NAME = /^[A-Za-z0-9_./-]{1,128}$/;
const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(CONTROL, "").trim().slice(0, max) : "");

function authHeaders(auth: McpAuth): Record<string, string> {
  if (auth.kind === "bearer") return { authorization: `Bearer ${auth.key}` };
  if (auth.kind === "header") return { [auth.name.toLowerCase()]: auth.value };
  return {};
}

function statusError(status: number): McpError {
  if (status === 401 || status === 403) return new McpError("AUTH_FAILED", `HTTP ${status}`);
  if (status === 404) return new McpError("NOT_FOUND", "HTTP 404");
  if (status === 429) return new McpError("RATE_LIMITED", "HTTP 429");
  if (status >= 300 && status < 400) return new McpError("REDIRECTED", `HTTP ${status}`);
  if (status >= 500) return new McpError("SERVER_DOWN", `HTTP ${status}`);
  return new McpError("BAD_RESPONSE", `HTTP ${status}`);
}

/** Reads the answer to request `id`: one JSON message (or a batch), or events until it arrives. Capped. */
async function readAnswer(res: Response, id: number): Promise<RpcMessage> {
  if (Number(res.headers.get("content-length") ?? 0) > MCP_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new McpError("TOO_LARGE", "answer larger than the cap");
  }
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const sse = type.includes("text/event-stream");
  if (!sse && !type.includes("json")) {
    await res.body?.cancel().catch(() => undefined);
    throw new McpError("BAD_RESPONSE", "not JSON or an event stream");
  }
  if (!res.body) throw new McpError("BAD_RESPONSE", "no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  const mine = (m: unknown): RpcMessage | null => {
    const list = Array.isArray(m) ? m : [m];
    for (const x of list) if (x && typeof x === "object" && (x as RpcMessage).id === id && ("result" in x || "error" in x)) return x as RpcMessage;
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        size += value.byteLength;
        if (size > MCP_MAX_BYTES) throw new McpError("TOO_LARGE", "answer larger than the cap");
        text += decoder.decode(value, { stream: !done });
      }
      if (sse) {
        // Complete events end with a blank line; each event's data lines join with newlines.
        const events = text.replace(/\r\n?/g, "\n").split("\n\n");
        text = done ? "" : events.pop() ?? "";
        for (const ev of done ? events.filter(Boolean) : events) {
          const data = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
          if (!data) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { continue; }
          const m = mine(parsed);
          if (m) return m;
        }
        if (done) throw new McpError("BAD_RESPONSE", "the stream ended without an answer");
      } else if (done) {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new McpError("BAD_RESPONSE", "unreadable JSON"); }
        const m = mine(parsed);
        if (!m) throw new McpError("BAD_RESPONSE", "no answer to the request");
        return m;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new McpError("BAD_RESPONSE", "no answer");
}

type Wire = { server: McpServerRef; signal: AbortSignal };

async function post(w: Wire, session: Session | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    ...authHeaders(w.server.auth),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(session ? { "mcp-protocol-version": session.version } : {}),
    ...(session?.id ? { "mcp-session-id": session.id } : {}),
  };
  try {
    return await guardedFetch(w.server.url, { method: "POST", headers, body: JSON.stringify(body), signal: w.signal });
  } catch (err) {
    if (err instanceof BlockedAddress) throw new McpError("BLOCKED_ADDRESS", err.message);
    if (w.signal.aborted) throw new McpError("TIMEOUT", "the server took too long");
    throw new McpError("SERVER_DOWN", (err as { code?: string })?.code ?? "connection failed");
  }
}

let nextId = 1;

async function rpc(w: Wire, session: Session | null, method: string, params: unknown): Promise<{ result: unknown; res: Response }> {
  const id = nextId++;
  const res = await post(w, session, { jsonrpc: "2.0", id, method, params });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw statusError(res.status);
  }
  let m: RpcMessage;
  try { m = await readAnswer(res, id); }
  catch (err) {
    if (w.signal.aborted && !(err instanceof McpError && err.code === "TOO_LARGE")) throw new McpError("TIMEOUT", "the server took too long");
    throw err;
  }
  if (m.error) throw new McpError("PROTOCOL", `JSON-RPC ${m.error.code ?? "?"}`);
  return { result: m.result, res };
}

async function startSession(w: Wire): Promise<Session> {
  const { result, res } = await rpc(w, null, "initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
  const r = (result ?? {}) as { protocolVersion?: unknown; serverInfo?: { name?: unknown; title?: unknown; version?: unknown } };
  if (typeof r.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.protocolVersion)) throw new McpError("PROTOCOL", "no protocol version");
  const sid = res.headers.get("mcp-session-id");
  const name = clean(r.serverInfo?.title ?? r.serverInfo?.name, 120);
  const version = clean(r.serverInfo?.version, 40);
  const label = name ? (version ? `${name} ${version}` : name) : null;
  const s: Session = { id: sid && /^[\x21-\x7e]{1,200}$/.test(sid) ? sid : null, version: r.protocolVersion, label, until: Date.now() + SESSION_TTL_MS };
  const note = await post(w, s, { jsonrpc: "2.0", method: "notifications/initialized" });
  await note.body?.cancel().catch(() => undefined);
  if (!note.ok) throw statusError(note.status);
  return s;
}

/** Runs `fn` with a session (kept or new); a 404 on a kept session starts a new one, once. Labels come from initialize. */
async function withSession<T>(server: McpServerRef, timeoutMs: number, fn: (w: Wire, s: Session) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, 60_000)));
  const w: Wire = { server, signal };
  const key = sessionKey(server);
  const kept = sessions.get(key);
  if (kept && kept.until > Date.now()) {
    try { return await fn(w, kept); }
    catch (err) {
      if (!(err instanceof McpError && err.code === "NOT_FOUND" && kept.id)) throw err;
      sessions.delete(key);
    }
  }
  const s = await startSession(w);
  if (s.id) sessions.set(key, s);
  return fn(w, s);
}

// ---- Listing tools -----------------------------------------------------------------------------------------------------------


/** One listed tool as Boredroom keeps it, or null when it can't be (a bad name, an input shape too large). */
export function readTool(raw: unknown): McpToolInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { name?: unknown; title?: unknown; description?: unknown; inputSchema?: unknown; annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown; title?: unknown } };
  if (typeof t.name !== "string" || !TOOL_NAME.test(t.name)) return null;
  const schema = t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema) ? (t.inputSchema as Record<string, unknown>) : { type: "object" };
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MCP_MAX_SCHEMA_BYTES) return null;
  const title = clean(t.title ?? t.annotations?.title, 200) || null;
  const fullDescription = typeof t.description === "string" ? t.description : "";
  const hash = toolHash({ name: t.name, title, description: fullDescription, inputSchema: schema });
  const hint = (v: unknown) => (typeof v === "boolean" ? v : null);
  return {
    name: t.name, title, description: clean(fullDescription, MCP_MAX_DESCRIPTION), inputSchema: schema,
    readOnlyHint: hint(t.annotations?.readOnlyHint), destructiveHint: hint(t.annotations?.destructiveHint), hash,
  };
}

/**
 * The server's tools (up to 200, ten pages), its own name for itself (from initialize: shown to admins only, never to
 * Brenda), and how many listed tools couldn't be kept.
 */
export async function listTools(server: McpServerRef, o: { timeoutMs?: number } = {}): Promise<{ serverLabel: string | null; tools: McpToolInfo[]; skipped: number }> {
  return withSession(server, o.timeoutMs ?? MCP_CALL_TIMEOUT_MS, async (w, s) => {
    const tools: McpToolInfo[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { result } = await rpc(w, s, "tools/list", cursor ? { cursor } : {});
      const r = (result ?? {}) as { tools?: unknown; nextCursor?: unknown };
      if (!Array.isArray(r.tools)) throw new McpError("PROTOCOL", "no tools list");
      for (const raw of r.tools) {
        const t = readTool(raw);
        if (!t || seen.has(t.name) || tools.length >= MCP_MAX_TOOLS) { skipped++; continue; }
        seen.add(t.name);
        tools.push(t);
      }
      cursor = typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return { serverLabel: s.label, tools, skipped };
  });
}

// ---- Calling a tool --------------------------------------------------------------------------------------------------------

/** A tool's answer as text for Brenda: text blocks as they are, files and pictures named only, capped. */
export function resultText(result: unknown, maxChars = MCP_RESULT_CHARS): McpCallResult {
  const r = (result ?? {}) as { content?: unknown; structuredContent?: unknown; isError?: unknown };
  const parts: string[] = [];
  for (const b of Array.isArray(r.content) ? r.content : []) {
    const c = (b ?? {}) as { type?: unknown; text?: unknown; resource?: { text?: unknown; uri?: unknown }; uri?: unknown; name?: unknown };
    if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
    else if (c.type === "image") parts.push("[a picture, not shown]");
    else if (c.type === "audio") parts.push("[audio, not played]");
    else if (c.type === "resource" && typeof c.resource?.text === "string") parts.push(c.resource.text);
    else if (c.type === "resource") parts.push("[a file, not shown]");
    else if (c.type === "resource_link") parts.push(`[a link: ${clean(c.name, 200) || "file"}${typeof c.uri === "string" ? ` ${clean(c.uri, 500)}` : ""}]`);
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  const all = parts.join("\n\n").replace(CONTROL, "");
  const truncated = all.length > maxChars;
  return { isError: r.isError === true, text: truncated ? all.slice(0, maxChars) : all, truncated };
}

/** Calls one tool with `args`. A tool's own failure is `isError: true`; the transport's is an McpError. */
export async function callTool(server: McpServerRef, name: string, args: Record<string, unknown>, o: { timeoutMs?: number; maxChars?: number } = {}): Promise<McpCallResult> {
  if (!TOOL_NAME.test(name)) throw new McpError("PROTOCOL", "bad tool name");
  return withSession(server, o.timeoutMs ?? MCP_CALL_TIMEOUT_MS, async (w, s) => {
    const { result } = await rpc(w, s, "tools/call", { name, arguments: args });
    return resultText(result, o.maxChars);
  });
}
