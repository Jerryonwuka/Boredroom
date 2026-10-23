/**
 * Connected apps: connecting (owner decisions, 22 October 2026: connectors; spec §5, §15, §16.3). Start and callback with
 * the fake provider and with a PKCE adapter whose token endpoint and API are mocked (no real provider is ever called).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import { beginConnect, completeConnect, resetStartSpacingForTests } from "@/server/connectors/oauth";
import { setAdapterForTests, stubAdapter } from "@/server/connectors/registry";
import { updateConnection } from "@/server/connectors/connections";
import { ConnectorError, type ProviderAdapter } from "@/server/connectors/types";
import { fakeServer } from "@/server/connectors/adapters/fake";
import { sha256Hex } from "@/server/connectors/crypto";

let a: CompanyFixture;
let mock: ProviderMock;
const saved = process.env.CONNECTORS_FAKE;
const LINEAR_TOKEN = "lin_oauth_secret_token_123";
let account = "lin-user-1";
let grantedScope = "read";

/** A stand-in Linear adapter (PKCE, comma scopes), its token endpoint and its API mocked. */
const testLinear: ProviderAdapter = {
  ...stubAdapter("linear"),
  hosts: ["api.linear.app"], linkHosts: ["linear.app"], env: ["X"],
  configured: () => true,
  oauth: {
    authorizeUrl: "https://linear.app/oauth/authorize", tokenUrl: "https://api.linear.app/oauth/token",
    clientId: () => "lin-client", clientSecret: () => "lin-secret", clientAuth: "body", tokenBody: "form", pkce: "S256", scopeSeparator: ",",
    scopes: ({ act }) => (act ? ["read", "write"] : ["read"]),
    parseToken: (body, now) => {
      const b = body as Record<string, unknown>;
      if (typeof b.error === "string") throw new ConnectorError("REAUTH_REQUIRED", "error");
      return { accessToken: String(b.access_token), refreshToken: String(b.refresh_token), tokenType: "bearer", expiresAt: new Date(now.getTime() + 86_400_000), refreshExpiresAt: null, scopes: String(b.scope).split(",") };
    },
    refresh: "rotating",
  },
  identify: async ({ http }) => {
    const me = (await http.request<{ data: { viewer: { id: string; email: string } } }>({ method: "POST", url: "https://api.linear.app/graphql", json: { query: "{ viewer { id email } }" } })).body.data.viewer;
    return { externalAccountId: me.id, externalTenantId: "org-1", accountLabel: me.email, identity: { externalUserId: me.id, email: me.email } };
  },
  streams: [],
};

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  setAdapterForTests("linear", testLinear);
  mock = mockProviders({
    "POST https://api.linear.app/oauth/token": (req) => {
      const f = req.form();
      if (f.grant_type !== "authorization_code" || f.code !== "good-code" || !f.code_verifier || f.redirect_uri !== "http://localhost:3000/api/connectors/linear/callback" || f.client_secret !== "lin-secret") return { status: 400, json: { error: "invalid_grant" } };
      return { json: { access_token: LINEAR_TOKEN, refresh_token: "lin_refresh_secret", expires_in: 86400, scope: grantedScope } };
    },
    "POST https://api.linear.app/graphql": () => ({ json: { data: { viewer: { id: account, email: "ada@example.com" } } } }),
  });
});
afterAll(() => { mock.restore(); setAdapterForTests("linear", null); forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });
beforeEach(() => { resetStartSpacingForTests(); account = "lin-user-1"; grantedScope = "read"; });

const callback = (state: string, extra: Record<string, string> = {}) => new URLSearchParams({ code: "good-code", state, ...extra });

describe("start", () => {
  it("the URL carries state, PKCE S256 and the scopes; the state is stored only as its hash", async () => {
    const s = await beginConnect(a.employeeCtx, "linear", { kind: "personal", act: false });
    const q = new URL(s.url).searchParams;
    expect(q.get("state")).toBe(s.state);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("scope")).toBe("read");
    expect(s.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await adminQuery<{ state_hash: string; verifier_enc: string }>(`SELECT state_hash, verifier_enc FROM connector_oauth_states ORDER BY created_at DESC LIMIT 1`);
    expect(rows[0].state_hash).toBe(sha256Hex(s.state));
    expect(rows[0].verifier_enc).toMatch(/^v1\./);
  });

  it("refusals: staff can't connect for the workspace; the policy; the plan; impersonation; spacing", async () => {
    await expect(beginConnect(a.employeeCtx, "linear", { kind: "workspace" })).rejects.toMatchObject({ status: 403 });
    resetStartSpacingForTests();
    await adminQuery(`INSERT INTO connector_policies(organisation_id, provider, personal_allowed) VALUES ($1, 'linear', false)`, [a.ownerCtx.org.id]);
    await expect(beginConnect(a.employeeCtx, "linear", { kind: "personal" })).rejects.toMatchObject({ status: 403 });
    await adminQuery(`DELETE FROM connector_policies WHERE organisation_id = $1`, [a.ownerCtx.org.id]);
    const noPlan = { ...a.employeeCtx, plan: { ...a.employeeCtx.plan, features: { ...a.employeeCtx.plan.features, CONNECTORS: false } } };
    await expect(beginConnect(noPlan, "linear", { kind: "personal" })).rejects.toMatchObject({ status: 402 });
    const imp = { ...a.employeeCtx, user: { ...a.employeeCtx.user, impersonation: { id: "x", adminEmail: "s@example.com" } } };
    await expect(beginConnect(imp, "linear", { kind: "personal" })).rejects.toMatchObject({ status: 403 });
    await beginConnect(a.employeeCtx, "linear", { kind: "personal" });
    await expect(beginConnect(a.employeeCtx, "linear", { kind: "personal" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("the callback", () => {
  it("happy path: tokens sealed, identity kept, sync queued, audit without audit_events for a personal connection", async () => {
    const s = await beginConnect(a.employeeCtx, "linear", { kind: "personal", act: false });
    const r = await completeConnect({ provider: "linear", query: callback(s.state), cookieState: s.state, user: a.employeeCtx.user });
    expect(r.ok).toBe(true);
    expect(r.location).toBe(`/app/${a.slug}/settings?section=assistant&connected=linear`);
    const tok = await adminQuery<{ access_enc: string; refresh_enc: string }>(`SELECT access_enc, refresh_enc FROM connector_tokens WHERE connection_id = $1`, [r.connectionId]);
    expect(tok[0].access_enc).not.toContain(LINEAR_TOKEN);
    expect(tok[0].refresh_enc).not.toContain("lin_refresh_secret");
    const ids = await adminQuery(`SELECT external_user_id FROM connector_identities WHERE connection_id = $1`, [r.connectionId]);
    expect(ids).toEqual([{ external_user_id: "lin-user-1" }]);
    const audit = await adminQuery<{ action: string; kind: string }>(`SELECT action, kind FROM connector_audit WHERE connection_id = $1 OR (provider = 'linear' AND action = 'connect.started') ORDER BY created_at`, [r.connectionId]);
    expect(audit.map((x) => x.action)).toContain("connect.ok");
    expect((await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'connector.%' AND subject_id = $1`, [r.connectionId]))[0].n).toBe(0);
    const code = mock.calls.find((c) => c.url.endsWith("/oauth/token"))!;
    expect(code.body).toContain("code_verifier=");
  });

  it("single use; a missing or different cookie; another person's session; an error from the app", async () => {
    const s = await beginConnect(a.employee2Ctx, "linear", { kind: "personal" });
    expect((await completeConnect({ provider: "linear", query: callback(s.state), cookieState: null, user: a.employee2Ctx.user })).code).toBe("mismatch");
    expect((await completeConnect({ provider: "linear", query: callback(s.state), cookieState: "different", user: a.employee2Ctx.user })).code).toBe("mismatch");
    // The cookie mismatch never claimed the row: the right cookie but another person's session is refused, and that uses it.
    expect((await completeConnect({ provider: "linear", query: callback(s.state), cookieState: s.state, user: a.employeeCtx.user })).code).toBe("mismatch");
    expect((await completeConnect({ provider: "linear", query: callback(s.state), cookieState: s.state, user: a.employee2Ctx.user })).code).toBe("mismatch");
    resetStartSpacingForTests();
    const t = await beginConnect(a.employee2Ctx, "linear", { kind: "personal" });
    const denied = await completeConnect({ provider: "linear", query: new URLSearchParams({ error: "access_denied", error_description: "<script>alert(1)</script>", state: t.state }), cookieState: t.state, user: a.employee2Ctx.user });
    expect(denied.code).toBe("cancelled");
    expect(denied.location).not.toContain("script");
    expect(denied.location).toContain("connector_app=linear");
  });

  it("expired after 10 minutes", async () => {
    const s = await beginConnect(a.managerCtx, "linear", { kind: "personal" });
    await adminQuery(`UPDATE connector_oauth_states SET expires_at = now() - interval '1 second' WHERE state_hash = $1`, [sha256Hex(s.state)]);
    expect((await completeConnect({ provider: "linear", query: callback(s.state), cookieState: s.state, user: a.managerCtx.user })).code).toBe("expired");
  });

  it("a role lost between start and callback", async () => {
    const s = await beginConnect(a.hrCtx, "fake", { kind: "workspace" });
    await adminQuery(`UPDATE memberships SET role = 'employee' WHERE id = $1`, [a.hrCtx.membership.id]);
    try {
      const url = new URL(s.url);
      expect((await completeConnect({ provider: "fake", query: url.searchParams, cookieState: s.state, user: a.hrCtx.user })).code).toBe("not_allowed");
    } finally { await adminQuery(`SELECT set_config('app.role', 'worker', false); UPDATE memberships SET role = 'hr' WHERE id = '${a.hrCtx.membership.id}'`); }
  });

  it("reconnect with a different account is refused; upgrade sets can_act only when the scopes were granted", async () => {
    const first = await (async () => { const s = await beginConnect(a.managerCtx, "linear", { kind: "personal", act: false }); return completeConnect({ provider: "linear", query: callback(s.state), cookieState: s.state, user: a.managerCtx.user }); })();
    expect(first.ok).toBe(true);
    const id = first.connectionId!;
    resetStartSpacingForTests();
    account = "someone-else";
    const re = await beginConnect(a.managerCtx, "linear", { kind: "personal", purpose: "reconnect", connectionId: id });
    expect((await completeConnect({ provider: "linear", query: callback(re.state), cookieState: re.state, user: a.managerCtx.user })).code).toBe("different_account");
    account = "lin-user-1";
    expect(await updateConnection(a.managerCtx, id, { canAct: true })).toEqual({ needsConsent: true });
    resetStartSpacingForTests();
    grantedScope = "read"; // the app granted less than asked
    const up = await beginConnect(a.managerCtx, "linear", { kind: "personal", purpose: "upgrade", connectionId: id });
    expect(new URL(up.url).searchParams.get("scope")).toBe("read,write");
    await completeConnect({ provider: "linear", query: callback(up.state), cookieState: up.state, user: a.managerCtx.user });
    expect((await adminQuery<{ can_act: boolean }>(`SELECT can_act FROM connector_connections WHERE id = $1`, [id]))[0].can_act).toBe(false);
    resetStartSpacingForTests();
    grantedScope = "read,write";
    const up2 = await beginConnect(a.managerCtx, "linear", { kind: "personal", purpose: "upgrade", connectionId: id });
    await completeConnect({ provider: "linear", query: callback(up2.state), cookieState: up2.state, user: a.managerCtx.user });
    expect((await adminQuery<{ can_act: boolean }>(`SELECT can_act FROM connector_connections WHERE id = $1`, [id]))[0].can_act).toBe(true);
  });

  it("the fake connects end to end; a workspace connection is audited in audit_events too, ids only", async () => {
    const id = await connectFake(a.ownerCtx, "workspace");
    const ev = await adminQuery<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'connector.connected' AND subject_id = $1`, [id]);
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0].metadata).sort()).toEqual(["connectionId", "provider"]);
  });
});
