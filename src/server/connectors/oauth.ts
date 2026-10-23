/**
 * Connected apps: connecting (owner decisions, 22 October 2026: connectors; spec §5, §15). An in-house, provider-agnostic
 * OAuth 2.0 authorisation-code flow:
 * - `state` is 32 random bytes, stored only as its sha256, single use, 10 minutes, bound to the person (their session at
 *   the callback), the workspace (membership and role re-checked), the browser (an HttpOnly cookie that must equal it)
 *   and a nonce (checked in an OpenID id_token where one comes back);
 * - PKCE S256 wherever the adapter supports it; the verifier is sealed to its state row;
 * - fixed redirect URIs; `return_to` limited to the workspace's settings and My Day;
 * - callback errors become fixed codes (lib/connectors/words CONNECT_FAILURE), never the provider's text;
 * - tokens are sealed to their row before they touch the database; nothing secret is logged or returned.
 * The functions take the request's parts explicitly (the routes pass the session and the cookie) so they are tested
 * without a request. Server-only.
 */
import { randomUUID } from "node:crypto";
import { withSystem, withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import type { CurrentUser } from "@/server/auth";
import { AppError, forbidden, invalid, rateLimited } from "@/server/lib/errors";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { schema0061Missing } from "@/server/lib/schema-0061";
import { CONNECTOR_WORDS, isConnectFailure, type ConnectFailure } from "@/lib/connectors/words";
import { PROVIDER_LABELS, PROVIDER_SLUGS } from "@/lib/connectors/types";
import { adapterFor } from "./registry";
import { openToken, pkcePair, randomUrlToken, safeEqual, sealToken, sha256Hex, stateAad } from "./crypto";
import { redirectUriFor } from "./env";
import { httpFor } from "./http";
import { saveTokens, tokenEndpoint } from "./tokens";
import { connectorAudit } from "./audit";
import { CONNECTION_COLUMNS, isManager, impersonating, manageableConnection, policyFor, requireConnectors, type ConnectionRow } from "./connections";
import { notReadyError, toPublicError } from "./errors";
import { ConnectorError, type AccountInfo, type ConnectionKind, type ConnectionRef, type ProviderAdapter, type ProviderId, type TokenSet } from "./types";

export const STATE_COOKIE = "boredroom_connector";
export const STATE_TTL_MINUTES = 10;
export const ADMIN_CONSENT_TTL_DAYS = 7;
const START_SPACING_MS = 10_000;

export type StartInput = { kind: ConnectionKind; act?: boolean; purpose?: "connect" | "reconnect" | "upgrade" | "admin_consent"; connectionId?: string; returnTo?: string };

/** `return_to`: only the workspace's settings (a section) or My Day. Anything else falls back to the right settings page. */
export function safeReturnTo(slug: string, kind: ConnectionKind, wanted?: string | null): string {
  const fallback = kind === "personal" ? `/app/${slug}/settings?section=assistant` : `/app/${slug}/settings?section=connectors`;
  if (!wanted || wanted.length > 300) return fallback;
  const settings = new RegExp(`^/app/${slug}/settings\\?section=[a-z-]{1,40}$`);
  const myDay = new RegExp(`^/app/${slug}/(my-day|dashboard)$`);
  return settings.test(wanted) || myDay.test(wanted) ? wanted : fallback;
}

/** The cookie the start route sets: HttpOnly, SameSite=Lax, Secure in production, path /api/connectors, 10 minutes. */
export function stateCookie(state: string, maxAgeSeconds = STATE_TTL_MINUTES * 60): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax${secure}; Path=/api/connectors; Max-Age=${maxAgeSeconds}`;
}
export const clearStateCookie = () => stateCookie("", 0);

const lastStart = new Map<string, number>();
/** Tests only. */
export function resetStartSpacingForTests(): void { lastStart.clear(); }

/** The standard authorise URL (or the adapter's own first hop). */
export function authorizeUrl(adapter: ProviderAdapter, c: { kind: ConnectionKind; act: boolean; upgrade: boolean; state: string; nonce: string; codeChallenge: string | null; scopes: string[] }): string {
  const ctx = { kind: c.kind, act: c.act, upgrade: c.upgrade, redirectUri: redirectUriFor(adapter.id), state: c.state, nonce: c.nonce, codeChallenge: c.codeChallenge };
  const base = typeof adapter.oauth.authorizeUrl === "function" ? adapter.oauth.authorizeUrl(ctx) : adapter.oauth.authorizeUrl;
  const u = new URL(base);
  u.searchParams.set("client_id", adapter.oauth.clientId());
  u.searchParams.set("redirect_uri", ctx.redirectUri);
  u.searchParams.set("response_type", "code");
  if (c.scopes.length) u.searchParams.set("scope", c.scopes.join(adapter.oauth.scopeSeparator));
  u.searchParams.set("state", c.state);
  if (adapter.oauth.pkce === "S256" && c.codeChallenge) {
    u.searchParams.set("code_challenge", c.codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(adapter.oauth.authorizeParams?.(ctx) ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

type StateRow = {
  id: string; organisation_id: string; membership_id: string; user_id: string; provider: ProviderId; kind: ConnectionKind;
  purpose: "connect" | "reconnect" | "upgrade" | "install" | "admin_consent"; connection_id: string | null; verifier_enc: string | null; nonce: string;
  want_act: boolean; scopes: string[]; return_to: string | null; pending: Record<string, unknown>; expires_at: string;
};

async function insertState(db: Db, s: { organisationId: string; membershipId: string; userId: string; provider: ProviderId; kind: ConnectionKind; purpose: StateRow["purpose"]; connectionId: string | null; verifier: string | null; nonce: string; wantAct: boolean; scopes: string[]; returnTo: string; pending?: Record<string, unknown>; ttlMinutes?: number }): Promise<string> {
  const state = randomUrlToken(32);
  const id = randomUUID();
  await db.query(
    `INSERT INTO connector_oauth_states(id, state_hash, organisation_id, membership_id, user_id, provider, kind, purpose, connection_id, verifier_enc, nonce, want_act, scopes, return_to, pending, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() + make_interval(mins => $16))`,
    [id, sha256Hex(state), s.organisationId, s.membershipId, s.userId, s.provider, s.kind, s.purpose, s.connectionId,
      s.verifier ? sealToken(s.verifier, stateAad(id)) : null, s.nonce, s.wantAct, s.scopes, s.returnTo, JSON.stringify(s.pending ?? {}), s.ttlMinutes ?? STATE_TTL_MINUTES]);
  return state;
}

/**
 * POST …/connectors/[provider]/start (§5.1). Checks in order, each with its own words; then a state row and the URL the
 * browser goes to. The route sets the cookie from `state`.
 */
export async function beginConnect(ctx: OrgContext, provider: ProviderId, input: StartInput, now: Date = new Date()): Promise<{ url: string; state: string }> {
  await requireConnectors(ctx);
  const adapter = await adapterFor(provider);
  const app = PROVIDER_LABELS[provider];
  if (!adapter.configured(process.env)) throw toPublicError("NOT_CONFIGURED", provider);
  if (!adapter.kinds.includes(input.kind)) throw invalid(CONNECTOR_WORDS.kindNotOffered(app, input.kind));
  if (impersonating(ctx)) throw forbidden(CONNECTOR_WORDS.impersonatedConnect);
  if (input.kind === "workspace" && !isManager(ctx)) throw forbidden(CONNECTOR_WORDS.workspaceOnly);
  if (input.kind === "personal") {
    const policy = await withUser(ctx.user.profileId, (db) => policyFor(db, ctx.org.id, provider));
    if (!policy.personalAllowed) throw forbidden(CONNECTOR_WORDS.personalOff(app));
  }
  const purpose = input.purpose ?? "connect";
  let existing: ConnectionRow | null = null;
  if (purpose === "reconnect" || purpose === "upgrade") {
    if (!input.connectionId) throw invalid("Which connection?");
    existing = await manageableConnection(ctx, input.connectionId);
    if (existing.provider !== provider || existing.kind !== input.kind) throw invalid("That connection is for another app.");
  }
  const spacingKey = ctx.membership.id;
  if (now.getTime() - (lastStart.get(spacingKey) ?? 0) < START_SPACING_MS && purpose !== "admin_consent") throw rateLimited(CONNECTOR_WORDS.limits.startSoon);
  lastStart.set(spacingKey, now.getTime());

  const act = purpose === "upgrade" ? true : input.act ?? (existing?.can_act ?? true);
  const scopes = adapter.oauth.scopes({ kind: input.kind, act });
  const nonce = randomUrlToken(16);
  const pkce = adapter.oauth.pkce === "S256" ? pkcePair() : null;
  const returnTo = safeReturnTo(ctx.org.slug, input.kind, input.returnTo);

  if (purpose === "admin_consent") {
    // Microsoft admin consent (§5.4): a state any signed-in member may hand to their tenant's admin, valid 7 days.
    if (provider !== "teams" && provider !== "outlook_calendar") throw invalid("Only Microsoft apps need an admin's approval.");
    const state = await withSystem((db) => insertState(db, { organisationId: ctx.org.id, membershipId: ctx.membership.id, userId: ctx.user.profileId, provider, kind: input.kind, purpose, connectionId: null, verifier: null, nonce, wantAct: false, scopes: [], returnTo, ttlMinutes: ADMIN_CONSENT_TTL_DAYS * 24 * 60 }));
    const u = new URL("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
    u.searchParams.set("client_id", adapter.oauth.clientId());
    u.searchParams.set("scope", "https://graph.microsoft.com/.default");
    u.searchParams.set("redirect_uri", redirectUriFor(provider));
    u.searchParams.set("state", state);
    return { url: u.toString(), state };
  }

  // A custom first hop (GitHub installs the app before the person authorises): its state is the install's.
  const probe = adapter.begin?.({ kind: input.kind, state: "x" }) ?? null;
  const rowPurpose: StateRow["purpose"] = probe ? "install" : purpose;
  const state = await withSystem(async (db) => {
    const s = await insertState(db, { organisationId: ctx.org.id, membershipId: ctx.membership.id, userId: ctx.user.profileId, provider, kind: input.kind, purpose: rowPurpose, connectionId: existing?.id ?? null, verifier: pkce?.verifier ?? null, nonce, wantAct: act, scopes, returnTo });
    await connectorAudit(db, { organisationId: ctx.org.id, connectionId: existing?.id ?? null, provider, kind: input.kind, membershipId: ctx.membership.id, action: "connect.started", outcome: "ok" });
    return s;
  });
  const first = adapter.begin?.({ kind: input.kind, state }) ?? null;
  const url = first ? first.url : authorizeUrl(adapter, { kind: input.kind, act, upgrade: purpose === "upgrade", state, nonce, codeChallenge: pkce?.challenge ?? null, scopes });
  return { url, state };
}

// ---- The callback ------------------------------------------------------------------------------------------------------

export type CallbackInput = { provider: ProviderId; query: URLSearchParams; cookieState: string | null; user: CurrentUser | null; now?: Date };
export type CallbackResult = { location: string; ok: boolean; code?: ConnectFailure; connectionId?: string };

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/** Microsoft and Google error parameters as a fixed code (§5.2.5). */
export function failureOf(error: string, description: string | null): ConnectFailure {
  if (error === "access_denied") return /AADSTS65001|AADSTS90094|AADSTS90095/.test(description ?? "") ? "admin_approval" : "cancelled";
  if (error === "consent_required" || /AADSTS65001|AADSTS90094|AADSTS90095/.test(description ?? "")) return "admin_approval";
  return "failed";
}

/** Claims the state row once (system context): the row, or why not ("expired" or "mismatch"). */
async function claimState(db: Db, state: string): Promise<StateRow | ConnectFailure> {
  const hash = sha256Hex(state);
  const row = await db.maybeOne<StateRow>(
    `UPDATE connector_oauth_states SET used_at = now() WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING id, organisation_id, membership_id, user_id, provider, kind, purpose, connection_id, verifier_enc, nonce, want_act, scopes, return_to, pending, expires_at`, [hash]);
  if (row) return row;
  const seen = await db.maybeOne<{ used: boolean }>(`SELECT used_at IS NOT NULL AS used FROM connector_oauth_states WHERE state_hash = $1`, [hash]);
  return seen?.used ? "mismatch" : "expired";
}

/** Who may still finish: the same signed-in person, an active member, owners or HR for the workspace kind, the plan and the policy. */
async function stillAllowed(db: Db, row: StateRow, user: CurrentUser | null): Promise<ConnectFailure | { slug: string }> {
  if (!user || user.profileId !== row.user_id) return "mismatch";
  if (user.impersonation) return "not_allowed";
  const m = await db.maybeOne<{ role: string; status: string; slug: string; org_status: string }>(
    `SELECT m.role, m.status, o.slug, o.status AS org_status FROM memberships m JOIN organisations o ON o.id = m.organisation_id
      WHERE m.id = $1 AND m.organisation_id = $2 AND m.user_id = $3`, [row.membership_id, row.organisation_id, row.user_id]);
  if (!m || m.status !== "active" || m.org_status !== "active") return "not_allowed";
  if (row.kind === "workspace" && m.role !== "owner" && m.role !== "hr") return "not_allowed";
  const plan = await resolveEntitlements(db, row.organisation_id);
  if (!plan.features.CONNECTORS) return "not_allowed";
  if (row.kind === "personal" && !(await policyFor(db, row.organisation_id, row.provider)).personalAllowed) return "not_allowed";
  return { slug: m.slug };
}

/** base64url JSON of a JWT's payload (no signature check: received straight from the token endpoint over TLS, per OpenID Connect). */
export function jwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>; } catch { return null; }
}

const OIDC_ISSUERS: Partial<Record<ProviderId, (iss: string) => boolean>> = {
  google_calendar: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
  outlook_calendar: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(iss),
  teams: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(iss),
};

/** Checks an id_token from the token endpoint (aud, iss, exp, nonce); its claims, or null when it fails. */
export function checkIdToken(provider: ProviderId, idToken: string, o: { clientId: string; nonce: string; now: Date }): Record<string, unknown> | null {
  const c = jwtClaims(idToken);
  if (!c) return null;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(o.clientId)) return null;
  const iss = OIDC_ISSUERS[provider];
  if (iss && (typeof c.iss !== "string" || !iss(c.iss))) return null;
  if (typeof c.exp !== "number" || c.exp * 1000 < o.now.getTime() - 60_000) return null;
  if (c.nonce !== undefined && c.nonce !== o.nonce) return null;
  return c;
}

/** A failure code an adapter chose (ConnectorError NOT_ALLOWED with the code as its message's first word), else the generic one. */
function failureFromError(err: unknown): ConnectFailure {
  if (err instanceof ConnectorError) {
    const first = err.message.split(/[:\s]/)[0];
    if (isConnectFailure(first)) return first;
    if (err.code === "ADMIN_APPROVAL") return "admin_approval";
  }
  return "failed";
}

/** An HTTP client for the moments between the code exchange and the stored connection: the fresh token, no refresh. */
function freshHttp(adapter: ProviderAdapter, tokens: TokenSet, row: StateRow) {
  const conn: ConnectionRef = {
    id: "00000000-0000-0000-0000-000000000000", organisationId: row.organisation_id, provider: row.provider, kind: row.kind,
    membershipId: row.kind === "personal" ? row.membership_id : null, connectedBy: row.membership_id, externalAccountId: "pending",
    externalTenantId: null, accountLabel: null, scopes: tokens.scopes ?? row.scopes, settings: {}, canRead: true, canAct: false,
  };
  return httpFor(conn, adapter, {
    token: async () => ({ accessToken: tokens.accessToken, expiresAt: null }),
    refresh: async () => { throw new ConnectorError("REAUTH_REQUIRED", "no refresh while connecting"); },
    backoff: async () => undefined,
  });
}

/**
 * GET /api/connectors/[provider]/callback (§5.2): cookie equals state, the state row claimed once, the same person still
 * allowed, the code exchanged (PKCE verifier, the same redirect URI), the id_token checked, `identify`, then one system
 * transaction stores the connection, its sealed tokens, the identity, sync state, audit and the first jobs.
 */
export async function completeConnect(input: CallbackInput): Promise<CallbackResult> {
  const now = input.now ?? new Date();
  const q = input.query;
  const state = q.get("state") ?? "";
  const fail = (code: ConnectFailure, returnTo = "/app"): CallbackResult => ({ location: withParam(withParam(returnTo, "connector_error", code), "connector_app", PROVIDER_SLUGS[input.provider]), ok: false, code });
  if (schema0061Missing()) return fail("failed");
  if (!state || state.length > 200) return fail("mismatch");

  // Microsoft admin consent (§5.4): any signed-in member's browser; nothing is stored but the state's use.
  if (q.get("admin_consent") !== null) {
    const row = await withSystem((db) => claimState(db, state));
    if (typeof row === "string" || row.purpose !== "admin_consent" || row.provider !== input.provider) return fail(typeof row === "string" ? row : "mismatch");
    const back = row.return_to ?? "/app";
    if (q.get("admin_consent")?.toLowerCase() !== "true") return fail("admin_approval", back);
    return { location: withParam(back, "connector_notice", "admin_consent"), ok: true };
  }

  if (!input.cookieState || !safeEqual(input.cookieState, state)) return fail("mismatch");
  const claimed = await withSystem((db) => claimState(db, state));
  if (typeof claimed === "string") return fail(claimed);
  const row = claimed;
  const back = row.return_to ?? "/app";
  if (row.provider !== input.provider || row.purpose === "admin_consent" || row.purpose === "install") return fail("mismatch", back);
  const allowed = await withSystem((db) => stillAllowed(db, row, input.user));
  if (typeof allowed === "string") return fail(allowed, back);
  const err = q.get("error");
  if (err) return fail(failureOf(err, q.get("error_description")), back);
  const code = q.get("code");
  if (!code || code.length > 2000) return fail("failed", back);

  const adapter = await adapterFor(row.provider);
  if (!adapter.configured(process.env)) return fail("not_allowed", back);
  const verifier = row.verifier_enc ? openToken(row.verifier_enc, stateAad(row.id)) : null;
  if (row.verifier_enc && !verifier) return fail("mismatch", back);

  let tokens: TokenSet;
  let account: AccountInfo;
  try {
    const res = await tokenEndpoint(adapter, { grant_type: "authorization_code", code, redirect_uri: redirectUriFor(row.provider), ...(verifier ? { code_verifier: verifier } : {}) });
    if (res.status >= 400) {
      const e = res.body && typeof res.body === "object" ? (res.body as Record<string, unknown>) : {};
      return fail(failureOf(String(e.error ?? ""), String(e.error_description ?? "")) === "admin_approval" ? "admin_approval" : "failed", back);
    }
    tokens = adapter.oauth.parseToken(res.body, now);
    const idToken = res.body && typeof res.body === "object" ? (res.body as Record<string, unknown>).id_token : undefined;
    if (typeof idToken === "string" && OIDC_ISSUERS[row.provider]) {
      const claims = checkIdToken(row.provider, idToken, { clientId: adapter.oauth.clientId(), nonce: row.nonce, now });
      if (!claims) return fail("mismatch", back);
      tokens = { ...tokens, facts: { ...(tokens.facts ?? {}), idTokenClaims: claims } };
    }
    account = await adapter.identify({ kind: row.kind, http: freshHttp(adapter, tokens, row), tokens, pending: row.pending ?? {} });
  } catch (e) {
    console.warn(`[connectors] ${row.provider} did not connect: ${e instanceof ConnectorError ? e.code : "error"}`);
    return fail(failureFromError(e), back);
  }
  if (!account.externalAccountId || account.externalAccountId.length > 200) return fail("failed", back);

  const granted = account.scopes ?? tokens.scopes ?? row.scopes;
  const actScopes = adapter.oauth.scopes({ kind: row.kind, act: true });
  const canActGranted = actScopes.every((s) => granted.includes(s));
  try {
    const connectionId = await withSystem((db) => storeConnection(db, { row, adapter, account, tokens, granted, canAct: row.want_act && canActGranted }));
    if (typeof connectionId !== "string") return fail(connectionId.code, back);
    return { location: withParam(back, "connected", PROVIDER_SLUGS[row.provider]), ok: true, connectionId };
  } catch (e) {
    console.warn(`[connectors] ${row.provider} could not be saved: ${(e as { code?: string })?.code ?? "error"}`);
    return fail("failed", back);
  }
}

/** The one transaction that stores a new (or reconnected) connection. */
async function storeConnection(db: Db, c: { row: StateRow; adapter: ProviderAdapter; account: AccountInfo; tokens: TokenSet; granted: string[]; canAct: boolean }): Promise<string | { code: ConnectFailure }> {
  const { row, adapter, account } = c;
  const personal = row.kind === "personal";
  const label = (account.accountLabel ?? "").slice(0, 200) || PROVIDER_LABELS[row.provider];
  const settings = { ...(account.settings ?? {}) };
  let existing: ConnectionRow | null = null;
  if (row.connection_id) {
    existing = await db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.id = $1 AND c.status <> 'disconnecting'`, [row.connection_id]);
    if (!existing) return { code: "expired" };
    if (existing.external_account_id !== account.externalAccountId || (existing.external_tenant_id ?? null) !== (account.externalTenantId ?? null)) return { code: "different_account" };
  } else {
    existing = personal
      ? await db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.membership_id = $1 AND c.provider = $2 AND c.external_account_id = $3 AND c.kind = 'personal' AND c.status <> 'disconnecting'`, [row.membership_id, row.provider, account.externalAccountId])
      : await db.maybeOne<ConnectionRow>(`SELECT ${CONNECTION_COLUMNS} FROM connector_connections c WHERE c.organisation_id = $1 AND c.provider = $2 AND COALESCE(c.external_tenant_id, c.external_account_id) = $3 AND c.kind = 'workspace' AND c.status <> 'disconnecting'`, [row.organisation_id, row.provider, account.externalTenantId ?? account.externalAccountId]);
  }
  let id: string;
  if (existing) {
    const canAct = row.purpose === "upgrade" ? c.canAct : c.canAct || (existing.can_act && c.canAct);
    id = (await db.one<{ id: string }>(
      `UPDATE connector_connections SET status = 'active', scopes = $2, can_act = $3, account_label = $4, settings = settings || $5::jsonb,
              last_error_code = NULL, last_error_at = NULL, error_count = 0, backoff_until = NULL, connected_by = CASE WHEN kind = 'workspace' THEN $6::uuid ELSE connected_by END
        WHERE id = $1 RETURNING id`, [existing.id, c.granted, canAct, label, JSON.stringify(settings), row.membership_id])).id;
  } else {
    id = (await db.one<{ id: string }>(
      `INSERT INTO connector_connections(organisation_id, provider, kind, membership_id, connected_by, status, external_account_id, external_tenant_id, account_label, scopes, can_read, can_act, settings)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, true, $10, $11) RETURNING id`,
      [row.organisation_id, row.provider, row.kind, personal ? row.membership_id : null, row.membership_id, account.externalAccountId, account.externalTenantId, label, c.granted, c.canAct, JSON.stringify(settings)])).id;
  }
  await saveTokens(db, id, row.organisation_id, c.tokens);
  if (personal && account.identity?.externalUserId) {
    await db.query(
      `INSERT INTO connector_identities(membership_id, organisation_id, provider, external_user_id, external_tenant_id, connection_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (membership_id, provider, external_user_id) DO UPDATE SET connection_id = EXCLUDED.connection_id, external_tenant_id = EXCLUDED.external_tenant_id`,
      [row.membership_id, row.organisation_id, row.provider, account.identity.externalUserId.slice(0, 200), account.externalTenantId, id]);
  }
  for (const s of adapter.streams) {
    await db.query(
      `INSERT INTO connector_sync_state(connection_id, stream, next_run_at, full_resync) VALUES ($1, $2, now(), true)
       ON CONFLICT (connection_id, stream) DO UPDATE SET next_run_at = now(), full_resync = true`, [id, s.name]);
    await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sync', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
      [JSON.stringify({ connectionId: id, stream: s.name, reason: "connect" }), `connector.sync:${id}:${s.name}:connect:${row.id}`]);
  }
  if (adapter.sources && !personal) {
    await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.sources', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
      [JSON.stringify({ connectionId: id }), `connector.sources:${id}:${row.id}`]);
  }
  if (adapter.registerWebhooks) {
    await db.query(`INSERT INTO jobs(type, payload, dedup_key) VALUES ('connector.webhooks', $1, $2) ON CONFLICT (dedup_key) DO NOTHING`,
      [JSON.stringify({ connectionId: id }), `connector.webhooks:${id}:${row.id}`]);
  }
  await connectorAudit(db, { organisationId: row.organisation_id, connectionId: id, provider: row.provider, kind: row.kind, membershipId: row.membership_id, action: row.purpose === "connect" ? "connect.ok" : `${row.purpose}.ok`, outcome: "ok" },
    { auditEvent: "connector.connected", actorUserId: row.user_id });
  return id;
}

// ---- A custom first hop (GitHub's Setup URL) -----------------------------------------------------------------------------

/**
 * GET /api/connectors/[provider]/setup (§5.3): GitHub sends the owner here after installing. The session and the
 * cookie's live install state are required; `installation_id` is kept in `pending` as a claim only (identify verifies it
 * with the person's own user token); then the standard user authorisation with a new state and PKCE.
 */
export async function continueInstall(input: CallbackInput): Promise<{ location: string; state?: string }> {
  const q = input.query;
  const adapter = await adapterFor(input.provider);
  if (!adapter.begin) return { location: "/app?connector_error=failed" };
  const state = input.cookieState ?? "";
  if (!state || (q.get("state") && !safeEqual(q.get("state")!, state))) return { location: "/app?connector_error=mismatch" };
  const row = await withSystem((db) => claimState(db, state));
  if (typeof row === "string") return { location: `/app?connector_error=${row}` };
  const back = row.return_to ?? "/app";
  if (row.provider !== input.provider || row.purpose !== "install") return { location: withParam(back, "connector_error", "mismatch") };
  const allowed = await withSystem((db) => stillAllowed(db, row, input.user));
  if (typeof allowed === "string") return { location: withParam(back, "connector_error", allowed) };
  const installationId = q.get("installation_id");
  const setupAction = q.get("setup_action");
  const pending = {
    ...(installationId && /^\d{1,20}$/.test(installationId) ? { installationId } : {}),
    ...(setupAction && /^(install|update|request)$/.test(setupAction) ? { setupAction } : {}),
  };
  const pkce = adapter.oauth.pkce === "S256" ? pkcePair() : null;
  const nonce = randomUrlToken(16);
  const next = await withSystem((db) => insertState(db, { organisationId: row.organisation_id, membershipId: row.membership_id, userId: row.user_id, provider: row.provider, kind: row.kind, purpose: "connect", connectionId: row.connection_id, verifier: pkce?.verifier ?? null, nonce, wantAct: row.want_act, scopes: row.scopes, returnTo: back, pending }));
  return { location: authorizeUrl(adapter, { kind: row.kind, act: row.want_act, upgrade: false, state: next, nonce, codeChallenge: pkce?.challenge ?? null, scopes: row.scopes }), state: next };
}

/** For callers that want an AppError rather than a redirect (tests, the start route's own errors). */
export function connectorsNotReady(): AppError { return notReadyError(); }
