/**
 * Connected apps: tokens (owner decisions, 22 October 2026: connectors; spec §4.2, §6, §15). Sealed with AES-256-GCM
 * bound to their row and field (crypto.ts), kept in `connector_tokens`, which row security lets only Boredroom's server
 * contexts (system, worker) read: never a person's own context, never an API answer, a log, an audit row or a job payload
 * (jobs carry connection ids only). Refreshing is serialised per connection with an advisory lock, so two processes never
 * spend a rotating refresh token twice. Server-only.
 */
import { withWorker, type Db } from "@/server/db";
import { adapterFor } from "./registry";
import { openToken, sealToken, tokenAad } from "./crypto";
import { rawRequest } from "./http";
import { ConnectorError, type ConnectionRef, type ProviderAdapter, type ProviderId, type TokenSet } from "./types";
import { CONNECTION_COLUMNS, markNeedsReauth, refOf, type ConnectionRow } from "./connections";

const REFRESH_AHEAD_MS = 2 * 60_000;
const TOKEN_TIMEOUT_MS = 10_000;

type TokenRow = { access_enc: string; refresh_enc: string | null; extra_enc: string | null; token_type: string; expires_at: string | null; refresh_expires_at: string | null; scopes: string[] | null };

/** Seals and stores a token set for a connection (system or worker context). */
export async function saveTokens(db: Db, connectionId: string, organisationId: string, t: TokenSet, opts: { keepRefresh?: boolean } = {}): Promise<void> {
  const access = sealToken(t.accessToken, tokenAad(connectionId, "access"));
  const refresh = t.refreshToken ? sealToken(t.refreshToken, tokenAad(connectionId, "refresh")) : null;
  const extra = t.extra && Object.keys(t.extra).length ? sealToken(JSON.stringify(t.extra), tokenAad(connectionId, "extra")) : null;
  const tokenType = /^[a-z_]{2,20}$/.test((t.tokenType ?? "").toLowerCase()) ? t.tokenType.toLowerCase() : "bearer";
  await db.query(
    `INSERT INTO connector_tokens(connection_id, organisation_id, access_enc, refresh_enc, extra_enc, token_type, expires_at, refresh_expires_at, refreshed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (connection_id) DO UPDATE SET access_enc = EXCLUDED.access_enc,
       refresh_enc = CASE WHEN $9::boolean AND EXCLUDED.refresh_enc IS NULL THEN connector_tokens.refresh_enc ELSE EXCLUDED.refresh_enc END,
       extra_enc = COALESCE(EXCLUDED.extra_enc, connector_tokens.extra_enc),
       token_type = EXCLUDED.token_type, expires_at = EXCLUDED.expires_at,
       refresh_expires_at = CASE WHEN $9::boolean AND EXCLUDED.refresh_enc IS NULL THEN connector_tokens.refresh_expires_at ELSE EXCLUDED.refresh_expires_at END,
       refreshed_at = now(), updated_at = now()`,
    [connectionId, organisationId, access, refresh, extra, tokenType, t.expiresAt, t.refreshExpiresAt, !!opts.keepRefresh]);
}

/** The opened token set, or null (none, or it no longer opens: the key changed). System or worker context only. */
export async function loadTokens(db: Db, connectionId: string): Promise<TokenSet | null> {
  const r = await db.maybeOne<TokenRow>(
    `SELECT access_enc, refresh_enc, extra_enc, token_type, expires_at, refresh_expires_at, NULL::text[] AS scopes FROM connector_tokens WHERE connection_id = $1`, [connectionId]);
  if (!r) return null;
  const accessToken = openToken(r.access_enc, tokenAad(connectionId, "access"));
  if (accessToken === null) return null;
  const refreshToken = r.refresh_enc ? openToken(r.refresh_enc, tokenAad(connectionId, "refresh")) : null;
  let extra: Record<string, string> | undefined;
  if (r.extra_enc) {
    const raw = openToken(r.extra_enc, tokenAad(connectionId, "extra"));
    try { extra = raw ? (JSON.parse(raw) as Record<string, string>) : undefined; } catch { extra = undefined; }
  }
  return {
    accessToken, refreshToken, tokenType: r.token_type, expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    refreshExpiresAt: r.refresh_expires_at ? new Date(r.refresh_expires_at) : null, scopes: null, ...(extra ? { extra } : {}),
  };
}

export async function currentToken(connectionId: string): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  const t = await withWorker((db) => loadTokens(db, connectionId));
  return t ? { accessToken: t.accessToken, expiresAt: t.expiresAt } : null;
}

export async function setBackoff(connectionId: string, seconds: number): Promise<void> {
  await withWorker((db) => db.query(
    `UPDATE connector_connections SET backoff_until = GREATEST(COALESCE(backoff_until, now()), now() + make_interval(secs => $2)),
            last_error_code = 'RATE_LIMITED', last_error_at = now() WHERE id = $1`, [connectionId, Math.max(1, Math.min(3600, Math.round(seconds)))]));
}

// ---- The token endpoint -----------------------------------------------------------------------------------------------

/**
 * One call to the adapter's token endpoint with its client authentication (body or HTTP Basic) and body format (form
 * or JSON); `params` are the grant's own (code, redirect_uri, code_verifier; or refresh_token). The answer's body as it
 * came: parseToken reads it.
 */
export async function tokenEndpoint(adapter: ProviderAdapter, params: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const o = adapter.oauth;
  const tokenHost = new URL(o.tokenUrl).hostname;
  const all: Record<string, string> = { ...params };
  let authorization: string | undefined;
  if (o.clientAuth === "basic") authorization = `Basic ${Buffer.from(`${o.clientId()}:${o.clientSecret()}`).toString("base64")}`;
  else { all.client_id = o.clientId(); all.client_secret = o.clientSecret(); }
  const res = await rawRequest([tokenHost, ...adapter.hosts], {
    method: "POST", url: o.tokenUrl, timeoutMs: TOKEN_TIMEOUT_MS, auth: "none",
    ...(o.tokenBody === "json" ? { json: all } : { form: all }),
    ...(authorization ? { authorization } : {}),
  });
  return { status: res.status, body: res.body };
}

/** True when a token endpoint's answer says the grant is gone (expired, revoked, already used). */
export function grantRefused(status: number, body: unknown): boolean {
  const e = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
  return e === "invalid_grant" || e === "invalid_token" || e === "unauthorized_client" || e === "token_revoked" || e === "token_expired" || (status === 401 && e !== "invalid_client");
}

// ---- Minting (providers whose working token is not an OAuth refresh: GitHub App installations) ------------------------

/**
 * A provider whose working token is minted rather than refreshed (framework extension, 22 October 2026, for GitHub App
 * installation tokens): the adapter module calls `registerTokenMinter("github", fn)` when it loads, and refreshTokens
 * then calls `fn` instead of the refresh grant. `fn` gets the stored set (its `extra`, e.g. the verifying user token)
 * and returns the new set; throw ConnectorError REAUTH_REQUIRED when it can't.
 */
export type TokenMinter = (c: { conn: ConnectionRef; tokens: TokenSet; now: Date }) => Promise<TokenSet>;
const minters = new Map<ProviderId, TokenMinter>();
export function registerTokenMinter(provider: ProviderId, fn: TokenMinter | null): void {
  if (fn) minters.set(provider, fn);
  else minters.delete(provider);
}

// ---- Refreshing ---------------------------------------------------------------------------------------------------------

/**
 * A fresh token set for the connection: in one worker transaction under `pg_advisory_xact_lock`, re-read, and refresh
 * only if it still expires within 2 minutes (or `force`, after a 401). A rotating refresh token is stored in the same
 * transaction. A refused grant marks the connection `needs_reauth` (and tells its person, or owners and HR) and throws
 * REAUTH_REQUIRED.
 */
export async function refreshTokens(connectionId: string, opts: { force?: boolean; now?: Date; aheadMs?: number } = {}): Promise<TokenSet> {
  const now = opts.now ?? new Date();
  let refused: ConnectionRef | null = null;
  try {
    return await withWorker(async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('connector-refresh:' || $1::text, 0))`, [connectionId]);
      const row = await db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1`, [connectionId]);
      if (!row || row.status === "disconnecting") throw new ConnectorError("REVOKED", "connection gone");
      const conn = refOf(row);
      const current = await loadTokens(db, connectionId);
      if (!current) { refused = conn; throw new ConnectorError("REAUTH_REQUIRED", "no token stored"); }
      if (!opts.force && (!current.expiresAt || current.expiresAt.getTime() - now.getTime() > (opts.aheadMs ?? REFRESH_AHEAD_MS))) return current;
      const adapter = await adapterFor(conn.provider);
      let next: TokenSet;
      const minter = minters.get(conn.provider);
      if (minter) {
        try { next = await minter({ conn, tokens: current, now }); }
        catch (err) { if (err instanceof ConnectorError && (err.code === "REAUTH_REQUIRED" || err.code === "REVOKED")) refused = conn; throw err; }
      } else {
        if (adapter.oauth.refresh === "none" || !current.refreshToken) {
          // Nothing to refresh with: an expired non-refreshable token means the person connects again.
          if ((opts.force && !opts.aheadMs) || (current.expiresAt && current.expiresAt.getTime() <= now.getTime())) { refused = conn; throw new ConnectorError("REAUTH_REQUIRED", "token cannot be refreshed"); }
          return current;
        }
        const res = await tokenEndpoint(adapter, { grant_type: "refresh_token", refresh_token: current.refreshToken });
        if (res.status >= 400 || grantRefused(res.status, res.body)) {
          if (res.status >= 500) throw new ConnectorError("PROVIDER_DOWN", `token endpoint answered ${res.status}`);
          if (res.status === 429) throw new ConnectorError("RATE_LIMITED", "token endpoint rate limited", 60);
          refused = conn;
          throw new ConnectorError("REAUTH_REQUIRED", `token endpoint refused the refresh (${res.status})`);
        }
        try { next = adapter.oauth.parseToken(res.body, now); }
        catch (err) {
          if (err instanceof ConnectorError && (err.code === "REAUTH_REQUIRED" || err.code === "REVOKED")) refused = conn;
          if (err instanceof ConnectorError) throw new ConnectorError(err.code, "token endpoint answer refused");
          throw new ConnectorError("BAD_RESPONSE", "token endpoint answer unreadable");
        }
        // A reusable refresh token is often not sent again: keep the one we have.
        if (!next.refreshToken) next = { ...next, refreshToken: current.refreshToken, refreshExpiresAt: current.refreshExpiresAt };
        if (!next.extra && current.extra) next = { ...next, extra: current.extra };
      }
      await saveTokens(db, connectionId, conn.organisationId, next);
      return next;
    });
  } finally {
    if (refused) {
      await markNeedsReauth(refused, "REAUTH_REQUIRED").catch((e: unknown) => console.warn(`[connectors] could not mark a connection for reconnecting: ${(e as Error)?.message ?? e}`));
    }
  }
}
