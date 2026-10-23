/**
 * Connected apps: the only way Boredroom talks to a provider (owner decisions, 22 October 2026: connectors; spec §4.2,
 * §6, §15). Bound to one connection, it:
 * - calls only https URLs on the adapter's own `hosts` (SSRF guard), and follows a redirect only to another of them;
 * - injects the connection's token, refreshes it ahead of expiry (2 minutes) and once after a 401 (or an adapter's
 *   "token expired" answer), then gives up with REAUTH_REQUIRED;
 * - honours 429 and Retry-After (capped at an hour): the connection's `backoff_until` is set and RATE_LIMITED thrown;
 * - spends a shared budget (Jira's global points pool) and spaces requests (`limits.spacingMs`);
 * - times out (10 s by default, 30 s at most), caps a response at 5 MB, and never puts a token or a body in an error.
 *
 * Test seam: `setConnectorFetchForTests(fetchImpl | null)`. Under NODE_ENV=test a call with no mock installed throws
 * `unmocked provider call: METHOD host/path`, so no test can reach a real provider. Server-only.
 */
import { ConnectorError, type ConnectionRef, type ConnectorErrorCode, type HttpRequest, type HttpResponse, type ProviderAdapter, type ProviderHttp } from "./types";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 30_000;
export const MAX_RETRY_AFTER_SECONDS = 3600;
const REFRESH_AHEAD_MS = 2 * 60_000;
const MAX_REDIRECTS = 3;

// ---- The fetch seam ---------------------------------------------------------------------------------------------------

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;
let testFetch: FetchImpl | null = null;

/** Tests only: every provider call goes to `impl` (null restores the real fetch outside tests). */
export function setConnectorFetchForTests(impl: FetchImpl | null): void {
  testFetch = impl;
}

/**
 * A host answered inside this process (framework, 22 October 2026: the fake provider's pretend API, so the whole
 * framework runs without a network or an account). Never outside development and tests.
 */
type InProcess = (url: URL, init: RequestInit) => Promise<Response>;
const inProcessHosts = new Map<string, InProcess>();
export function registerInProcessHost(host: string, handler: InProcess | null): void {
  if (handler) inProcessHosts.set(host.toLowerCase(), handler);
  else inProcessHosts.delete(host.toLowerCase());
}

/** The fetch every connector call uses. */
export function connectorFetch(url: string, init: RequestInit): Promise<Response> {
  if (process.env.NODE_ENV !== "production" && inProcessHosts.size) {
    try {
      const u = new URL(url);
      const h = inProcessHosts.get(u.hostname.toLowerCase());
      if (h) return h(u, init);
    } catch { /* not a URL: the real fetch refuses it */ }
  }
  if (testFetch) return testFetch(url, init);
  if (process.env.NODE_ENV === "test") {
    let where = url;
    try { const u = new URL(url); where = `${u.host}${u.pathname}`; } catch { /* as given */ }
    return Promise.reject(new Error(`unmocked provider call: ${(init.method ?? "GET").toUpperCase()} ${where}`));
  }
  return fetch(url, init);
}

// ---- Helpers ----------------------------------------------------------------------------------------------------------

/** True when `url` is https and its host is one of `hosts` (exact; a leading "*." allows subdomains). */
export function hostAllowed(url: string, hosts: readonly string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  return hosts.some((x) => {
    const want = x.toLowerCase();
    return want.startsWith("*.") ? h.endsWith(want.slice(1)) && h.length > want.length - 1 : h === want;
  });
}

/** Retry-After as seconds (a number or an HTTP date), capped; null when absent or unreadable. */
export function retryAfterSeconds(h: Headers | null | undefined, now: Date = new Date()): number | null {
  const v = h?.get("retry-after")?.trim();
  if (!v) return null;
  let s: number;
  if (/^\d+(\.\d+)?$/.test(v)) s = Math.ceil(Number(v));
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    s = Math.ceil((at - now.getTime()) / 1000);
  }
  return Math.max(1, Math.min(MAX_RETRY_AFTER_SECONDS, s));
}

export function withQuery(url: string, query?: HttpRequest["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Reads at most MAX_RESPONSE_BYTES; more is TOO_LARGE. */
async function readCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConnectorError("TOO_LARGE", "response larger than the cap");
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new ConnectorError("TOO_LARGE", "response larger than the cap"); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

function parseBody(bytes: Uint8Array, expect: HttpRequest["expect"], contentType: string | null): unknown {
  if (expect === "none") return null;
  const text = new TextDecoder().decode(bytes);
  if (expect === "text") return text;
  if (!text.trim()) return null;
  // JSON by default; a non-JSON body (an HTML error page) is kept as text for interpret, never shown.
  try { return JSON.parse(text); } catch { return contentType?.includes("json") ? null : text; }
}

/** The fixed code for a status (after 401 and 429, which are handled first). */
export function statusCode(status: number): ConnectorErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return "REAUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 409 || status === 412) return "CONFLICT";
  if (status === 413) return "TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_DOWN";
  return "BAD_RESPONSE";
}

const describe = (req: { method?: string; url: string }) => {
  try { const u = new URL(req.url); return `${(req.method ?? "GET").toUpperCase()} ${u.host}${u.pathname}`; } catch { return "request"; }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- One raw call (no connection: token endpoints, the fake) ---------------------------------------------------------

export type RawResult = HttpResponse<unknown>;

/**
 * One request to a provider host, with the guard, the timeout, the cap and redirects only within `hosts`. Throws
 * PROVIDER_DOWN on a timeout or a network failure, TOO_LARGE past the cap, NOT_ALLOWED for a host outside the list.
 * The status is returned as it is: mapping is the caller's.
 */
export async function rawRequest(hosts: readonly string[], req: HttpRequest & { authorization?: string }): Promise<RawResult> {
  let url = withQuery(req.url, req.query);
  if (!hostAllowed(url, hosts)) throw new ConnectorError("NOT_ALLOWED", `host not allowed: ${describe({ method: req.method, url })}`);
  const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1000, req.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "Boredroom-Connectors/1", ...(req.headers ?? {}) };
  let body: string | undefined;
  if (req.json !== undefined) { body = JSON.stringify(req.json); headers["content-type"] ??= "application/json"; }
  else if (req.form) { body = new URLSearchParams(req.form).toString(); headers["content-type"] ??= "application/x-www-form-urlencoded"; }
  if (req.authorization) headers.authorization = req.authorization;
  const method = req.method ?? "GET";
  for (let hop = 0; ; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res: Response;
    try {
      res = await connectorFetch(url, { method, headers, body, redirect: "manual", signal: ctl.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.message.startsWith("unmocked provider call")) throw err;
      throw new ConnectorError("PROVIDER_DOWN", `${describe({ method, url })} did not answer`);
    }
    try {
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => undefined);
        const next = new URL(res.headers.get("location")!, url).toString();
        if (hop >= MAX_REDIRECTS || !hostAllowed(next, hosts)) throw new ConnectorError("BAD_RESPONSE", `redirect refused: ${describe({ method, url })}`);
        url = next;
        continue;
      }
      const bytes = await readCapped(res);
      return { status: res.status, headers: res.headers, body: parseBody(bytes, req.expect, res.headers.get("content-type")) };
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError("PROVIDER_DOWN", `${describe({ method, url })} broke off`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---- Bound to a connection --------------------------------------------------------------------------------------------

/** What the client needs from the database; replaced in unit tests. */
export type HttpDeps = {
  /** The current access token and its expiry, or null (none stored). */
  token(): Promise<{ accessToken: string; expiresAt: Date | null } | null>;
  /** A fresh access token (`force`: after a 401). Throws ConnectorError REAUTH_REQUIRED when the app refuses. */
  refresh(force: boolean): Promise<string>;
  /** The connection must wait `seconds` (Retry-After or the default). */
  backoff(seconds: number): Promise<void>;
  /** Spend `cost` points from a shared bucket; throws RATE_LIMITED when it is empty. */
  spend?(bucket: string, cost: number, capPerHour: number): Promise<void>;
  now?(): Date;
};

const lastCall = new Map<string, number>();

/** The default dependencies (tokens.ts, budget.ts), loaded lazily so this module stays light for unit tests. */
async function defaultDeps(conn: ConnectionRef): Promise<HttpDeps> {
  const [{ currentToken, refreshTokens, setBackoff }, { spend }] = await Promise.all([import("./tokens"), import("./budget")]);
  return {
    token: () => currentToken(conn.id),
    refresh: (force) => refreshTokens(conn.id, { force }).then((t) => t.accessToken),
    backoff: (seconds) => setBackoff(conn.id, seconds),
    spend,
  };
}

export function httpFor(conn: ConnectionRef, adapter: ProviderAdapter, deps?: HttpDeps): ProviderHttp {
  let resolved: HttpDeps | null = deps ?? null;
  const getDeps = async () => (resolved ??= await defaultDeps(conn));
  return {
    async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
      const d = await getDeps();
      const now = () => d.now?.() ?? new Date();
      const auth = req.auth ?? "bearer";
      // Budget first (Jira's global pool), then spacing.
      const budget = adapter.limits?.budget;
      if (budget && d.spend) await d.spend(budget.bucket, Math.max(1, Math.round(req.cost ?? 1)), budget.capPerHour);
      const spacing = adapter.limits?.spacingMs ?? 0;
      if (spacing > 0) {
        const key = conn.id;
        const wait = (lastCall.get(key) ?? 0) + spacing - Date.now();
        if (wait > 0) await sleep(Math.min(wait, spacing));
        lastCall.set(key, Date.now());
      }
      let token: string | null = null;
      if (auth === "bearer") {
        const t = await d.token();
        if (!t) throw new ConnectorError("REAUTH_REQUIRED", "no token stored");
        token = t.expiresAt && t.expiresAt.getTime() - now().getTime() < REFRESH_AHEAD_MS ? await d.refresh(false) : t.accessToken;
      }
      for (let attempt = 0; ; attempt++) {
        const res = await rawRequest(adapter.hosts, { ...req, ...(token ? { authorization: `Bearer ${token}` } : {}) });
        const interpreted = safeInterpret(adapter, res);
        const authFailed = res.status === 401 || interpreted?.code === "REAUTH_REQUIRED";
        if (authFailed && auth === "bearer") {
          if (attempt === 0) { token = await d.refresh(true); continue; }
          throw new ConnectorError("REAUTH_REQUIRED", `${describe(req)} refused the token after a refresh`);
        }
        const limited = res.status === 429 || interpreted?.code === "RATE_LIMITED";
        if (limited) {
          const seconds = retryAfterSeconds(res.headers, now()) ?? interpreted?.retryAfterSeconds ?? 60;
          await d.backoff(Math.min(MAX_RETRY_AFTER_SECONDS, seconds)).catch(() => undefined);
          throw new ConnectorError("RATE_LIMITED", `${describe(req)} rate limited`, Math.min(MAX_RETRY_AFTER_SECONDS, seconds));
        }
        if (interpreted) throw interpreted;
        const code = statusCode(res.status);
        if (code) throw new ConnectorError(code, `${describe(req)} answered ${res.status}`);
        return res as HttpResponse<T>;
      }
    },
  };
}

/** An adapter's interpret, never trusted to throw or to leak: its message is replaced by ours. */
function safeInterpret(adapter: ProviderAdapter, res: HttpResponse<unknown>): ConnectorError | null {
  if (!adapter.interpret) return null;
  try {
    const e = adapter.interpret(res);
    return e ? new ConnectorError(e.code, `provider answered ${res.status} (${e.code})`, e.retryAfterSeconds) : null;
  } catch {
    return null;
  }
}
