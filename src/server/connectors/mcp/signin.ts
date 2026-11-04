/**
 * Signing in to a workspace's MCP server (owner request, 4 November 2026: phase 1b), the browser's part. Like connected
 * apps' OAuth (connectors/oauth.ts):
 * - `state` is 32 random bytes, stored only as its sha256, single use, 10 minutes, bound to the person (their session at
 *   the callback), the workspace (owner or HR, re-checked with the plan), the server and the browser (an HttpOnly cookie
 *   that must equal it);
 * - PKCE S256 always; the verifier is sealed to its state row; the resource indicator on the authorize URL and every
 *   grant;
 * - one fixed redirect URI, /api/connectors/mcp/callback, and the way back is always the workspace's Connectors settings;
 * - callback errors become fixed codes (lib/mcp/words MCP_SIGN_IN_RETURN), never the server's words;
 * - the client is registered (RFC 7591) the first time, unless the admin gave one.
 * Owners and HR sign in for the workspace; everyone's Brenda then uses that account. Server-only.
 */
import { randomUUID } from "node:crypto";
import { withSystem, withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import type { CurrentUser } from "@/server/auth";
import { invalid, notFound, rateLimited } from "@/server/lib/errors";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { schema0069Missing } from "@/server/lib/schema-0069";
import { audit } from "@/server/services/common";
import type { McpSignInReturn } from "@/lib/mcp/words";
import { openToken, pkcePair, randomUrlToken, safeEqual, sealToken, sha256Hex } from "../crypto";
import { BlockedAddress } from "./guard";
import { McpError } from "./client";
import { MCP_STATE_COOKIE, SignInError, clientOf, loadOAuth, mcpRedirectUri, mcpStateAad, readTokens, registerClient, saveClient, saveTokens, tokenRequest } from "./oauth";
import { publicMcpError, refreshTools, requireMcpAdmin, signInDb } from "./servers";

export { MCP_STATE_COOKIE };
export const MCP_STATE_TTL_MINUTES = 10;
const START_SPACING_MS = 10_000;

/** The cookie the start route sets: HttpOnly, SameSite=Lax, Secure in production, path /api/connectors/mcp, 10 minutes. */
export function mcpStateCookie(state: string, maxAgeSeconds = MCP_STATE_TTL_MINUTES * 60): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MCP_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax${secure}; Path=/api/connectors/mcp; Max-Age=${maxAgeSeconds}`;
}
export const clearMcpStateCookie = () => mcpStateCookie("", 0);

const lastStart = new Map<string, number>();
/** Tests only. */
export function resetMcpStartSpacingForTests(): void { lastStart.clear(); }

const settingsPath = (slug: string) => `/app/${slug}/settings?section=connectors`;

/**
 * POST …/mcp/servers/[id]/sign-in: registers Boredroom with the server's sign-in service the first time, stores a state
 * and answers the page the browser goes to. The route sets the cookie from `state`.
 */
export async function beginSignIn(ctx: OrgContext, serverId: string, now: Date = new Date()): Promise<{ url: string; state: string }> {
  requireMcpAdmin(ctx);
  const s = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; auth_kind: string }>(
    `SELECT id, auth_kind FROM mcp_servers WHERE id = $1 AND organisation_id = $2`, [serverId, ctx.org.id]));
  if (!s) throw notFound();
  if (s.auth_kind !== "oauth") throw invalid("This server uses a key, not sign-in.");
  if (now.getTime() - (lastStart.get(ctx.membership.id) ?? 0) < START_SPACING_MS) throw rateLimited("Wait a few seconds before starting sign-in again.");
  lastStart.set(ctx.membership.id, now.getTime());
  return signInDb(async () => {
    let row = await withWorker((db) => loadOAuth(db, serverId));
    if (!row) throw invalid("Choose “Sign in with the app” for this server again first.");
    let client = clientOf(row);
    if (!client) {
      if (!row.registration_url) throw publicMcpError(new SignInError("NO_REGISTRATION", "no registration endpoint"));
      try { client = await registerClient(row.registration_url); }
      catch (err) { throw publicMcpError(err instanceof McpError || err instanceof BlockedAddress || err instanceof SignInError ? err : new SignInError("REGISTRATION_FAILED", "registration failed")); }
      await withWorker((db) => saveClient(db, serverId, client!));
      row = { ...row, client_id: client.clientId };
    }
    const pkce = pkcePair();
    const state = randomUrlToken(32);
    await withWorker(async (db) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO mcp_oauth_states(id, state_hash, server_id, organisation_id, membership_id, user_id, verifier_enc, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))`,
        [id, sha256Hex(state), serverId, ctx.org.id, ctx.membership.id, ctx.user.profileId, sealToken(pkce.verifier, mcpStateAad(id)), MCP_STATE_TTL_MINUTES]);
      await db.query(`DELETE FROM mcp_oauth_states WHERE expires_at < now() - interval '1 day'`);
    });
    const u = new URL(row.authorize_url);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", client.clientId);
    u.searchParams.set("redirect_uri", mcpRedirectUri());
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", pkce.challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("resource", row.resource);
    if (row.scopes) u.searchParams.set("scope", row.scopes);
    return { url: u.toString(), state };
  });
}

// ---- The callback ------------------------------------------------------------------------------------------------------

export type SignInCallback = { query: URLSearchParams; cookieState: string | null; user: CurrentUser | null };
export type SignInResult = { location: string; ok: boolean; code?: McpSignInReturn };

type StateRow = { id: string; server_id: string; organisation_id: string; membership_id: string; user_id: string; verifier_enc: string };

async function claimState(db: Db, state: string): Promise<StateRow | McpSignInReturn> {
  const hash = sha256Hex(state);
  const row = await db.maybeOne<StateRow>(
    `UPDATE mcp_oauth_states SET used_at = now() WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING id, server_id, organisation_id, membership_id, user_id, verifier_enc`, [hash]);
  if (row) return row;
  const seen = await db.maybeOne<{ used: boolean }>(`SELECT used_at IS NOT NULL AS used FROM mcp_oauth_states WHERE state_hash = $1`, [hash]);
  return seen?.used ? "mismatch" : "expired";
}

/**
 * The same signed-in person, still an active owner or HR of an active workspace on a plan with connected apps. The
 * workspace's slug once the person is known to be its member, so even a refusal goes back to its settings.
 */
async function stillAllowed(db: Db, row: StateRow, user: CurrentUser | null): Promise<{ problem: McpSignInReturn | null; slug: string | null }> {
  if (!user || user.profileId !== row.user_id) return { problem: "mismatch", slug: null };
  if (user.impersonation) return { problem: "not_allowed", slug: null };
  const m = await db.maybeOne<{ role: string; status: string; slug: string; org_status: string }>(
    `SELECT m.role, m.status, o.slug, o.status AS org_status FROM memberships m JOIN organisations o ON o.id = m.organisation_id
      WHERE m.id = $1 AND m.organisation_id = $2 AND m.user_id = $3`, [row.membership_id, row.organisation_id, row.user_id]);
  if (!m || m.status !== "active" || m.org_status !== "active") return { problem: "not_allowed", slug: null };
  if (m.role !== "owner" && m.role !== "hr") return { problem: "not_allowed", slug: m.slug };
  if (!(await resolveEntitlements(db, row.organisation_id)).features.CONNECTORS) return { problem: "not_allowed", slug: m.slug };
  return { problem: null, slug: m.slug };
}

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/**
 * GET /api/connectors/mcp/callback: cookie equals state, the state claimed once, the same person still allowed, the
 * server still signing in, the code exchanged (PKCE verifier, the same redirect URI, the resource), then the sealed
 * tokens stored and the server's tools listed (all off until an admin switches them on, as with a key).
 */
export async function completeSignIn(input: SignInCallback): Promise<SignInResult> {
  const q = input.query;
  const state = q.get("state") ?? "";
  const fail = (code: McpSignInReturn, back = "/app"): SignInResult => ({ location: withParam(back, "mcp_error", code), ok: false, code });
  if (schema0069Missing()) return fail("failed");
  if (!state || state.length > 200) return fail("mismatch");
  if (!input.cookieState || !safeEqual(input.cookieState, state)) return fail("mismatch");
  const claimed = await withWorker((db) => claimState(db, state));
  if (typeof claimed === "string") return fail(claimed);
  const row = claimed;
  const allowed = await withSystem((db) => stillAllowed(db, row, input.user));
  if (allowed.problem || !allowed.slug) return fail(allowed.problem ?? "not_allowed", allowed.slug ? settingsPath(allowed.slug) : "/app");
  const back = settingsPath(allowed.slug);
  const err = q.get("error");
  if (err) return fail(err === "access_denied" ? "cancelled" : "failed", back);
  const code = q.get("code");
  if (!code || code.length > 4000) return fail("failed", back);

  const server = await withWorker((db) => db.maybeOne<{ id: string; organisation_id: string; url: string; auth_kind: "oauth"; auth_header: null }>(
    `SELECT id, organisation_id, url, auth_kind, auth_header FROM mcp_servers WHERE id = $1 AND organisation_id = $2`, [row.server_id, row.organisation_id]));
  if (!server || server.auth_kind !== "oauth") return fail("expired", back);
  const oauth = await withWorker((db) => loadOAuth(db, server.id));
  const client = oauth ? clientOf(oauth) : null;
  const verifier = openToken(row.verifier_enc, mcpStateAad(row.id));
  if (!oauth || !client || !verifier) return fail("failed", back);
  try {
    const res = await tokenRequest(oauth, client, { grant_type: "authorization_code", code, redirect_uri: mcpRedirectUri(), code_verifier: verifier });
    const tokens = res.status < 300 ? readTokens(res.body) : null;
    if (!tokens) return fail("failed", back);
    await withWorker(async (db) => {
      await saveTokens(db, server.id, tokens, row.membership_id);
      await audit(db, { organisationId: row.organisation_id, actorMembershipId: row.membership_id, actorUserId: row.user_id, action: "mcp.server_signed_in", subjectType: "mcp_server", subjectId: server.id });
    });
  } catch (e) {
    console.warn(`[mcp] sign-in did not finish: ${e instanceof McpError ? e.code : "error"}`);
    return fail("failed", back);
  }
  await refreshTools(server).catch(() => false);
  return { location: withParam(back, "mcp_signed_in", server.id), ok: true };
}
