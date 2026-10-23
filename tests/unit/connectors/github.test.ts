/**
 * GitHub adapter and GitHub App helpers (work group, owner decisions 22 October 2026: connectors; spec §5.3, §8.7, §16.2).
 * No database, no network: answers from tests/fixtures/connectors/github (written from GitHub's REST and webhook docs).
 * The App's key pair is generated here; nothing real is used.
 */
import { createHash, createHmac, generateKeyPairSync, verify as verifySig, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adapter, mintGithubTokens, parseItemId, parseToken, routeGithub } from "@/server/connectors/adapters/github";
import { appJwt, clearInstallationTokenCacheForTests, privateKeyFrom } from "@/server/connectors/adapters/github-app";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fakeTokens, fixture, mockProviders, type MockReply, type ProviderMock } from "@/server/connectors/testing";
import type { ActInput, ActionSpec, Actor, ConnectionRef, NormalisedItem, StoredItem, StoredSource, SyncSink } from "@/server/connectors/types";

const API = "https://api.github.com";
const saved = { ...process.env };
let publicKey: KeyObject;
let pem: string;

const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", provider: "github", kind: "personal",
  membershipId: "33333333-3333-4333-8333-333333333333", connectedBy: "33333333-3333-4333-8333-333333333333", externalAccountId: "9001",
  externalTenantId: null, accountLabel: "ada-obi", scopes: [], settings: { login: "ada-obi" }, canRead: true, canAct: true, ...over,
});
const workspace = () => conn({ kind: "workspace", membershipId: null, externalAccountId: "installation:42", externalTenantId: "42", accountLabel: "acme (GitHub)",
  settings: { login: "ada-obi", userId: "9001", accountType: "Organization", accountLogin: "acme", accountId: "7001" } });
const deps = (backoffs: number[] = []): HttpDeps => ({ token: async () => ({ accessToken: "test-access", expiresAt: null }), refresh: async () => "test-access", backoff: async (s) => { backoffs.push(s); } });
const http = (c: ConnectionRef, b?: number[]) => httpFor(c, adapter, deps(b));
const actor: Actor = { membershipId: "33333333-3333-4333-8333-333333333333", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const item: StoredItem = {
  id: "44444444-4444-4444-8444-444444444444", externalId: "acme/web#12", externalKey: "acme/Web#12", kind: "issue", title: "Fix the login loop",
  url: null, state: "open", containerLabel: "acme/Web", sourceExternalId: "acme/web", assigneeExternalId: "9001", startsAt: null, endsAt: null, guests: null, response: null,
};
const repo: StoredSource = { id: "55555555-5555-4555-8555-555555555555", kind: "repo", externalId: "acme/web", label: "acme/Web", members: null };
const spec = (name: string) => adapter.actions.find((a) => a.name === name) as ActionSpec;
const act = (c: ConnectionRef, input: Record<string, unknown>, o: { item?: StoredItem | null; source?: StoredSource | null } = {}): ActInput<Record<string, unknown>> =>
  ({ conn: c, http: http(c), actor, input, item: o.item === undefined ? item : o.item, source: o.source ?? null, now: new Date("2026-10-22T09:00:00Z") });
function sink() {
  const s = { upserts: [] as NormalisedItem[], open: [] as string[][] };
  const api: SyncSink = { upsert: async (i) => { s.upserts.push(...i); }, gone: async () => undefined, reconcileWindow: async () => undefined, reconcileOpen: async (_k, ids) => { s.open.push(ids); } };
  return { s, api };
}
const list = (name: string) => fixture<{ list: unknown[] }>(name).list;
const lastJson = () => JSON.parse(mock.calls.at(-1)!.body!) as Record<string, unknown>;

let mock: ProviderMock;
beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = pair.publicKey;
  pem = pair.privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  Object.assign(process.env, {
    GITHUB_APP_ID: "123456", GITHUB_APP_SLUG: "boredroom-test", GITHUB_APP_CLIENT_ID: "Iv23testclient", GITHUB_APP_CLIENT_SECRET: "gh-secret",
    GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n"), GITHUB_APP_WEBHOOK_SECRET: "gh-webhook-secret", APP_ORIGIN: "https://boredroom.test",
  });
  mock = mockProviders({});
});
afterAll(() => { mock.restore(); process.env = saved; });
beforeEach(() => { mock.calls.length = 0; clearInstallationTokenCacheForTests(); });

function checkJwt(authorization: string | null) {
  const m = /^Bearer (.+)\.(.+)\.(.+)$/.exec(authorization ?? "");
  expect(m).not.toBeNull();
  const ok = verifySig("sha256", Buffer.from(`${m![1]}.${m![2]}`), publicKey, Buffer.from(m![3], "base64url"));
  expect(ok).toBe(true);
  return JSON.parse(Buffer.from(m![2], "base64url").toString()) as { iat: number; exp: number; iss: string };
}

describe("the App's JWT and key", () => {
  it("RS256, signed with the App's key: iss is the App id, iat 60 s back, exp 9 minutes on", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const claims = checkJwt(`Bearer ${appJwt(now)}`);
    expect(claims).toEqual({ iat: 1792659540, exp: 1792660140, iss: "123456" });
    expect(JSON.parse(Buffer.from(appJwt(now).split(".")[0], "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("the key as a PEM with \\n escapes, or base64 of the file; anything else is NOT_CONFIGURED without its value", () => {
    expect(privateKeyFrom(pem.replace(/\n/g, "\\n")).type).toBe("private");
    expect(privateKeyFrom(Buffer.from(pem).toString("base64")).type).toBe("private");
    try { privateKeyFrom("not-a-key-SECRETVALUE"); expect.unreachable(); } catch (e) {
      expect(e).toMatchObject({ code: "NOT_CONFIGURED" });
      expect(String((e as Error).message)).not.toContain("SECRETVALUE");
    }
  });
});

describe("OAuth", () => {
  it("workspace starts with the installation; personal is the user authorisation with PKCE and no scopes", () => {
    expect(adapter.begin!({ kind: "workspace", state: "S T" })).toEqual({ url: "https://github.com/apps/boredroom-test/installations/new?state=S%20T" });
    expect(adapter.begin!({ kind: "personal", state: "S" })).toBeNull();
    const q = new URL(authorizeUrl(adapter, { kind: "personal", act: true, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "personal", act: true }) })).searchParams;
    expect(q.get("client_id")).toBe("Iv23testclient");
    expect(q.get("code_challenge")).toBe("C");
    expect(q.get("scope")).toBeNull();
  });

  it("token answers: expiring user tokens; errors arrive with 200", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const t = parseToken(fixture("github/token.ok.json"), now);
    expect(t).toMatchObject({ accessToken: "ghu_fixture0001", refreshToken: "ghr_fixture0001" });
    expect(t.expiresAt?.toISOString()).toBe("2026-10-22T17:00:00.000Z");
    expect(t.refreshExpiresAt?.toISOString()).toBe("2027-04-23T09:00:00.000Z");
    expect(() => parseToken(fixture("github/token.error.json"), now)).toThrow(expect.objectContaining({ code: "REAUTH_REQUIRED" }));
  });
});

describe("identify", () => {
  beforeEach(() => {
    mock.set(`GET ${API}/user`, { json: fixture("github/user.json") });
    mock.set(`GET ${API}/user/installations`, { json: fixture("github/user-installations.json") });
    mock.set(`POST ${API}/app/installations/42/access_tokens`, (r) => { checkJwt(r.headers.get("authorization")); return { status: 201, json: fixture("github/installation-token.json") }; });
  });

  it("personal: the user's id and login; no tenant", async () => {
    const a = await adapter.identify({ kind: "personal", http: http(conn()), tokens: fakeTokens(), pending: {} });
    expect(a).toMatchObject({ externalAccountId: "9001", externalTenantId: null, accountLabel: "ada-obi", identity: { externalUserId: "9001" }, settings: { login: "ada-obi" } });
  });

  it("workspace: the claimed installation only when the person's own token lists it; the installation token replaces the user token", async () => {
    mock.set(`GET ${API}/user/memberships/orgs/acme`, { json: fixture("github/membership.admin.json") });
    const tokens = fakeTokens({ accessToken: "ghu_user", refreshToken: "ghr_user" });
    const a = await adapter.identify({ kind: "workspace", http: http(workspace()), tokens, pending: { installationId: "42", setupAction: "install" } });
    expect(a).toMatchObject({ externalAccountId: "installation:42", externalTenantId: "42", accountLabel: "acme (GitHub)", settings: { login: "ada-obi", userId: "9001", accountType: "Organization", accountLogin: "acme", accountId: "7001" } });
    expect(tokens).toMatchObject({ accessToken: "ghs_fixture0001", refreshToken: null, extra: { userToken: "ghu_user", userRefreshToken: "ghr_user" } });
    expect(tokens.expiresAt?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });

  // Security fix, 22 October 2026: GitHub lists an installation to anyone with access to one of its repositories.
  it("someone who isn't an owner of the installation's organisation is refused (install_not_admin), before any installation token", async () => {
    mock.set(`GET ${API}/user/memberships/orgs/acme`, { json: fixture("github/membership.member.json") });
    await expect(adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { installationId: "42" } }))
      .rejects.toMatchObject({ code: "NOT_ALLOWED", message: expect.stringMatching(/^install_not_admin:/) });
    mock.set(`GET ${API}/user/memberships/orgs/acme`, { status: 404, json: { message: "Not Found" } });
    await expect(adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { installationId: "42" } }))
      .rejects.toMatchObject({ code: "NOT_ALLOWED", message: expect.stringMatching(/^install_not_admin:/) });
    expect(mock.calls.some((c) => c.url.includes("access_tokens"))).toBe(false);
  });

  it("a personal account's installation: only that account itself", async () => {
    mock.set(`POST ${API}/app/installations/43/access_tokens`, { status: 201, json: fixture("github/installation-token.json") });
    const a = await adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { installationId: "43" } });
    expect(a).toMatchObject({ externalTenantId: "43", settings: { accountType: "User", accountId: "9001", userId: "9001" } });
    mock.set(`GET ${API}/user`, { json: { id: 9002, login: "someone-else" } });
    mock.set(`GET ${API}/user/installations`, { json: { total_count: 1, installations: [{ id: 43, account: { login: "ada-obi", id: 9001, type: "User" } }] } });
    await expect(adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { installationId: "43" } }))
      .rejects.toMatchObject({ code: "NOT_ALLOWED", message: expect.stringMatching(/^install_not_admin:/) });
  });

  it("a spoofed installation id is refused (install_unverified)", async () => {
    await expect(adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { installationId: "99" } }))
      .rejects.toMatchObject({ code: "NOT_ALLOWED", message: expect.stringMatching(/^install_unverified:/) });
    expect(mock.calls.some((c) => c.url.includes("access_tokens"))).toBe(false);
  });

  it("a request waiting for an organisation owner's approval: a waiting connection, nothing read", async () => {
    const a = await adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: { setupAction: "request" } });
    expect(a).toMatchObject({ externalAccountId: "waiting:9001", externalTenantId: null, settings: { public: { waiting: true } } });
    const r = await adapter.sync!({ conn: conn({ kind: "workspace", membershipId: null, externalTenantId: null }), http: http(workspace()), stream: "issues", cursor: null, full: true, selected: [], now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 });
    expect(r).toEqual({ cursor: null, more: false });
  });
});

describe("tokens", () => {
  it("a workspace connection's token is minted from the App's JWT; the user token stays in extra", async () => {
    mock.set(`POST ${API}/app/installations/42/access_tokens`, (r) => { checkJwt(r.headers.get("authorization")); return { status: 201, json: fixture("github/installation-token.json") }; });
    const next = await mintGithubTokens({ conn: workspace(), tokens: fakeTokens({ extra: { userToken: "ghu_user" } }), now: new Date("2026-10-22T09:00:00Z") });
    expect(next).toMatchObject({ accessToken: "ghs_fixture0001", refreshToken: null, extra: { userToken: "ghu_user" } });
  });

  it("a gone installation is REVOKED", async () => {
    mock.set(`POST ${API}/app/installations/42/access_tokens`, { status: 404, json: { message: "Not Found" } });
    await expect(mintGithubTokens({ conn: workspace(), tokens: fakeTokens(), now: new Date() })).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("a person's token is refreshed with its refresh token; a refused one is REAUTH_REQUIRED", async () => {
    mock.set("POST https://github.com/login/oauth/access_token", (r) => {
      expect(r.form()).toMatchObject({ grant_type: "refresh_token", refresh_token: "test-refresh-token-0000", client_id: "Iv23testclient" });
      return { json: fixture("github/token.ok.json") };
    });
    expect((await mintGithubTokens({ conn: conn(), tokens: fakeTokens(), now: new Date() })).accessToken).toBe("ghu_fixture0001");
    mock.set("POST https://github.com/login/oauth/access_token", { json: fixture("github/token.error.json") });
    await expect(mintGithubTokens({ conn: conn(), tokens: fakeTokens(), now: new Date() })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("revoke: a person's own token, or a workspace's verifying user token (Basic client auth); installations are left alone", async () => {
    mock.set(`DELETE ${API}/applications/Iv23testclient/token`, { status: 204 });
    await adapter.revoke!({ conn: conn(), http: http(conn()), tokens: fakeTokens({ accessToken: "ghu_x" }) });
    const c = mock.calls.at(-1)!;
    expect(c.headers.get("authorization")).toBe(`Basic ${Buffer.from("Iv23testclient:gh-secret").toString("base64")}`);
    expect(JSON.parse(c.body!)).toEqual({ access_token: "ghu_x" });
    // Security fix, 22 October 2026: disconnecting a workspace revokes the owner's user token kept in `extra`.
    mock.calls.length = 0;
    await adapter.revoke!({ conn: workspace(), http: http(workspace()), tokens: fakeTokens({ accessToken: "ghs_installation", extra: { userToken: "ghu_owner" } }) });
    expect(mock.calls).toHaveLength(1);
    expect(JSON.parse(mock.calls[0].body!)).toEqual({ access_token: "ghu_owner" });
    expect(mock.calls.some((x) => x.url.includes("/installation"))).toBe(false);
    mock.calls.length = 0;
    await adapter.revoke!({ conn: workspace(), http: http(workspace()), tokens: fakeTokens() });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("sources", () => {
  it("workspace: the installation's repositories, lower-cased ids, names as GitHub shows them", async () => {
    mock.set(`GET ${API}/orgs/acme/memberships/ada-obi`, { json: fixture("github/membership.admin.json") });
    mock.set(`GET ${API}/installation/repositories`, { json: fixture("github/installation-repositories.json") });
    expect(await adapter.sources!({ conn: workspace(), http: http(workspace()) })).toEqual([
      { kind: "repo", externalId: "acme/web", label: "acme/Web", isPrivate: true, archived: false },
      { kind: "repo", externalId: "acme/old", label: "acme/old", isPrivate: false, archived: true },
    ]);
  });
  it("workspace: once whoever connected is no longer an owner of the organisation, it needs reconnecting (and nothing is listed)", async () => {
    mock.set(`GET ${API}/orgs/acme/memberships/ada-obi`, { json: fixture("github/membership.member.json") });
    mock.set(`GET ${API}/installation/repositories`, { json: fixture("github/installation-repositories.json") });
    await expect(adapter.sources!({ conn: workspace(), http: http(workspace()) })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(mock.calls.some((c) => c.url.includes("/installation/repositories"))).toBe(false);
    // A full sync checks it too, before reading anything.
    await expect(adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: null, full: true, selected: [{ kind: "repo", externalId: "acme/web", label: "acme/Web" }], now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 }))
      .rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    // Settings from before the check (no account recorded) fail closed.
    await expect(adapter.sources!({ conn: conn({ kind: "workspace", membershipId: null, externalTenantId: "42", settings: { login: "ada-obi" } }), http: http(workspace()) })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("personal: the repositories of the installations the person can see", async () => {
    mock.set(`GET ${API}/user/installations`, { json: fixture("github/user-installations.json") });
    mock.set(`GET ${API}/user/installations/42/repositories`, { json: fixture("github/installation-repositories.json") });
    mock.set(`GET ${API}/user/installations/43/repositories`, { json: { total_count: 0, repositories: [] } });
    expect((await adapter.sources!({ conn: conn(), http: http(conn()) })).map((s) => s.externalId)).toEqual(["acme/web", "acme/old"]);
  });
});

describe("sync", () => {
  it("personal full run: assigned (open) and review requests, reconciled together, then recent changes", async () => {
    const queries: Record<string, string>[] = [];
    mock.set(`GET ${API}/issues`, (r) => {
      const q = Object.fromEntries(r.url.searchParams.entries());
      queries.push(q);
      return { json: q.state === "open" ? list("github/issues.assigned.json").slice(0, 2) : [] };
    });
    mock.set(`GET ${API}/search/issues`, (r) => { queries.push(Object.fromEntries(r.url.searchParams.entries())); return { json: fixture("github/search.review.json") }; });
    const { s, api } = sink();
    const now = new Date("2026-10-22T09:00:00Z");
    const r = await adapter.sync!({ conn: conn(), http: http(conn()), stream: "issues", cursor: null, full: true, selected: [], now, timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 });
    expect(queries[0]).toMatchObject({ filter: "assigned", state: "open", per_page: "100", page: "1" });
    expect(queries[1].q).toBe("is:open is:pr review-requested:@me archived:false");
    expect(queries[2]).toMatchObject({ filter: "assigned", state: "all", since: "2026-10-20T09:00:00.000Z" });
    expect(s.upserts.map((i) => [i.externalId, i.externalKey, i.subtype, i.state, i.stateLabel, i.mine])).toEqual([
      ["acme/web#12", "acme/Web#12", "issue", "open", "Open", true],
      ["acme/web#88", "acme/Web#88", "pull_request", "open", "Open", true],
      ["acme/web#90", "acme/Web#90", "pull_request", "open", "Review requested", true],
    ]);
    expect(s.open).toEqual([["acme/web#12", "acme/web#88", "acme/web#90"]]);
    expect(s.upserts[0]).toMatchObject({ url: "https://github.com/acme/Web/issues/12", excerpt: "It loops after sign-in.", containerLabel: "acme/Web", assigneeExternalId: "9001", priority: null });
    const cur = JSON.parse(r.cursor!);
    expect(cur).toMatchObject({ ph: "inc", w: "2026-10-22T08:08:00.000Z", rs: now.toISOString() });
  });

  it("closed issues: not planned is cancelled, merged pull requests are done", async () => {
    mock.set(`GET ${API}/issues`, { json: list("github/issues.assigned.json") });
    mock.set(`GET ${API}/search/issues`, { json: { items: [] } });
    const { s, api } = sink();
    await adapter.sync!({ conn: conn(), http: http(conn()), stream: "issues", cursor: JSON.stringify({ ph: "inc", i: 0, w: "2026-10-01T00:00:00Z", rs: new Date().toISOString() }), full: false, selected: [], now: new Date(), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 });
    expect(s.upserts.find((i) => i.externalId === "acme/api#5")).toMatchObject({ state: "cancelled", stateLabel: "Closed as not planned" });
    mock.set(`GET ${API}/repos/acme/web/issues`, { json: list("github/repo-issues.json") });
    const w = sink();
    await adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: JSON.stringify({ ph: "inc", i: 0, w: "2026-10-01T00:00:00Z" }), full: false, selected: [{ kind: "repo", externalId: "acme/web", label: "acme/Web" }], now: new Date(), timeZone: "UTC", sink: w.api, deadline: Date.now() + 10_000 });
    expect(w.s.upserts.map((i) => [i.externalId, i.state, i.stateLabel, i.sourceExternalId, i.mine])).toEqual([["acme/web#12", "open", "Open", "acme/web", false], ["acme/web#91", "done", "Merged", "acme/web", false]]);
  });

  it("workspace: per selected repository, following Link pages; stops near the rate limit and carries on later", async () => {
    const pages: string[] = [];
    mock.set(`GET ${API}/repos/acme/web/issues`, (r): MockReply => {
      const p = r.url.searchParams.get("page")!;
      pages.push(`web:${p}`);
      return p === "1" ? { json: list("github/repo-issues.json"), headers: { link: `<${API}/repos/acme/web/issues?page=2>; rel="next"`, "x-ratelimit-remaining": "4000" } } : { json: [], headers: { "x-ratelimit-remaining": "99" } };
    });
    mock.set(`GET ${API}/repos/acme/api/issues`, () => { pages.push("api:1"); return { json: [] }; });
    const selected = [{ kind: "repo" as const, externalId: "acme/web", label: "acme/Web" }, { kind: "repo" as const, externalId: "acme/api", label: "acme/api" }];
    const r = await adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: JSON.stringify({ ph: "inc", i: 0, w: "2026-10-21T00:00:00Z" }), full: false, selected, now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 });
    expect(pages).toEqual(["web:1", "web:2"]);
    expect(r.more).toBe(false);
    expect(JSON.parse(r.cursor!)).toMatchObject({ ph: "inc", i: 1, pg: null });
    pages.length = 0;
    await adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: r.cursor, full: false, selected, now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 });
    expect(pages).toEqual(["api:1"]);
  });

  it("a pull request waiting for the person's review is theirs when fetched again", async () => {
    mock.set(`GET ${API}/repos/acme/web/issues/90`, { json: fixture("github/issue.pr.json") });
    mock.set(`GET ${API}/repos/acme/web/pulls/90`, { json: fixture("github/pull.json") });
    expect(await adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "acme/web#90" })).toMatchObject({ subtype: "pull_request", mine: true, stateLabel: "Review requested" });
    mock.set(`GET ${API}/repos/acme/web/issues/91`, { status: 410, json: { message: "This issue was deleted" } });
    expect(await adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "acme/web#91" })).toBeNull();
    expect(parseItemId("acme/web#12")).toEqual({ repo: "acme/web", number: "12" });
    expect(parseItemId("../x#1")).toBeNull();
  });

  it("secondary rate limits back off", async () => {
    const backoffs: number[] = [];
    mock.set(`GET ${API}/repos/acme/web/issues/12`, { status: 403, json: { message: "You have exceeded a secondary rate limit" }, headers: { "retry-after": "120" } });
    await expect(adapter.fetchItem!({ conn: conn(), http: http(conn(), backoffs), kind: "issue", externalId: "acme/web#12" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(backoffs).toEqual([120]);
    mock.set(`GET ${API}/repos/acme/web/issues/12`, { status: 403, json: { message: "Resource not accessible by integration" } });
    await expect(adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "acme/web#12" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("webhooks", () => {
  const sign = (b: string, secret = "gh-webhook-secret") => `sha256=${createHmac("sha256", secret).update(b).digest("hex")}`;
  const verify = (b: string, h: Record<string, string>) => adapter.webhook!.verify({ raw: new TextEncoder().encode(b), headers: new Headers(h), url: new URL("https://boredroom.test/api/connectors/webhooks/github"), secretFor: async () => null, saveSecret: async () => false });

  it("X-Hub-Signature-256 over the raw body; the delivery id is the signed body's digest, never the unsigned header", async () => {
    const body = JSON.stringify(fixture("github/webhook.issues.json"));
    const a = await verify(body, { "x-hub-signature-256": sign(body), "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958" });
    const b = await verify(body, { "x-hub-signature-256": sign(body), "x-github-delivery": "00000000-replayed-under-a-new-header" });
    expect(a).toEqual({ ok: true, deliveryId: `body:${createHash("sha256").update(body).digest("hex")}` });
    expect(b).toEqual(a);
    expect((await verify(body, { "x-hub-signature-256": sign(body, "other") })).ok).toBe(false);
    expect((await verify(`${body} `, { "x-hub-signature-256": sign(body) })).ok).toBe(false);
    expect((await verify(body, {})).ok).toBe(false);
  });

  it("routes issues to the installation and to the people concerned; installations removed and authorisations revoked disconnect", () => {
    expect(routeGithub("issues", fixture("github/webhook.issues.json"))).toEqual([
      { by: "tenant", tenantId: "42", externalId: "acme/web#12", kind: "issue" },
      { by: "account", accountId: "9001", externalId: "acme/web#12", kind: "issue" },
    ]);
    // The removal's own time travels with it (a replay can't disconnect a later connection); a revoked authorisation
    // only asks for a sync, which finds out with Boredroom's own token (security fix, 22 October 2026).
    expect(routeGithub("installation", fixture("github/webhook.installation.deleted.json"))).toEqual([{ by: "tenant", tenantId: "42", revoked: true, at: "2026-10-20T09:00:00Z" }]);
    expect(routeGithub("installation", { action: "suspend", installation: { id: 42, suspended_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z" } })).toEqual([{ by: "tenant", tenantId: "42", revoked: true, at: "2026-10-21T10:00:00Z" }]);
    expect(routeGithub("github_app_authorization", { action: "revoked", sender: { id: 9001 } })).toEqual([{ by: "account", accountId: "9001" }]);
    expect(routeGithub("ping", {})).toEqual([]);
    expect(adapter.webhook!.route({ body: fixture("github/webhook.issues.json"), headers: new Headers({ "x-github-event": "issues" }) })).toHaveLength(2);
  });
});

describe("actions", () => {
  beforeEach(() => mock.set(`GET ${API}/repos/acme/web/issues/12`, { json: fixture("github/issue.json") }));

  it("issues only, both kinds; no due dates in GitHub", () => {
    expect(adapter.actions.map((a) => a.name)).toEqual(["create_issue", "comment", "set_state", "assign"]);
    expect(adapter.workspaceActs).toBe(true);
  });

  it("create (workspace): signed as the app; the exact body sent", async () => {
    const p = await spec("create_issue").prepare(act(workspace(), { title: "Add dark mode", text: "Please add it." }, { item: null, source: repo }));
    expect(p).toMatchObject({ risk: "shared", summary: "Create a GitHub issue in acme/Web", detail: "Please add it.\n\nFrom Jo via Max", appearsAs: "by the Boredroom app, signed “Jo via Max”" });
    mock.set(`POST ${API}/repos/acme/web/issues`, { status: 201, json: fixture("github/issue.created.json") });
    const r = await spec("create_issue").run(act(workspace(), { title: "Add dark mode", text: "Please add it." }, { item: null, source: repo }));
    expect(lastJson()).toEqual({ title: "Add dark mode", body: "Please add it.\n\nFrom Jo via Max" });
    expect(r).toMatchObject({ summary: "Created acme/Web#92 “Add dark mode” in GitHub", href: "https://github.com/acme/Web/issues/92" });
  });

  it("comment (personal): as the person, their words", async () => {
    const p = await spec("comment").prepare(act(conn(), { text: "On it." }));
    expect(p).toMatchObject({ summary: "Comment on acme/Web#12", detail: "On it.", appearsAs: "as you (ada-obi)" });
    mock.set(`POST ${API}/repos/acme/web/issues/12/comments`, { status: 201, json: {} });
    await spec("comment").run(act(conn(), { text: "On it." }));
    expect(lastJson()).toEqual({ body: "On it." });
  });

  it("pull requests are read only", async () => {
    mock.set(`GET ${API}/repos/acme/web/issues/90`, { json: fixture("github/issue.pr.json") });
    await expect(spec("comment").prepare(act(conn(), { text: "x" }, { item: { ...item, externalId: "acme/web#90", externalKey: "acme/Web#90" } }))).rejects.toMatchObject({ name: "ActRefusal", words: expect.stringContaining("pull request") });
  });

  it("set_state: close as completed (shared) or not planned (destructive); reopen; no in-progress", async () => {
    const done = await spec("set_state").prepare(act(conn(), { state: "done" }));
    expect(done).toMatchObject({ risk: "shared", summary: "Move acme/Web#12 to Closed", readback: { what: "acme/Web#12 moves from Open to Closed" } });
    expect(await spec("set_state").prepare(act(conn(), { state: "cancelled" }))).toMatchObject({ risk: "destructive", summary: "Move acme/Web#12 to Closed as not planned" });
    await expect(spec("set_state").prepare(act(conn(), { state: "in_progress" }))).rejects.toMatchObject({ name: "ActRefusal" });
    mock.set(`PATCH ${API}/repos/acme/web/issues/12`, { json: fixture("github/issue.closed.json") });
    const r = await spec("set_state").run(act(conn(), { state: "done" }));
    expect(lastJson()).toEqual({ state: "closed", state_reason: "completed" });
    expect(r.item?.state).toBe("done");
  });

  it("assign: me (a personal login), or a login GitHub says can be assigned", async () => {
    expect((await spec("assign").prepare(act(conn(), { assignee: "me" }))).summary).toBe("Assign acme/Web#12 to you");
    await expect(spec("assign").prepare(act(workspace(), { assignee: "me" }))).rejects.toMatchObject({ name: "ActRefusal" });
    mock.set(`GET ${API}/repos/acme/web/assignees/ben-ade`, { status: 204 });
    mock.set(`GET ${API}/repos/acme/web/assignees/stranger`, { status: 404, json: { message: "Not Found" } });
    expect((await spec("assign").prepare(act(conn(), { assignee: "@ben-ade" }))).readback.to).toEqual(["ben-ade, whom GitHub tells", "Everyone who can see acme/Web#12 in GitHub"]);
    await expect(spec("assign").prepare(act(conn(), { assignee: "stranger" }))).rejects.toMatchObject({ name: "ActRefusal", words: expect.stringContaining("can't be assigned") });
    await expect(spec("assign").prepare(act(conn(), { assignee: "Ben Ade" }))).rejects.toMatchObject({ name: "ActRefusal", words: expect.stringContaining("username") });
    mock.set(`POST ${API}/repos/acme/web/issues/12/assignees`, { status: 201, json: fixture("github/issue.json") });
    await spec("assign").run(act(conn(), { assignee: "ben-ade" }));
    expect(lastJson()).toEqual({ assignees: ["ben-ade"] });
  });
});
