/**
 * Signing in to an MCP server (owner request, 4 November 2026: phase 1b), as the MCP authorization spec (2025-06-18) asks:
 * - finding where it signs in: the server's 401 names its protected resource metadata (RFC 9728) in WWW-Authenticate, or
 *   the standard addresses hold it; that names the authorization server, whose metadata (RFC 8414, or OpenID's) gives
 *   the endpoints. A server from before that spec (no resource metadata) signs in at its own origin;
 * - Boredroom registers itself as a public client (RFC 7591) where the server allows it, or uses a client id (and
 *   secret) the admin gave;
 * - tokens: PKCE S256 and the resource indicator (RFC 8707) on every grant; sealed to their row and field; refreshed
 *   under an advisory lock when they have under 2 minutes left (or after a 401), and a refused refresh asks an admin to
 *   sign in again (SIGN_IN_NEEDED) rather than failing quietly.
 * Every request goes through the outbound guard (https, public addresses, no redirects) with a 10-second deadline and a
 * 256 KB cap; only the page the admin's browser opens may be http, on this app's own origin in development (the fake).
 * Nothing secret is logged or returned. Server-only.
 */
import type { Db } from "@/server/db";
import { readCapped } from "../http";
import { openToken, sealToken } from "../crypto";
import { appOrigin } from "../env";
import { BlockedAddress, checkServerUrl, guardedFetch } from "./guard";
import { MCP_PROTOCOL_VERSION, McpError } from "./client";
import { devFakeMcp } from "./fake";

export const MCP_STATE_COOKIE = "boredroom_mcp";
export const MCP_CALLBACK_PATH = "/api/connectors/mcp/callback";
export const mcpRedirectUri = (source: NodeJS.ProcessEnv = process.env) => `${appOrigin(source)}${MCP_CALLBACK_PATH}`;
const FETCH_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 20_000;
const META_MAX_BYTES = 256 * 1024;
const REFRESH_AHEAD_MS = 2 * 60_000;
const MAX_URL = 500;

export type OAuthField = "access" | "refresh" | "client";
export const oauthAad = (serverId: string, field: OAuthField) => `mcp-oauth:${serverId}:${field}`;
export const mcpStateAad = (stateId: string) => `mcp-oauth-state:${stateId}`;

/** Why a server can't be signed in to; people see words chosen by code (lib/mcp/words MCP_SIGN_IN_ERRORS). */
export type SignInProblem = "NO_SIGN_IN" | "NO_PKCE" | "NO_REGISTRATION" | "REGISTRATION_FAILED";
export class SignInError extends Error {
  constructor(public readonly code: SignInProblem, message: string) {
    super(message);
    this.name = "SignInError";
  }
}

export type Discovery = {
  issuer: string; authorizeUrl: string; tokenUrl: string; registrationUrl: string | null; revocationUrl: string | null;
  resource: string; scopes: string | null;
};

// ---- Reading what servers say ---------------------------------------------------------------------------------------------

/** The Bearer challenge's parameters (RFC 6750 §3), lower-cased names; empty when it isn't one. */
export function parseWwwAuthenticate(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const m = /(?:^|,\s*)Bearer(?:\s+(.*))?$/i.exec(header.trim()) ?? /^Bearer\b(.*)$/i.exec(header.trim());
  if (!m) return out;
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  for (let p = re.exec(m[1] ?? ""); p; p = re.exec(m[1] ?? "")) {
    const name = p[1].toLowerCase();
    if (!(name in out)) out[name] = p[2] !== undefined ? p[2].replace(/\\(.)/g, "$1") : p[3];
  }
  return out;
}

const pathOf = (u: URL) => (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));

/** Where a server's protected resource metadata may be (RFC 9728 §3.1): with its path, then at the root. */
export function resourceMetadataUrls(serverUrl: string): string[] {
  const u = new URL(serverUrl);
  const path = pathOf(u);
  return [...new Set([`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`])];
}

/** Where an authorization server's metadata may be (RFC 8414 §3.1 and OpenID Discovery, as the MCP spec orders them). */
export function authServerMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = pathOf(u);
  return path
    ? [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`]
    : [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= MAX_URL ? v : null);

/** An endpoint Boredroom's server calls: it must pass the outbound guard's address check. */
function serverEndpoint(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try { return checkServerUrl(s).toString(); } catch { return null; }
}

/** The page the admin's browser opens: https without a user or password, or this app's own origin in development. */
export function browserEndpoint(v: unknown, source: NodeJS.ProcessEnv = process.env): string | null {
  const s = str(v);
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password || u.hash) return null;
  if (u.protocol === "https:") return u.toString();
  return source.NODE_ENV !== "production" && u.origin === appOrigin(source) ? u.toString() : null;
}

/** Checks authorization server metadata against the issuer it was asked for; the endpoints, or null. */
export function readAuthServerMetadata(meta: Record<string, unknown>, issuer: string): Omit<Discovery, "resource" | "scopes"> | null {
  if (typeof meta.issuer === "string" && !sameUrl(meta.issuer, issuer)) return null;
  const authorizeUrl = browserEndpoint(meta.authorization_endpoint);
  const tokenUrl = serverEndpoint(meta.token_endpoint);
  if (!authorizeUrl || !tokenUrl) return null;
  const types = meta.response_types_supported;
  if (Array.isArray(types) && !types.includes("code")) return null;
  const methods = meta.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) throw new SignInError("NO_PKCE", "S256 not offered");
  return {
    issuer: str(meta.issuer) ?? issuer, authorizeUrl, tokenUrl,
    registrationUrl: serverEndpoint(meta.registration_endpoint), revocationUrl: serverEndpoint(meta.revocation_endpoint),
  };
}

// ---- Requests -------------------------------------------------------------------------------------------------------------

async function bodyJson(res: Response): Promise<Record<string, unknown> | null> {
  let bytes: Uint8Array;
  try { bytes = await readCapped(res, META_MAX_BYTES); } catch { return null; }
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

const deadline = (ms: number, outer?: AbortSignal) => (outer ? AbortSignal.any([outer, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/** GET a JSON object; null when it isn't there (any status but 200, unreadable). A blocked address throws. */
async function getJson(url: string, outer?: AbortSignal): Promise<Record<string, unknown> | null> {
  let res: Response;
  try { res = await guardedFetch(url, { method: "GET", headers: { accept: "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION }, signal: deadline(FETCH_TIMEOUT_MS, outer) }); }
  catch (err) { if (err instanceof BlockedAddress) throw err; return null; }
  if (res.status !== 200) { await res.body?.cancel().catch(() => undefined); return null; }
  return bodyJson(res);
}

/** POST a form or JSON; the status and the JSON body (null when unreadable). Network failures throw McpError. */
async function post(url: string, body: { form?: Record<string, string>; json?: unknown }, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    res = await guardedFetch(url, {
      method: "POST", signal,
      headers: { accept: "application/json", "content-type": body.json !== undefined ? "application/json" : "application/x-www-form-urlencoded", ...headers },
      body: body.json !== undefined ? JSON.stringify(body.json) : new URLSearchParams(body.form ?? {}).toString(),
    });
  } catch (err) {
    if (err instanceof BlockedAddress) throw new McpError("BLOCKED_ADDRESS", err.message);
    if (signal.aborted) throw new McpError("TIMEOUT", "the sign-in service took too long");
    throw new McpError("SERVER_DOWN", (err as { code?: string })?.code ?? "connection failed");
  }
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel().catch(() => undefined); throw new McpError("REDIRECTED", `HTTP ${res.status}`); }
  return { status: res.status, body: await bodyJson(res) };
}

// ---- Finding where a server signs in ------------------------------------------------------------------------------------------

/** The server's 401 challenge, asked without a key (an initialize, as a client would start). */
async function challenge(serverUrl: string, signal: AbortSignal): Promise<Record<string, string> | null> {
  let res: Response;
  try {
    res = await guardedFetch(serverUrl, {
      method: "POST", signal,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Boredroom", version: "1.0.0" } } }),
    });
  } catch (err) { if (err instanceof BlockedAddress) throw err; return null; }
  await res.body?.cancel().catch(() => undefined);
  return res.status === 401 ? parseWwwAuthenticate(res.headers.get("www-authenticate")) : null;
}

/**
 * Where `serverUrl` signs in, or SignInError NO_SIGN_IN. A BlockedAddress (the server's, or an address its metadata
 * names) throws as it is.
 */
export async function discover(serverUrl: string): Promise<Discovery> {
  devFakeMcp();
  const server = checkServerUrl(serverUrl).toString();
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const asked = await challenge(server, signal);
  const wa = asked ?? {};
  let prm: Record<string, unknown> | null = null;
  const named = wa.resource_metadata ? serverEndpoint(wa.resource_metadata) : null;
  for (const url of named ? [named] : resourceMetadataUrls(server)) {
    prm = await getJson(url, signal);
    if (prm) break;
  }
  let resource = server;
  let issuers: string[];
  if (prm) {
    const r = str(prm.resource);
    // The metadata must be about this server (RFC 9728 §3.3): its resource on the same origin.
    if (r) {
      let ru: URL;
      try { ru = new URL(r); } catch { throw new SignInError("NO_SIGN_IN", "unreadable resource"); }
      if (ru.origin !== new URL(server).origin) throw new SignInError("NO_SIGN_IN", "resource for another server");
      resource = ru.toString();
    }
    issuers = (Array.isArray(prm.authorization_servers) ? prm.authorization_servers : []).map(serverEndpoint).filter((x): x is string => !!x);
    if (!issuers.length) throw new SignInError("NO_SIGN_IN", "no authorization server");
  } else {
    // A server from before resource metadata signs in at its own origin, but only one that asked for it with a 401
    // (an address that isn't an MCP server at all doesn't borrow its origin's sign-in).
    if (!asked) throw new SignInError("NO_SIGN_IN", "no 401 and no resource metadata");
    issuers = [new URL(server).origin];
  }
  for (const issuer of issuers.slice(0, 3)) {
    for (const url of authServerMetadataUrls(issuer)) {
      const meta = await getJson(url, signal);
      if (!meta) continue;
      const ends = readAuthServerMetadata(meta, issuer);
      if (!ends) continue;
      const scopes = (wa.scope ?? (Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string").join(" ") : ""))
        .replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 1000);
      return { ...ends, resource, scopes: scopes || null };
    }
  }
  throw new SignInError("NO_SIGN_IN", "no authorization server metadata");
}

// ---- The client --------------------------------------------------------------------------------------------------------------

export type ClientAuth = "none" | "client_secret_post" | "client_secret_basic";
export type OAuthClient = { clientId: string; clientSecret: string | null; clientAuth: ClientAuth };

/** Registers Boredroom as a client (RFC 7591), asking to be public (PKCE, no secret). */
export async function registerClient(registrationUrl: string, redirectUri = mcpRedirectUri()): Promise<OAuthClient> {
  devFakeMcp();
  const res = await post(registrationUrl, { json: {
    client_name: "Boredroom", client_uri: appOrigin(), redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  } });
  const b = res.body ?? {};
  const clientId = typeof b.client_id === "string" && b.client_id.length <= 500 && !/[\u0000-\u001f\u007f]/.test(b.client_id) ? b.client_id : null;
  if (res.status >= 300 || !clientId) throw new SignInError("REGISTRATION_FAILED", `registration answered ${res.status}`);
  const secret = typeof b.client_secret === "string" && b.client_secret ? b.client_secret : null;
  const method = b.token_endpoint_auth_method;
  return {
    clientId, clientSecret: secret,
    clientAuth: !secret ? "none" : method === "client_secret_basic" ? "client_secret_basic" : "client_secret_post",
  };
}

// ---- Stored sign-in -------------------------------------------------------------------------------------------------------------

type OAuthRow = {
  server_id: string; organisation_id: string; issuer: string; authorize_url: string; token_url: string; registration_url: string | null;
  revocation_url: string | null; resource: string; scopes: string | null; client_id: string | null; client_secret_enc: string | null;
  client_auth: ClientAuth; client_registered: boolean; access_enc: string | null; refresh_enc: string | null; expires_at: string | null;
};
const OAUTH_COLUMNS = "server_id, organisation_id, issuer, authorize_url, token_url, registration_url, revocation_url, resource, scopes, client_id, client_secret_enc, client_auth, client_registered, access_enc, refresh_enc, expires_at";

export async function loadOAuth(db: Db, serverId: string): Promise<OAuthRow | null> {
  return db.maybeOne<OAuthRow>(`SELECT ${OAUTH_COLUMNS} FROM mcp_server_oauth WHERE server_id = $1`, [serverId]);
}

/**
 * Stores where a server signs in (worker context). A client the admin gave replaces the stored one; a changed sign-in
 * service drops a registered client and the tokens, which belonged to the old one.
 */
export async function saveDiscovery(db: Db, orgId: string, serverId: string, d: Discovery, client: OAuthClient | null): Promise<void> {
  const secret = client?.clientSecret ? sealToken(client.clientSecret, oauthAad(serverId, "client")) : null;
  await db.query(
    `INSERT INTO mcp_server_oauth(server_id, organisation_id, issuer, authorize_url, token_url, registration_url, revocation_url, resource, scopes, client_id, client_secret_enc, client_auth, client_registered)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)
     ON CONFLICT (server_id) DO UPDATE SET issuer = EXCLUDED.issuer, authorize_url = EXCLUDED.authorize_url, token_url = EXCLUDED.token_url,
       registration_url = EXCLUDED.registration_url, revocation_url = EXCLUDED.revocation_url, resource = EXCLUDED.resource, scopes = EXCLUDED.scopes,
       client_id = CASE WHEN $10::text IS NOT NULL THEN EXCLUDED.client_id WHEN mcp_server_oauth.issuer = EXCLUDED.issuer THEN mcp_server_oauth.client_id END,
       client_secret_enc = CASE WHEN $10::text IS NOT NULL THEN EXCLUDED.client_secret_enc WHEN mcp_server_oauth.issuer = EXCLUDED.issuer THEN mcp_server_oauth.client_secret_enc END,
       client_auth = CASE WHEN $10::text IS NOT NULL THEN EXCLUDED.client_auth WHEN mcp_server_oauth.issuer = EXCLUDED.issuer THEN mcp_server_oauth.client_auth ELSE 'none' END,
       client_registered = CASE WHEN $10::text IS NOT NULL THEN false ELSE mcp_server_oauth.client_registered AND mcp_server_oauth.issuer = EXCLUDED.issuer END,
       access_enc = CASE WHEN mcp_server_oauth.issuer = EXCLUDED.issuer AND $10::text IS NULL THEN mcp_server_oauth.access_enc END,
       refresh_enc = CASE WHEN mcp_server_oauth.issuer = EXCLUDED.issuer AND $10::text IS NULL THEN mcp_server_oauth.refresh_enc END,
       expires_at = CASE WHEN mcp_server_oauth.issuer = EXCLUDED.issuer AND $10::text IS NULL THEN mcp_server_oauth.expires_at END`,
    [serverId, orgId, d.issuer, d.authorizeUrl, d.tokenUrl, d.registrationUrl, d.revocationUrl, d.resource, d.scopes,
      client?.clientId ?? null, secret, client ? client.clientAuth : "none"]);
}

export async function saveClient(db: Db, serverId: string, c: OAuthClient): Promise<void> {
  await db.query(`UPDATE mcp_server_oauth SET client_id = $2, client_secret_enc = $3, client_auth = $4, client_registered = true WHERE server_id = $1`,
    [serverId, c.clientId, c.clientSecret ? sealToken(c.clientSecret, oauthAad(serverId, "client")) : null, c.clientSecret ? c.clientAuth : "none"]);
}

export function clientOf(row: OAuthRow): OAuthClient | null {
  if (!row.client_id) return null;
  const secret = row.client_secret_enc ? openToken(row.client_secret_enc, oauthAad(row.server_id, "client")) : null;
  if (row.client_secret_enc && !secret) return null;
  return { clientId: row.client_id, clientSecret: secret, clientAuth: row.client_auth };
}

// ---- The token endpoint -----------------------------------------------------------------------------------------------------

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

/** One grant at the token endpoint with the client's authentication; the resource rides on every grant (RFC 8707). */
export async function tokenRequest(row: OAuthRow, client: OAuthClient, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> | null }> {
  devFakeMcp();
  const form: Record<string, string> = { ...params, resource: row.resource };
  const headers: Record<string, string> = {};
  if (client.clientAuth === "client_secret_basic" && client.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}`;
  } else {
    form.client_id = client.clientId;
    if (client.clientAuth === "client_secret_post" && client.clientSecret) form.client_secret = client.clientSecret;
  }
  return post(row.token_url, { form }, headers);
}

/** The tokens in a token endpoint's answer, or null when it has no usable bearer token. */
export function readTokens(body: Record<string, unknown> | null, now: Date = new Date()): Tokens | null {
  if (!body) return null;
  const access = body.access_token;
  if (typeof access !== "string" || !access || access.length > 8000 || /[\s\u0000-\u001f\u007f]/.test(access)) return null;
  if (body.token_type !== undefined && String(body.token_type).toLowerCase() !== "bearer") return null;
  const refresh = typeof body.refresh_token === "string" && body.refresh_token && body.refresh_token.length <= 8000 ? body.refresh_token : null;
  const secs = Number(body.expires_in);
  return { accessToken: access, refreshToken: refresh, expiresAt: Number.isFinite(secs) && secs > 0 ? new Date(now.getTime() + Math.min(secs, 400 * 86400) * 1000) : null };
}

/** Seals and stores tokens (worker context); a refresh that sends no new refresh token keeps the old one. */
export async function saveTokens(db: Db, serverId: string, t: Tokens, signedInBy?: string): Promise<void> {
  await db.query(
    `UPDATE mcp_server_oauth SET access_enc = $2, refresh_enc = COALESCE($3, CASE WHEN $5::uuid IS NULL THEN refresh_enc END), expires_at = $4,
       signed_in_by = COALESCE($5, signed_in_by), signed_in_at = CASE WHEN $5::uuid IS NULL THEN signed_in_at ELSE now() END WHERE server_id = $1`,
    [serverId, sealToken(t.accessToken, oauthAad(serverId, "access")), t.refreshToken ? sealToken(t.refreshToken, oauthAad(serverId, "refresh")) : null, t.expiresAt, signedInBy ?? null]);
}

/** Forgets the tokens and asks an admin to sign in again (worker context). */
export async function markSignInNeeded(db: Db, serverId: string): Promise<void> {
  await db.query(`UPDATE mcp_server_oauth SET access_enc = NULL, refresh_enc = NULL, expires_at = NULL WHERE server_id = $1`, [serverId]);
  await db.query(`UPDATE mcp_servers SET last_checked_at = now(), last_error_code = 'SIGN_IN_NEEDED',
    status = CASE WHEN status = 'paused' THEN status ELSE 'needs_attention' END WHERE id = $1`, [serverId]);
}

const refusedGrant = (status: number) => status === 400 || status === 401 || status === 403;

/**
 * A usable access token for the server (worker context), refreshed when it has under 2 minutes left or `force` (after a
 * 401). Refreshes are serialised per server, and a token another process refreshed meanwhile is used as it is. Null when
 * an admin has to sign in (again); a refused refresh records that. A sign-in service that is down throws McpError.
 */
export async function oauthAccess(db: Db, serverId: string, o: { force?: boolean; now?: Date } = {}): Promise<string | null> {
  const now = o.now ?? new Date();
  const fresh = (r: OAuthRow) => !!r.access_enc && (!r.expires_at || new Date(r.expires_at).getTime() - now.getTime() > REFRESH_AHEAD_MS);
  const first = await loadOAuth(db, serverId);
  if (!first?.access_enc && !first?.refresh_enc) return null;
  if (!o.force && fresh(first)) return openToken(first.access_enc, oauthAad(serverId, "access"));
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('mcp-oauth-refresh:' || $1::text, 0))`, [serverId]);
  const row = await loadOAuth(db, serverId);
  if (!row) return null;
  // Another process refreshed while this one waited.
  if (row.access_enc && row.access_enc !== first.access_enc && fresh(row)) return openToken(row.access_enc, oauthAad(serverId, "access"));
  if (!o.force && fresh(row)) return openToken(row.access_enc, oauthAad(serverId, "access"));
  const refresh = row.refresh_enc ? openToken(row.refresh_enc, oauthAad(serverId, "refresh")) : null;
  const client = clientOf(row);
  if (!refresh || !client) {
    const stillGood = !o.force && row.access_enc && (!row.expires_at || new Date(row.expires_at).getTime() > now.getTime());
    if (stillGood) return openToken(row.access_enc, oauthAad(serverId, "access"));
    await markSignInNeeded(db, serverId);
    return null;
  }
  const res = await tokenRequest(row, client, { grant_type: "refresh_token", refresh_token: refresh });
  if (res.status === 429) throw new McpError("RATE_LIMITED", "the sign-in service asked to slow down");
  if (res.status >= 500) throw new McpError("SERVER_DOWN", `token endpoint answered ${res.status}`);
  const t = res.status < 300 ? readTokens(res.body, now) : null;
  if (!t) {
    if (res.status < 300 || refusedGrant(res.status)) { await markSignInNeeded(db, serverId); return null; }
    throw new McpError("BAD_RESPONSE", `token endpoint answered ${res.status}`);
  }
  await saveTokens(db, serverId, t);
  return t.accessToken;
}

/** Asks the sign-in service to revoke the tokens (RFC 7009), best effort: nothing it answers changes what happens next. */
export async function revokeTokens(row: OAuthRow): Promise<void> {
  const client = clientOf(row);
  if (!row.revocation_url || !client) return;
  for (const [field, hint] of [["refresh", "refresh_token"], ["access", "access_token"]] as const) {
    const enc = field === "refresh" ? row.refresh_enc : row.access_enc;
    const token = enc ? openToken(enc, oauthAad(row.server_id, field)) : null;
    if (!token) continue;
    try { await tokenRequest({ ...row, token_url: row.revocation_url }, client, { token, token_type_hint: hint }); }
    catch { /* best effort */ }
  }
}
