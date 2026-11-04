/**
 * A workspace's MCP servers (owner decisions, 4 November 2026: phase 1). Owners and HR add, check, change and remove
 * them, and choose each tool's access (off, read or act); everyone's Brenda then uses the tools switched on. Behind the
 * CONNECTORS plan feature, like connected apps. The key is sealed (connectors/crypto) in mcp_server_secrets, which only
 * Boredroom's server contexts read; screens see its last four characters at most. What a server lists is written by
 * the worker context, so a member's session can't plant a tool. A server may instead sign in (phase 1b, oauth.ts): an
 * owner or HR signs in for the workspace and its tokens live in mcp_server_oauth, which only the same contexts read.
 * Server-only.
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { requireFeature } from "@/server/lib/entitlements";
import { audit } from "@/server/services/common";
import { noteMissing0068, schema0068Missing } from "@/server/lib/schema-0068";
import { noteMissing0069, schema0069Missing } from "@/server/lib/schema-0069";
import { MCP_ERRORS, MCP_NOT_READY, MCP_SIGN_IN_ERRORS, MCP_SIGN_IN_NOT_READY, mcpErrorWords } from "@/lib/mcp/words";
import type { McpAccess, McpAuthKind, McpServerStatus, McpServerView, McpToolView } from "@/lib/mcp/types";
import { openToken, sealToken } from "../crypto";
import { BlockedAddress, checkServerUrl } from "./guard";
import { McpError, listTools, type McpAuth, type McpServerRef, type McpToolInfo } from "./client";
import { SignInError, discover, loadOAuth, markSignInNeeded, oauthAccess, revokeTokens, saveDiscovery, type OAuthClient } from "./oauth";

export const secretAad = (serverId: string) => `mcp-server:${serverId}:key`;
const HEADER = /^[A-Za-z0-9-]{1,60}$/;
// Headers Boredroom sets itself, or that would change where or how the request goes.
const RESERVED_HEADERS = new Set(["host", "content-type", "content-length", "accept", "connection", "transfer-encoding", "cookie", "mcp-session-id", "mcp-protocol-version", "origin", "referer", "upgrade", "te", "expect", "proxy-authorization"]);

export const notReady = () => new AppError(503, "NOT_READY", MCP_NOT_READY);
export const signInNotReady = () => new AppError(503, "NOT_READY", MCP_SIGN_IN_NOT_READY);

export function requireMcp(ctx: OrgContext): void {
  if (schema0068Missing()) throw notReady();
  requireFeature(ctx.plan, "CONNECTORS");
}

export function requireMcpAdmin(ctx: OrgContext): void {
  requireMcp(ctx);
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the workspace's owner or HR can manage MCP servers.");
  if (ctx.user.impersonation) throw forbidden("MCP servers can't be changed while signed in as someone else.");
}

/** Runs `fn` (worker context, the sign-in tables), turning a missing 0069 into NOT_READY for signing in (and noting it). */
export async function signInDb<T>(fn: () => Promise<T>): Promise<T> {
  if (schema0069Missing()) throw signInNotReady();
  try { return await fn(); }
  catch (err) { if (noteMissing0069(err)) throw signInNotReady(); throw err; }
}

/** Runs `fn`, turning a missing 0068 into NOT_READY (and noting it). */
export async function mcpDb<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (err) { if (noteMissing0068(err)) throw notReady(); throw err; }
}

/** An McpError (or a blocked address) as an error people may see; anything else rethrown. */
export function publicMcpError(err: unknown): AppError {
  if (err instanceof BlockedAddress) return new AppError(422, "MCP_BLOCKED_ADDRESS", MCP_ERRORS.BLOCKED_ADDRESS);
  if (err instanceof SignInError) return new AppError(422, `MCP_${err.code}`, MCP_SIGN_IN_ERRORS[err.code]);
  if (err instanceof McpError) return new AppError(err.code === "AUTH_FAILED" || err.code === "SIGN_IN_NEEDED" ? 409 : 502, `MCP_${err.code}`, mcpErrorWords(err.code)!);
  if (err instanceof AppError) return err;
  throw err;
}

// ---- Rows and views ----------------------------------------------------------------------------------------------------

type ServerRow = {
  id: string; organisation_id: string; name: string; url: string; use_for: string | null; auth_kind: McpAuthKind; auth_header: string | null;
  status: McpServerStatus; server_label: string | null; last_checked_at: string | null; last_ok_at: string | null; last_error_code: string | null;
};
type ToolRow = {
  id: string; server_id: string; name: string; title: string | null; description: string; input_schema: Record<string, unknown>;
  read_only_hint: boolean | null; destructive_hint: boolean | null; hash: string; access: McpAccess; approved_hash: string | null; gone_at: string | null;
};
const SERVER_COLUMNS = "id, organisation_id, name, url, use_for, auth_kind, auth_header, status, server_label, last_checked_at, last_ok_at, last_error_code";
const TOOL_COLUMNS = "id, server_id, name, title, description, input_schema, read_only_hint, destructive_hint, hash, access, approved_hash, gone_at";

const toolView = (t: ToolRow): McpToolView => ({
  id: t.id, name: t.name, title: t.title, description: t.description, access: t.access,
  changed: t.access !== "off" && t.approved_hash !== t.hash, gone: !!t.gone_at,
  suggested: t.read_only_hint === true ? "read" : "act", destructive: t.destructive_hint === true,
});

type SignIn = NonNullable<McpServerView["signIn"]>;

function serverView(s: ServerRow, tools: ToolRow[], hint: string | null, signIn: SignIn | null): McpServerView {
  return {
    id: s.id, name: s.name, url: s.url, useFor: s.use_for, authKind: s.auth_kind, authHeader: s.auth_header, keyHint: hint,
    status: s.status, serverLabel: s.server_label, lastCheckedAt: s.last_checked_at, lastOkAt: s.last_ok_at,
    problem: mcpErrorWords(s.last_error_code),
    signIn: s.auth_kind === "oauth" ? signIn ?? { signedIn: false, by: null, at: null } : null,
    tools: tools.filter((t) => t.server_id === s.id).map(toolView),
  };
}

/** Whether each signed-in server is signed in, by whom and when (worker context; empty before 0069). */
async function signInsFor(ids: string[]): Promise<Map<string, SignIn>> {
  if (!ids.length || schema0069Missing()) return new Map();
  try {
    const rows = await withWorker((db) => db.query<{ server_id: string; signed_in: boolean; at: string | null; by: string | null }>(
      `SELECT o.server_id, (o.access_enc IS NOT NULL OR o.refresh_enc IS NOT NULL) AS signed_in, o.signed_in_at AS at, p.display_name AS by
         FROM mcp_server_oauth o LEFT JOIN memberships m ON m.id = o.signed_in_by LEFT JOIN profiles p ON p.id = m.user_id
        WHERE o.server_id = ANY($1::uuid[])`, [ids]));
    return new Map(rows.map((r) => [r.server_id, { signedIn: r.signed_in, by: r.signed_in ? r.by : null, at: r.signed_in ? r.at : null }]));
  } catch (err) {
    if (noteMissing0069(err)) return new Map();
    throw err;
  }
}

async function hintsFor(ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const rows = await withWorker((db) => db.query<{ server_id: string; hint: string | null }>(`SELECT server_id, hint FROM mcp_server_secrets WHERE server_id = ANY($1::uuid[])`, [ids]));
  return new Map(rows.map((r) => [r.server_id, r.hint]));
}

/** Every server in the workspace with its tools (owners and HR). */
export async function listServers(ctx: OrgContext): Promise<McpServerView[]> {
  requireMcpAdmin(ctx);
  return mcpDb(async () => {
    const { servers, tools } = await withUser(ctx.user.profileId, async (db) => ({
      servers: await db.query<ServerRow>(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE organisation_id = $1 ORDER BY lower(name)`, [ctx.org.id]),
      tools: await db.query<ToolRow>(`SELECT ${TOOL_COLUMNS} FROM mcp_tools WHERE organisation_id = $1 ORDER BY gone_at NULLS FIRST, name`, [ctx.org.id]),
    }));
    const hints = await hintsFor(servers.map((s) => s.id));
    const signIns = await signInsFor(servers.filter((s) => s.auth_kind === "oauth").map((s) => s.id));
    return servers.map((s) => serverView(s, tools, hints.get(s.id) ?? null, signIns.get(s.id) ?? null));
  });
}

async function oneServer(ctx: OrgContext, id: string): Promise<McpServerView> {
  const all = await listServers(ctx);
  const s = all.find((x) => x.id === id);
  if (!s) throw notFound();
  return s;
}

// ---- The key ----------------------------------------------------------------------------------------------------------

/** How a server signs in; for "oauth", a client id (and secret) from the app's developer settings, when it won't register Boredroom. */
export type AuthInput = { kind: McpAuthKind; key?: string; header?: string; clientId?: string; clientSecret?: string };
type CheckedAuth = { kind: McpAuthKind; header: string | null; key: string | null; client?: OAuthClient | null };

const CLIENT_VALUE = /^[\x21-\x7e]{1,500}$/;

function checkAuth(a: AuthInput): CheckedAuth {
  if (a.kind === "none") return { kind: "none", header: null, key: null };
  if (a.kind === "oauth") {
    const id = (a.clientId ?? "").trim();
    const secret = (a.clientSecret ?? "").trim();
    if (!id && secret) throw invalid("Add the client ID that goes with the secret.", { clientId: ["Add the client ID."] });
    if (id && !CLIENT_VALUE.test(id)) throw invalid("Enter the client ID as the app shows it.", { clientId: ["Letters, numbers and symbols, no spaces."] });
    if (secret && !CLIENT_VALUE.test(secret)) throw invalid("Enter the client secret as the app shows it.", { clientSecret: ["Letters, numbers and symbols, no spaces."] });
    return { kind: "oauth", header: null, key: null, client: id ? { clientId: id, clientSecret: secret || null, clientAuth: secret ? "client_secret_post" : "none" } : null };
  }
  const key = (a.key ?? "").trim();
  if (!key || key.length > 4000 || /[\r\n\u0000-\u001f\u007f]/.test(key)) throw invalid("Enter the key the server gave you.", { key: ["Enter the key."] });
  if (a.kind === "bearer") return { kind: "bearer", header: null, key: key.replace(/^Bearer\s+/i, "") };
  const header = (a.header ?? "").trim();
  if (!HEADER.test(header) || RESERVED_HEADERS.has(header.toLowerCase())) throw invalid("Enter the header's name, like X-API-Key.", { header: ["Use letters, numbers and dashes; not a header Boredroom sets itself."] });
  return { kind: "header", header, key };
}

const hintOf = (key: string) => { const h = key.slice(-4).replace(/[^A-Za-z0-9_.-]/g, ""); return key.length >= 12 && h ? h : null; };
const authOf = (kind: McpAuthKind, header: string | null, key: string | null): McpAuth =>
  kind === "bearer" && key ? { kind: "bearer", key } : kind === "header" && header && key ? { kind: "header", name: header, value: key } : { kind: "none" };

/**
 * The server as the client needs it, key opened (server contexts only); a signed-in server's access token, refreshed
 * when due or `force`d. Null when its key doesn't open or an admin has to sign in (again).
 */
export async function serverRef(db: Db, s: Pick<ServerRow, "id" | "url" | "auth_kind" | "auth_header">, o: { force?: boolean } = {}): Promise<McpServerRef | null> {
  if (s.auth_kind === "none") return { id: s.id, url: s.url, auth: { kind: "none" } };
  if (s.auth_kind === "oauth") {
    let token: string | null;
    try { token = await oauthAccess(db, s.id, o); }
    catch (err) { if (noteMissing0069(err)) return null; throw err; }
    return token ? { id: s.id, url: s.url, auth: { kind: "bearer", key: token } } : null;
  }
  const row = await db.maybeOne<{ secret: string }>(`SELECT secret FROM mcp_server_secrets WHERE server_id = $1`, [s.id]);
  const key = openToken(row?.secret, secretAad(s.id));
  if (!key) return null;
  return { id: s.id, url: s.url, auth: authOf(s.auth_kind, s.auth_header, key) };
}

/**
 * Runs `fn` with the server's ref (each in its own worker transaction). A signed-in server the server turns away gets one
 * forced refresh and one more try. McpError AUTH_FAILED (a key that doesn't open) or SIGN_IN_NEEDED when there's no ref.
 */
export async function withServerRef<T>(s: Pick<ServerRow, "id" | "url" | "auth_kind" | "auth_header">, fn: (ref: McpServerRef) => Promise<T>): Promise<T> {
  const missing = () => new McpError(s.auth_kind === "oauth" ? "SIGN_IN_NEEDED" : "AUTH_FAILED", "no usable key or sign-in");
  const ref = await withWorker((db) => serverRef(db, s));
  if (!ref) throw missing();
  try { return await fn(ref); }
  catch (err) {
    if (!(s.auth_kind === "oauth" && err instanceof McpError && err.code === "AUTH_FAILED")) throw err;
    const again = await withWorker((db) => serverRef(db, s, { force: true }));
    if (!again) throw missing();
    return fn(again);
  }
}

// ---- Saving what a server lists ------------------------------------------------------------------------------------------------

/** Writes the listing (worker context): new tools start off; a changed tool keeps its old approval, so it stays unusable. */
async function saveListing(db: Db, orgId: string, serverId: string, tools: McpToolInfo[]): Promise<void> {
  const names = tools.map((t) => t.name);
  for (const t of tools) {
    await db.query(
      `INSERT INTO mcp_tools(server_id, organisation_id, name, title, description, input_schema, read_only_hint, destructive_hint, hash)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (server_id, name) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, input_schema = EXCLUDED.input_schema,
         read_only_hint = EXCLUDED.read_only_hint, destructive_hint = EXCLUDED.destructive_hint, hash = EXCLUDED.hash, gone_at = NULL
       WHERE mcp_tools.hash IS DISTINCT FROM EXCLUDED.hash OR mcp_tools.gone_at IS NOT NULL OR mcp_tools.read_only_hint IS DISTINCT FROM EXCLUDED.read_only_hint
         OR mcp_tools.destructive_hint IS DISTINCT FROM EXCLUDED.destructive_hint`,
      [serverId, orgId, t.name, t.title, t.description, JSON.stringify(t.inputSchema), t.readOnlyHint, t.destructiveHint, t.hash]);
  }
  await db.query(`UPDATE mcp_tools SET gone_at = now() WHERE server_id = $1 AND gone_at IS NULL AND NOT (name = ANY($2::text[]))`, [serverId, names]);
}

async function noteCheck(db: Db, serverId: string, o: { ok: true; label: string | null } | { ok: false; code: string }): Promise<void> {
  if (o.ok) {
    await db.query(`UPDATE mcp_servers SET last_checked_at = now(), last_ok_at = now(), last_error_code = NULL, server_label = COALESCE($2, server_label),
      status = CASE WHEN status = 'needs_attention' THEN 'active' ELSE status END WHERE id = $1`, [serverId, o.label]);
  } else {
    await db.query(`UPDATE mcp_servers SET last_checked_at = now(), last_error_code = $2,
      status = CASE WHEN status = 'paused' THEN status ELSE 'needs_attention' END WHERE id = $1`, [serverId, o.code]);
  }
}

const codeOf = (err: unknown) => (err instanceof McpError ? err.code : err instanceof BlockedAddress ? "BLOCKED_ADDRESS" : "SERVER_DOWN");

/** Whether a server that turned Boredroom away offers sign-in instead (a quick look; never throws). */
async function offersSignIn(url: string): Promise<boolean> {
  try { await discover(url); return true; } catch { return false; }
}

/** Where `url` signs in, as words people can act on when it can't. */
async function discoverOrExplain(url: string) {
  try { return await discover(url); }
  catch (err) { throw publicMcpError(err); }
}

// ---- Adding, checking, changing, removing -----------------------------------------------------------------------------------------

export type AddServerInput = { name: string; url: string; useFor?: string | null; auth: AuthInput };

const NAME = (s: string) => s.replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkName(name: string): string {
  const n = NAME(name);
  if (!n || n.length > 60 || CONTROL.test(n)) throw invalid("Give the server a name of up to 60 characters.", { name: ["Up to 60 characters."] });
  return n;
}
function checkUseFor(v: string | null | undefined): string | null {
  const u = typeof v === "string" ? NAME(v) : "";
  if (u.length > 200 || CONTROL.test(u)) throw invalid("Say what it's for in up to 200 characters.", { useFor: ["Up to 200 characters."] });
  return u || null;
}
function checkUrl(raw: string): string {
  try { return checkServerUrl(raw).toString(); }
  catch (err) { if (err instanceof BlockedAddress) throw invalid(MCP_ERRORS.BLOCKED_ADDRESS, { url: [MCP_ERRORS.BLOCKED_ADDRESS] }); throw err; }
}

/**
 * Adds a server: checks the address, connects and lists its tools first (a server that doesn't answer isn't saved), then
 * saves it with every tool off until an admin switches it on.
 */
export async function addServer(ctx: OrgContext, input: AddServerInput): Promise<McpServerView> {
  requireMcpAdmin(ctx);
  const name = checkName(input.name);
  const url = checkUrl(input.url);
  const useFor = checkUseFor(input.useFor);
  const auth = checkAuth(input.auth);
  if (auth.kind === "oauth") return addSignInServer(ctx, { name, url, useFor, client: auth.client ?? null });
  let listed: Awaited<ReturnType<typeof listTools>>;
  try { listed = await listTools({ id: `new:${ctx.org.id}`, url, auth: authOf(auth.kind, auth.header, auth.key) }); }
  catch (err) {
    if (err instanceof McpError && err.code === "AUTH_FAILED" && !schema0069Missing() && (await offersSignIn(url))) {
      throw new AppError(409, "MCP_SIGN_IN_OFFERED", MCP_SIGN_IN_ERRORS.SIGN_IN_OFFERED);
    }
    throw publicMcpError(err);
  }
  const id = await mcpDb(() => withUser(ctx.user.profileId, async (db) => {
    const dup = await db.maybeOne(`SELECT 1 FROM mcp_servers WHERE organisation_id = $1 AND lower(name) = lower($2)`, [ctx.org.id, name]);
    if (dup) throw conflict("MCP_NAME_TAKEN", "Another server already has that name.");
    try {
      const row = await db.one<{ id: string }>(
        `INSERT INTO mcp_servers(organisation_id, name, url, use_for, auth_kind, auth_header, server_label, last_checked_at, last_ok_at, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8) RETURNING id`,
        [ctx.org.id, name, url, useFor, auth.kind, auth.header, listed.serverLabel, ctx.membership.id]);
      await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "mcp.server_added", subjectType: "mcp_server", subjectId: row.id, metadata: { tools: listed.tools.length } });
      return row.id;
    } catch (err) {
      if ((err as { message?: string })?.message?.includes("MCP_SERVERS_FULL")) throw conflict("MCP_SERVERS_FULL", "A workspace can add up to 20 MCP servers.");
      throw err;
    }
  }));
  await withWorker(async (db) => {
    if (auth.key) await db.query(`INSERT INTO mcp_server_secrets(server_id, organisation_id, secret, hint) VALUES ($1, $2, $3, $4)`, [id, ctx.org.id, sealToken(auth.key, secretAad(id)), hintOf(auth.key)]);
    await saveListing(db, ctx.org.id, id, listed.tools);
  });
  return oneServer(ctx, id);
}

/**
 * Adds a server that signs in: where it signs in is found first (a server that doesn't offer it isn't saved), then it
 * is saved waiting for an owner or HR to sign in (Settings goes straight on to that), with no tools yet.
 */
async function addSignInServer(ctx: OrgContext, i: { name: string; url: string; useFor: string | null; client: OAuthClient | null }): Promise<McpServerView> {
  if (schema0069Missing()) throw signInNotReady();
  const found = await discoverOrExplain(i.url);
  const id = await mcpDb(() => withUser(ctx.user.profileId, async (db) => {
    const dup = await db.maybeOne(`SELECT 1 FROM mcp_servers WHERE organisation_id = $1 AND lower(name) = lower($2)`, [ctx.org.id, i.name]);
    if (dup) throw conflict("MCP_NAME_TAKEN", "Another server already has that name.");
    try {
      const row = await db.one<{ id: string }>(
        `INSERT INTO mcp_servers(organisation_id, name, url, use_for, auth_kind, status, last_error_code, added_by)
         VALUES ($1, $2, $3, $4, 'oauth', 'needs_attention', 'SIGN_IN_NEEDED', $5) RETURNING id`,
        [ctx.org.id, i.name, i.url, i.useFor, ctx.membership.id]);
      await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "mcp.server_added", subjectType: "mcp_server", subjectId: row.id, metadata: { signIn: true } });
      return row.id;
    } catch (err) {
      if ((err as { message?: string })?.message?.includes("MCP_SERVERS_FULL")) throw conflict("MCP_SERVERS_FULL", "A workspace can add up to 20 MCP servers.");
      if (noteMissing0069(err)) throw signInNotReady();
      throw err;
    }
  }));
  await signInDb(() => withWorker((db) => saveDiscovery(db, ctx.org.id, id, found, i.client)));
  return oneServer(ctx, id);
}

async function serverRow(ctx: OrgContext, id: string): Promise<ServerRow> {
  const s = await mcpDb(() => withUser(ctx.user.profileId, (db) => db.maybeOne<ServerRow>(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE id = $1 AND organisation_id = $2`, [id, ctx.org.id])));
  if (!s) throw notFound();
  return s;
}

/** Asks the server for its tools again. A failure is recorded on the server and shown, not thrown. */
export async function refreshServer(ctx: OrgContext, id: string): Promise<McpServerView> {
  requireMcpAdmin(ctx);
  const s = await serverRow(ctx, id);
  await refreshTools(s);
  return oneServer(ctx, id);
}

/** Refreshes one server's listing (worker context); the outcome is on its row. */
export async function refreshTools(s: Pick<ServerRow, "id" | "organisation_id" | "url" | "auth_kind" | "auth_header">): Promise<boolean> {
  let listed: Awaited<ReturnType<typeof listTools>>;
  try { listed = await withServerRef(s, (ref) => listTools(ref)); }
  catch (err) {
    if (!(err instanceof McpError || err instanceof BlockedAddress)) throw err;
    await withWorker((db) => noteCheck(db, s.id, { ok: false, code: codeOf(err) }));
    return false;
  }
  await withWorker(async (db) => {
    await saveListing(db, s.organisation_id, s.id, listed.tools);
    await noteCheck(db, s.id, { ok: true, label: listed.serverLabel });
  });
  return true;
}

export type UpdateServerInput = { name?: string; useFor?: string | null; paused?: boolean; auth?: AuthInput };

/** Renames it, says what it's for, pauses or resumes it, or changes its key (a new key is checked first). */
export async function updateServer(ctx: OrgContext, id: string, patch: UpdateServerInput): Promise<McpServerView> {
  requireMcpAdmin(ctx);
  const s = await serverRow(ctx, id);
  const name = patch.name !== undefined ? checkName(patch.name) : undefined;
  const useFor = patch.useFor !== undefined ? checkUseFor(patch.useFor) : undefined;
  const auth = patch.auth ? checkAuth(patch.auth) : null;
  if (auth?.kind === "oauth" && schema0069Missing()) throw signInNotReady();
  const found = auth?.kind === "oauth" ? await discoverOrExplain(s.url) : null;
  if (auth && auth.kind !== "oauth") {
    try { await listTools({ id: `check:${id}`, url: s.url, auth: authOf(auth.kind, auth.header, auth.key) }); }
    catch (err) { throw publicMcpError(err); }
  }
  await mcpDb(() => withUser(ctx.user.profileId, async (db) => {
    if (name && name.toLowerCase() !== s.name.toLowerCase()) {
      const dup = await db.maybeOne(`SELECT 1 FROM mcp_servers WHERE organisation_id = $1 AND lower(name) = lower($2) AND id <> $3`, [ctx.org.id, name, id]);
      if (dup) throw conflict("MCP_NAME_TAKEN", "Another server already has that name.");
    }
    const status = patch.paused === true ? "paused" : patch.paused === false && s.status === "paused" ? "active" : null;
    await db.query(
      `UPDATE mcp_servers SET name = COALESCE($2, name), use_for = CASE WHEN $3::boolean THEN $4 ELSE use_for END, status = COALESCE($5, status),
         auth_kind = COALESCE($6, auth_kind), auth_header = CASE WHEN $6::text IS NULL THEN auth_header ELSE $7 END WHERE id = $1`,
      [id, name ?? null, useFor !== undefined, useFor ?? null, status, auth?.kind ?? null, auth?.header ?? null]);
    if (auth || status) await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: auth ? "mcp.server_key_changed" : `mcp.server_${status === "paused" ? "paused" : "resumed"}`, subjectType: "mcp_server", subjectId: id });
  }));
  if (found) {
    // Switched to signing in (or its client changed): the key goes, and an admin signs in next.
    await signInDb(() => withWorker(async (db) => {
      await saveDiscovery(db, ctx.org.id, id, found, auth?.client ?? null);
      await db.query(`DELETE FROM mcp_server_secrets WHERE server_id = $1`, [id]);
      if (s.auth_kind !== "oauth" || auth?.client) await markSignInNeeded(db, id);
    }));
    if (s.auth_kind === "oauth" && !auth?.client) await refreshTools({ ...s });
  } else if (auth) {
    if (s.auth_kind === "oauth") await forgetSignIn(id);
    await withWorker(async (db) => {
      if (auth.key) {
        await db.query(`INSERT INTO mcp_server_secrets(server_id, organisation_id, secret, hint) VALUES ($1, $2, $3, $4)
          ON CONFLICT (server_id) DO UPDATE SET secret = EXCLUDED.secret, hint = EXCLUDED.hint`, [id, ctx.org.id, sealToken(auth.key, secretAad(id)), hintOf(auth.key)]);
      } else {
        await db.query(`DELETE FROM mcp_server_secrets WHERE server_id = $1`, [id]);
      }
    });
    await refreshTools({ ...s, auth_kind: auth.kind, auth_header: auth.header });
  }
  return oneServer(ctx, id);
}

/** Switches one tool off, or on as read or act, approving it as the server describes it now. */
export async function setToolAccess(ctx: OrgContext, serverId: string, toolId: string, access: McpAccess): Promise<McpServerView> {
  requireMcpAdmin(ctx);
  await mcpDb(() => withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ hash: string; gone_at: string | null; name: string; access: McpAccess }>(
      `SELECT hash, gone_at, name, access FROM mcp_tools WHERE id = $1 AND server_id = $2 AND organisation_id = $3`, [toolId, serverId, ctx.org.id]);
    if (!t) throw notFound();
    if (t.gone_at && access !== "off") throw conflict("MCP_TOOL_GONE", "The server doesn't list this tool any more.");
    await db.query(`UPDATE mcp_tools SET access = $2, approved_hash = $3 WHERE id = $1`, [toolId, access, access === "off" ? null : t.hash]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "mcp.tool_access", subjectType: "mcp_tool", subjectId: toolId, metadata: { serverId, tool: t.name, from: t.access, to: access } });
  }));
  return oneServer(ctx, serverId);
}

/** Removes the server, its key and its tools. */
export async function removeServer(ctx: OrgContext, id: string): Promise<{ removed: true }> {
  requireMcpAdmin(ctx);
  const s = await serverRow(ctx, id);
  if (s.auth_kind === "oauth") await forgetSignIn(id);
  await mcpDb(() => withUser(ctx.user.profileId, async (db) => {
    await db.query(`DELETE FROM mcp_servers WHERE id = $1 AND organisation_id = $2`, [id, ctx.org.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "mcp.server_removed", subjectType: "mcp_server", subjectId: id });
  }));
  return { removed: true };
}

/** Revokes a server's tokens at its sign-in service (best effort) and forgets where it signs in. */
async function forgetSignIn(serverId: string): Promise<void> {
  if (schema0069Missing()) return;
  try {
    const row = await withWorker((db) => loadOAuth(db, serverId));
    if (row) await revokeTokens(row);
    await withWorker((db) => db.query(`DELETE FROM mcp_server_oauth WHERE server_id = $1`, [serverId]));
  } catch (err) {
    if (!noteMissing0069(err)) console.warn(`[mcp] could not forget a server's sign-in: ${(err as { code?: string })?.code ?? "error"}`);
  }
}

/** Whether signing in is ready on this database (0069): Settings offers it only then. */
export async function mcpSignInReady(): Promise<boolean> {
  if (schema0069Missing()) return false;
  const r = await withWorker((db) => db.one<{ ok: boolean }>(`SELECT to_regclass('public.mcp_server_oauth') IS NOT NULL AS ok`));
  return r.ok;
}
