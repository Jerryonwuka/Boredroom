/**
 * Signing in to MCP servers (owner request, 4 November 2026: phase 1b), against a local database and the in-process fake
 * MCP server in its sign-in mode (no network, no account, no model):
 * - before migration 0069: Settings isn't offered signing in, adding a server that signs in answers NOT_READY, and keys
 *   keep working;
 * - with 0069 applied here by hand: an owner adds a server that signs in (found from its 401, resource metadata and
 *   authorization server metadata; saved waiting for sign-in, no tools); Boredroom registers itself and the sign-in URL
 *   carries PKCE S256, the resource and the scopes; the callback checks the cookie, the state (once, 10 minutes), the
 *   person and their role, exchanges the code, seals the tokens and lists the tools; Brenda reads with the token; an
 *   access token the server turns away is refreshed once (and the old refresh token stops working); a refused refresh
 *   asks an admin to sign in again; removing revokes;
 * - a server that won't register Boredroom needs a client id; a server that asks for sign-in when added with no key says
 *   so; switching a server between a key and signing in.
 *
 * Company A: Grace Owner, Mary HR, David Lead, Ada Obi. Local test database only (TEST_DATABASE_URL on localhost).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { runBrendaTool } from "@/server/services/copilot";
import { forget0068 } from "@/server/lib/schema-0068";
import { forget0069 } from "@/server/lib/schema-0069";
import { addServer, listServers, mcpSignInReady, removeServer, setToolAccess, updateServer } from "@/server/connectors/mcp/servers";
import { beginSignIn, completeSignIn, resetMcpStartSpacingForTests } from "@/server/connectors/mcp/signin";
import { mcpRedirectUri } from "@/server/connectors/mcp/oauth";
import { forgetMcpSessions } from "@/server/connectors/mcp/client";
import { startFakeMcpServer, type FakeMcpServer } from "@/server/connectors/mcp/fake";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, ada: OrgContext;
let fake: FakeMcpServer, closed: FakeMcpServer, keyed: FakeMcpServer;
const out = (r: { out: unknown }) => r.out as Record<string, unknown>;

/** Starts sign-in as `ctx` and approves it at the fake: what the browser would bring back, and the cookie. */
async function signIn(ctx: OrgContext, serverId: string, server = fake, o: { deny?: boolean } = {}) {
  resetMcpStartSpacingForTests();
  const started = await beginSignIn(ctx, serverId);
  const back = server.approve(started.url, o);
  return { started, query: new URL(back.redirect).searchParams, cookieState: started.state };
}

beforeAll(async () => {
  await resetTestDatabase();
  // 0069 is in db/migrations now (owner, 4 November 2026), so the reset database has it: take it away to start from a
  // database without it, as before.
  await adminQuery(`DROP TABLE IF EXISTS mcp_oauth_states, mcp_server_oauth CASCADE;
    ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_auth_check;
    ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_auth_check CHECK (auth_kind IN ('none', 'bearer', 'header'));`);
  forget0068(); forget0069();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; hr = a.hrCtx; ada = a.employeeCtx;
  fake = startFakeMcpServer({ host: "signin.fake.test", oauth: {} });
  closed = startFakeMcpServer({ host: "closed.fake.test", oauth: { registration: false } });
  keyed = startFakeMcpServer({ host: "keyed.fake.test", key: "fake-key-123456" });
});
afterAll(() => { fake.stop(); closed.stop(); keyed.stop(); forget0069(); forgetMcpSessions(); });
beforeEach(() => forgetMcpSessions());

describe("before migration 0069", () => {
  it("signing in isn't offered, and keys keep working", async () => {
    expect(await mcpSignInReady()).toBe(false);
    await expect(addServer(owner, { name: "Signs in", url: fake.url, auth: { kind: "oauth" } })).rejects.toMatchObject({ code: "NOT_READY" });
    const s = await addServer(owner, { name: "Keyed", url: keyed.url, auth: { kind: "bearer", key: "fake-key-123456" } });
    expect(s).toMatchObject({ authKind: "bearer", signIn: null, status: "active" });
    expect((await listServers(owner)).map((x) => x.name)).toEqual(["Keyed"]);
  });
});

describe("with 0069", () => {
  let serverId: string;

  beforeAll(async () => {
    const sql = readFileSync(join(process.cwd(), "db", "migrations", "0069_mcp_oauth.sql"), "utf8");
    await adminQuery(sql);
    await adminQuery(sql); // idempotent
    forget0069();
  });

  it("an owner adds a server that signs in: found from its 401, saved waiting for sign-in, no tools", async () => {
    expect(await mcpSignInReady()).toBe(true);
    const s = await addServer(owner, { name: "Notes", url: fake.url, useFor: "the team's notes", auth: { kind: "oauth" } });
    serverId = s.id;
    expect(s).toMatchObject({ authKind: "oauth", status: "needs_attention", signIn: { signedIn: false, by: null, at: null }, tools: [] });
    const [row] = await adminQuery<{ issuer: string; token_url: string; resource: string; scopes: string; client_id: string | null }>(
      `SELECT issuer, token_url, resource, scopes, client_id FROM mcp_server_oauth WHERE server_id = $1`, [serverId]);
    expect(row).toEqual({ issuer: "https://signin.fake.test", token_url: "https://signin.fake.test/token", resource: fake.url, scopes: "notes:read notes:write", client_id: null });
  });

  it("only owners and HR start signing in", async () => {
    await expect(beginSignIn(ada, serverId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(beginSignIn(a.managerCtx, serverId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await appQueryAs(ada.user.profileId, `SELECT * FROM mcp_server_oauth`)).toEqual([]);
    expect(await appQueryAs(owner.user.profileId, `SELECT * FROM mcp_oauth_states`)).toEqual([]);
  });

  it("the sign-in URL: Boredroom registered itself, PKCE S256, the resource, the scopes and a state", async () => {
    resetMcpStartSpacingForTests();
    const { url } = await beginSignIn(owner, serverId);
    const q = new URL(url).searchParams;
    expect(url.startsWith("https://signin.fake.test/authorize?")).toBe(true);
    expect(Object.fromEntries(["response_type", "client_id", "redirect_uri", "code_challenge_method", "resource", "scope"].map((k) => [k, q.get(k)]))).toEqual({
      response_type: "code", client_id: "fake-client-1", redirect_uri: mcpRedirectUri(), code_challenge_method: "S256", resource: fake.url, scope: "notes:read notes:write",
    });
    expect(q.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Started again within 10 seconds: refused.
    await expect(beginSignIn(owner, serverId)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("the callback refuses a different cookie, another person, and a state used or expired", async () => {
    const first = await signIn(owner, serverId);
    expect(await completeSignIn({ query: first.query, cookieState: "someone-else", user: owner.user })).toMatchObject({ ok: false, code: "mismatch" });
    expect(await completeSignIn({ query: first.query, cookieState: first.cookieState, user: hr.user })).toMatchObject({ ok: false, code: "mismatch" });
    // That state is spent now (the person check comes after claiming it).
    expect(await completeSignIn({ query: first.query, cookieState: first.cookieState, user: owner.user })).toMatchObject({ ok: false, code: "mismatch" });
    const late = await signIn(owner, serverId);
    await adminQuery(`UPDATE mcp_oauth_states SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
    expect(await completeSignIn({ query: late.query, cookieState: late.cookieState, user: owner.user })).toMatchObject({ ok: false, code: "expired" });
    const denied = await signIn(owner, serverId, fake, { deny: true });
    const r = await completeSignIn({ query: denied.query, cookieState: denied.cookieState, user: owner.user });
    expect(r).toMatchObject({ ok: false, code: "cancelled" });
    expect(r.location).toBe(`/app/${owner.org.slug}/settings?section=connectors&mcp_error=cancelled`);
    expect((await listServers(owner)).find((s) => s.id === serverId)!.signIn).toEqual({ signedIn: false, by: null, at: null });
  });

  it("signing in stores sealed tokens and lists the tools, all off", async () => {
    const { query, cookieState } = await signIn(owner, serverId);
    const r = await completeSignIn({ query, cookieState, user: owner.user });
    expect(r).toMatchObject({ ok: true, location: `/app/${owner.org.slug}/settings?section=connectors&mcp_signed_in=${serverId}` });
    const s = (await listServers(owner)).find((x) => x.id === serverId)!;
    expect(s).toMatchObject({ status: "active", problem: null, signIn: { signedIn: true, by: "Grace Owner" } });
    expect(s.tools.map((t) => [t.name, t.access])).toEqual([["create_note", "off"], ["search_notes", "off"]]);
    const [row] = await adminQuery<{ access_enc: string; refresh_enc: string }>(`SELECT access_enc, refresh_enc FROM mcp_server_oauth WHERE server_id = $1`, [serverId]);
    expect(row.access_enc).toMatch(/^v1\./);
    expect(row.refresh_enc).toMatch(/^v1\./);
    for (const t of fake.oauth.access.keys()) expect(JSON.stringify(row)).not.toContain(t);
    expect(fake.oauth.grants.every((g) => g.resource === fake.url)).toBe(true);
  });

  it("Brenda reads with the token; one the server turns away is refreshed once, and the old refresh token stops working", async () => {
    const s = (await listServers(owner)).find((x) => x.id === serverId)!;
    await setToolAccess(owner, serverId, s.tools.find((t) => t.name === "search_notes")!.id, "read");
    const read = () => runBrendaTool(ada, "use_app_tool", { app: "Notes", tool: "search_notes", input: { q: "launch" } });
    expect(String(out(await read()).block)).toContain("Launch checklist");
    const refreshesBefore = fake.oauth.grants.filter((g) => g.grant === "refresh_token").length;
    const oldRefresh = [...fake.oauth.refresh.keys()];
    fake.expireAccess();
    forgetMcpSessions();
    expect(String(out(await read()).block)).toContain("Launch checklist");
    expect(fake.oauth.grants.filter((g) => g.grant === "refresh_token").length).toBe(refreshesBefore + 1);
    for (const r of oldRefresh) expect(fake.oauth.refresh.has(r)).toBe(false);
  });

  it("a refused refresh asks an admin to sign in again, and Brenda says so", async () => {
    fake.revokeAll();
    fake.expireAccess();
    forgetMcpSessions();
    expect(out(await runBrendaTool(ada, "use_app_tool", { app: "Notes", tool: "search_notes", input: { q: "launch" } })).error).toMatch(/needs signing in again/);
    const s = (await listServers(owner)).find((x) => x.id === serverId)!;
    expect(s).toMatchObject({ status: "needs_attention", signIn: { signedIn: false } });
    const [row] = await adminQuery<{ access_enc: string | null; refresh_enc: string | null }>(`SELECT access_enc, refresh_enc FROM mcp_server_oauth WHERE server_id = $1`, [serverId]);
    expect(row).toEqual({ access_enc: null, refresh_enc: null });
  });

  it("HR signs in again (the same registered client), and the tool approvals still hold", async () => {
    const { started, query, cookieState } = await signIn(hr, serverId);
    expect(new URL(started.url).searchParams.get("client_id")).toBe("fake-client-1");
    expect(await completeSignIn({ query, cookieState, user: hr.user })).toMatchObject({ ok: true });
    expect((await listServers(owner)).find((x) => x.id === serverId)).toMatchObject({ status: "active", signIn: { signedIn: true, by: "Mary HR" } });
    expect(String(out(await runBrendaTool(ada, "use_app_tool", { app: "Notes", tool: "search_notes", input: { q: "x" } })).block)).toContain("Launch checklist");
  });

  it("someone who stopped being an admin can't finish a sign-in they started", async () => {
    const pending = await signIn(hr, serverId);
    // Only an owner may change an HR membership (the role guard): as Grace.
    const asOwner = (role: string) => adminQuery(
      `BEGIN; SELECT set_config('app.user_id', '${owner.user.profileId}', true); UPDATE memberships SET role = '${role}' WHERE id = '${hr.membership.id}'; COMMIT;`);
    await asOwner("manager");
    try {
      const r = await completeSignIn({ query: pending.query, cookieState: pending.cookieState, user: hr.user });
      expect(r).toMatchObject({ ok: false, code: "not_allowed", location: `/app/${owner.org.slug}/settings?section=connectors&mcp_error=not_allowed` });
    } finally {
      await asOwner("hr");
    }
  });

  it("a server that won't register Boredroom needs a client id from the app", async () => {
    const s = await addServer(owner, { name: "Closed", url: closed.url, auth: { kind: "oauth" } });
    resetMcpStartSpacingForTests();
    await expect(beginSignIn(owner, s.id)).rejects.toMatchObject({ code: "MCP_NO_REGISTRATION" });
    await updateServer(owner, s.id, { auth: { kind: "oauth", clientId: "given-client", clientSecret: "given-secret" } });
    resetMcpStartSpacingForTests();
    expect(new URL((await beginSignIn(owner, s.id)).url).searchParams.get("client_id")).toBe("given-client");
    const [row] = await adminQuery<{ client_secret_enc: string; client_auth: string }>(`SELECT client_secret_enc, client_auth FROM mcp_server_oauth WHERE server_id = $1`, [s.id]);
    expect(row.client_auth).toBe("client_secret_post");
    expect(row.client_secret_enc).toMatch(/^v1\./);
    await removeServer(owner, s.id);
  });

  it("adding a server that asks for sign-in with no key says to sign in", async () => {
    await expect(addServer(owner, { name: "Try", url: fake.url, auth: { kind: "none" } })).rejects.toMatchObject({ code: "MCP_SIGN_IN_OFFERED" });
    await expect(addServer(owner, { name: "Keyless", url: keyed.url, auth: { kind: "oauth" } })).rejects.toMatchObject({ code: "MCP_NO_SIGN_IN" });
  });

  it("a server switches from a key to signing in and back", async () => {
    const keyedId = (await listServers(owner)).find((x) => x.name === "Keyed")!.id;
    await expect(updateServer(owner, keyedId, { auth: { kind: "oauth" } })).rejects.toMatchObject({ code: "MCP_NO_SIGN_IN" });
    const switched = await updateServer(owner, serverId, { auth: { kind: "bearer", key: "not-the-key-xx" } }).catch((e: { code?: string }) => e);
    expect(switched).toMatchObject({ code: "MCP_AUTH_FAILED" });
    expect((await listServers(owner)).find((x) => x.id === serverId)).toMatchObject({ authKind: "oauth", signIn: { signedIn: true } });
  });

  it("removing a server revokes its tokens and forgets its sign-in", async () => {
    const before = fake.oauth.revoked.length;
    await removeServer(owner, serverId);
    expect(fake.oauth.revoked.length).toBe(before + 2);
    expect(await adminQuery(`SELECT 1 FROM mcp_server_oauth WHERE server_id = $1`, [serverId])).toEqual([]);
    expect(await adminQuery(`SELECT 1 FROM mcp_oauth_states WHERE server_id = $1`, [serverId])).toEqual([]);
  });
});
