/**
 * Jira adapter and Atlassian helpers (work group, owner decisions 22 October 2026: connectors; spec §8.6, §16.2). No
 * database, no network: answers from tests/fixtures/connectors/jira (written from Atlassian's public developer docs).
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adapter, chooseTransition, jiraTime, jqlFor, parseToken, resetJiraPauseForTests, verifyJiraJwt } from "@/server/connectors/adapters/jira";
import { adfToText, cyclePeriodMs, reportAccounts, resetReportingCycleForTests, textToAdf } from "@/server/connectors/adapters/atlassian";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fakeTokens, fixture, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import type { ActInput, ActionSpec, Actor, ConnectionRef, MaintenanceInput, NormalisedItem, StoredItem, StoredSource, SyncSink } from "@/server/connectors/types";

const CLOUD = "11223344-5566-4778-899a-abcdefabcdef";
const ADA = "5b10a2844c20165700ede21g";
const API = `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3`;
const saved = { ...process.env };

const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", provider: "jira", kind: "personal",
  membershipId: "33333333-3333-4333-8333-333333333333", connectedBy: "33333333-3333-4333-8333-333333333333", externalAccountId: ADA,
  externalTenantId: CLOUD, accountLabel: "ada@example.com on acme", scopes: [], settings: { siteUrl: "https://acme.atlassian.net", siteName: "acme" }, canRead: true, canAct: true, ...over,
});
const workspace = () => conn({ kind: "workspace", membershipId: null, externalAccountId: CLOUD, accountLabel: "acme (Jira)" });
type Spend = { bucket: string; cost: number; cap: number };
const deps = (spent: Spend[] = [], backoffs: number[] = []): HttpDeps => ({
  token: async () => ({ accessToken: "test-access", expiresAt: null }), refresh: async () => "test-access", backoff: async (s) => { backoffs.push(s); },
  spend: async (bucket, cost, cap) => { spent.push({ bucket, cost, cap }); },
});
const http = (c: ConnectionRef, spent?: Spend[], backoffs?: number[]) => httpFor(c, adapter, deps(spent, backoffs));
const actor: Actor = { membershipId: "33333333-3333-4333-8333-333333333333", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const item: StoredItem = {
  id: "44444444-4444-4444-8444-444444444444", externalId: "10101", externalKey: "WEB-7", kind: "issue", title: "Fix the login loop",
  url: null, state: "in_progress", containerLabel: "Website", sourceExternalId: "10001", assigneeExternalId: ADA, startsAt: null, endsAt: null, guests: null, response: null,
};
const project: StoredSource = { id: "55555555-5555-4555-8555-555555555555", kind: "project", externalId: "10001", label: "Website (WEB)", members: null };
const spec = (name: string) => adapter.actions.find((a) => a.name === name) as ActionSpec;
const act = (c: ConnectionRef, input: Record<string, unknown>, o: { item?: StoredItem | null; source?: StoredSource | null } = {}): ActInput<Record<string, unknown>> =>
  ({ conn: c, http: http(c), actor, input, item: o.item === undefined ? item : o.item, source: o.source ?? null, now: new Date("2026-10-22T09:00:00Z") });
function sink() {
  const s = { upserts: [] as NormalisedItem[], open: [] as string[][] };
  const api: SyncSink = { upsert: async (i) => { s.upserts.push(...i); }, gone: async () => undefined, reconcileWindow: async () => undefined, reconcileOpen: async (_k, ids) => { s.open.push(ids); } };
  return { s, api };
}
const lastJson = () => JSON.parse(mock.calls.at(-1)!.body!) as Record<string, unknown>;

let mock: ProviderMock;
beforeAll(() => {
  process.env.ATLASSIAN_CLIENT_ID = "atl-client";
  process.env.ATLASSIAN_CLIENT_SECRET = "atl-secret";
  process.env.APP_ORIGIN = "https://boredroom.test";
  mock = mockProviders({});
});
afterAll(() => { mock.restore(); process.env = saved; });
beforeEach(() => { mock.calls.length = 0; resetJiraPauseForTests(); });

describe("OAuth", () => {
  it("classic scopes, space-separated; write only to act; the audience and consent; no PKCE", () => {
    const q = new URL(authorizeUrl(adapter, { kind: "personal", act: true, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "personal", act: true }) })).searchParams;
    expect(q.get("scope")).toBe("read:jira-work read:jira-user manage:jira-webhook offline_access write:jira-work");
    expect(q.get("audience")).toBe("api.atlassian.com");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("code_challenge")).toBeNull();
    expect(adapter.oauth.scopes({ kind: "workspace", act: false })).not.toContain("write:jira-work");
    expect(adapter.oauth.tokenBody).toBe("json");
  });

  it("parses the token answer and refuses errors; no revoke endpoint (the card names where)", () => {
    const t = parseToken(fixture("jira/token.ok.json"), new Date("2026-10-22T09:00:00Z"));
    expect(t).toMatchObject({ accessToken: "atl-access-fixture-0001", refreshToken: "atl-refresh-fixture-0001" });
    expect(t.scopes).toContain("write:jira-work");
    expect(() => parseToken(fixture("jira/token.error.json"), new Date())).toThrow(expect.objectContaining({ code: "REAUTH_REQUIRED" }));
    expect(adapter.revoke).toBeUndefined();
    expect(adapter.ownerBound).toBe(true);
    expect(adapter.workspaceActs).toBe(false);
  });
});

describe("identify and sources", () => {
  it("the first site with Jira scopes; the person's account id; settings for links", async () => {
    mock.set("GET https://api.atlassian.com/oauth/token/accessible-resources", { json: fixture<{ resources: unknown[] }>("jira/accessible-resources.json").resources });
    mock.set(`GET ${API}/myself`, { json: fixture("jira/myself.json") });
    const p = await adapter.identify({ kind: "personal", http: http(conn()), tokens: fakeTokens(), pending: {} });
    expect(p).toMatchObject({ externalAccountId: ADA, externalTenantId: CLOUD, accountLabel: "ada@example.com on acme", identity: { externalUserId: ADA, email: "ada@example.com" }, settings: { siteUrl: "https://acme.atlassian.net", siteName: "acme" } });
    const w = await adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: {} });
    expect(w).toMatchObject({ externalAccountId: CLOUD, externalTenantId: CLOUD, accountLabel: "acme (Jira)" });
  });

  it("no Jira site: no_site", async () => {
    mock.set("GET https://api.atlassian.com/oauth/token/accessible-resources", { json: [] });
    await expect(adapter.identify({ kind: "personal", http: http(conn()), tokens: fakeTokens(), pending: {} })).rejects.toMatchObject({ code: "NOT_ALLOWED", message: expect.stringMatching(/^no_site:/) });
  });

  it("projects by id, labelled with their keys", async () => {
    mock.set(`GET ${API}/project/search`, { json: fixture("jira/project-search.json") });
    const s = await adapter.sources!({ conn: workspace(), http: http(workspace()) });
    expect(s).toEqual([
      { kind: "project", externalId: "10001", label: "Website (WEB)", isPrivate: false, archived: false },
      { kind: "project", externalId: "10002", label: "Operations (OPS)", isPrivate: true, archived: false },
    ]);
  });
});

describe("sync", () => {
  it("Jira's offset times become ISO", () => {
    expect(jiraTime("2026-10-21T09:12:33.000+0100")).toBe("2026-10-21T08:12:33.000Z");
    expect(jiraTime("nonsense")).toBeNull();
  });

  it("JQL: personal and workspace, open and since (relative minutes, time-zone free)", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    expect(jqlFor(conn(), [], "open", null, now)).toBe("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
    expect(jqlFor(conn(), [], "inc", "2026-10-22T07:30:00.000Z", now)).toBe("assignee = currentUser() AND updated >= \"-90m\" ORDER BY updated DESC");
    expect(jqlFor(workspace(), [{ kind: "project", externalId: "10001", label: "W" }, { kind: "project", externalId: "x); DROP", label: "bad" }], "inc", "2026-10-22T08:59:30.000Z", now)).toBe("project in (10001) AND updated >= \"-1m\" ORDER BY updated DESC");
    expect(jqlFor(workspace(), [], "open", null, now)).toBeNull();
  });

  it("a full run: two pages with nextPageToken, states and priorities mapped, the open set reconciled, budget spent per request", async () => {
    const bodies: Record<string, unknown>[] = [];
    mock.set(`POST ${API}/search/jql`, (r) => {
      const b = r.json() as Record<string, unknown>;
      bodies.push(b);
      if (String(b.jql).includes("statusCategory")) return { json: fixture(b.nextPageToken ? "jira/search.page2.json" : "jira/search.page1.json") };
      return { json: { issues: [], isLast: true } };
    });
    const spent: Spend[] = [];
    const { s, api } = sink();
    const r = await adapter.sync!({ conn: conn(), http: http(conn(), spent), stream: "issues", cursor: null, full: true, selected: [], now: new Date("2026-10-22T09:00:00Z"), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 });
    expect(bodies[0]).toMatchObject({ maxResults: 100, fields: ["summary", "status", "duedate", "priority", "assignee", "updated", "project", "issuetype"] });
    expect(bodies[1].nextPageToken).toBe("CAEaAggB");
    expect(bodies[2].jql).toBe("assignee = currentUser() AND updated >= \"-2880m\" ORDER BY updated DESC");
    expect(s.upserts.map((i) => [i.externalKey, i.state, i.priority, i.mine])).toEqual([["WEB-7", "in_progress", 1, true], ["WEB-8", "open", 3, true], ["WEB-9", "cancelled", 4, true], ["WEB-10", "done", 4, true]]);
    expect(s.upserts[0]).toMatchObject({ url: "https://acme.atlassian.net/browse/WEB-7", dueOn: "2026-10-24", providerUpdatedAt: "2026-10-22T08:12:33.000Z", sourceExternalId: "10001", containerLabel: "Website", subtype: "task" });
    expect(s.upserts[0].excerpt).toBeUndefined(); // descriptions only through fetchText
    expect(s.open).toEqual([["10101", "10102"]]);
    expect(spent).toEqual([{ bucket: "jira:global", cost: 101, cap: 50_000 }, { bucket: "jira:global", cost: 101, cap: 50_000 }, { bucket: "jira:global", cost: 51, cap: 50_000 }]);
    expect(r.more).toBe(false);
    expect(JSON.parse(r.cursor!).w).toBe("2026-10-22T08:10:33.000Z");
  });

  it("a global quota 429 pauses every Jira sync to the top of the hour", async () => {
    mock.set(`POST ${API}/search/jql`, { status: 429, json: {}, headers: { "ratelimit-reason": "jira-quota-global-based" } });
    const backoffs: number[] = [];
    const { api } = sink();
    await expect(adapter.sync!({ conn: conn(), http: http(conn(), [], backoffs), stream: "issues", cursor: null, full: false, selected: [], now: new Date(), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(backoffs[0]).toBeGreaterThan(0);
    expect(backoffs[0]).toBeLessThanOrEqual(3600);
    mock.calls.length = 0;
    // Another connection, same process: no call at all until the hour turns.
    await expect(adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: null, full: false, selected: [{ kind: "project", externalId: "10001", label: "W" }], now: new Date(), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(mock.calls).toHaveLength(0);
  });

  it("an ordinary 429 is the connection's own backoff", async () => {
    mock.set(`POST ${API}/search/jql`, { status: 429, json: {}, headers: { "retry-after": "30", "ratelimit-reason": "jira-burst-based" } });
    const backoffs: number[] = [];
    await expect(adapter.sync!({ conn: conn(), http: http(conn(), [], backoffs), stream: "issues", cursor: null, full: false, selected: [], now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(backoffs).toEqual([30]);
    mock.set(`POST ${API}/search/jql`, { json: { issues: [], isLast: true } });
    await expect(adapter.sync!({ conn: conn(), http: http(conn()), stream: "issues", cursor: null, full: false, selected: [], now: new Date(), timeZone: "UTC", sink: sink().api, deadline: Date.now() + 10_000 })).resolves.toMatchObject({ more: false });
  });

  it("read_app_item text: ADF flattened, links left out", async () => {
    mock.set(`GET ${API}/issue/10101`, { json: fixture("jira/issue.description.json") });
    const t = await adapter.fetchText!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "10101", maxChars: 2000 });
    expect(t).toBe("Steps\n\n1. Sign in\n2. Wait\n\nAsk @Ada Obi first.\nSee [link]");
    expect(t).not.toContain("evil.example.com");
  });
});

describe("ADF", () => {
  it("plain text in: paragraphs and line breaks, nothing interpreted", () => {
    expect(textToAdf("Hello\nthere\n\n<b>Second</b>")).toEqual({ type: "doc", version: 1, content: [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }, { type: "hardBreak" }, { type: "text", text: "there" }] },
      { type: "paragraph", content: [{ type: "text", text: "<b>Second</b>" }] },
    ] });
  });
  it("text out is capped", () => {
    expect(adfToText(textToAdf("a".repeat(500)), 100)).toHaveLength(100);
    expect(adfToText(null)).toBe("");
  });
});

describe("webhooks", () => {
  const jwt = (claims: Record<string, unknown>, secret = "atl-secret", alg = "HS256") => {
    const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const verify = (auth: string | null, id = "wh-1") => adapter.webhook!.verify({ raw: new TextEncoder().encode("{}"), headers: new Headers({ ...(auth ? { authorization: auth } : {}), "x-atlassian-webhook-identifier": id }), url: new URL("https://boredroom.test/api/connectors/webhooks/jira"), secretFor: async () => null, saveSecret: async () => false });

  it("the JWT signed with the client secret and not expired", async () => {
    expect(await verify(`Bearer ${jwt({ iss: "atl-client", exp: now + 60, iat: now })}`)).toEqual({ ok: true, deliveryId: "wh-1" });
    expect((await verify(`Bearer ${jwt({ exp: now + 60 }, "other")}`)).ok).toBe(false);
    expect((await verify(`Bearer ${jwt({ exp: now - 120 })}`)).ok).toBe(false);
    expect((await verify(`Bearer ${jwt({ exp: now + 60 }, "atl-secret", "none")}`)).ok).toBe(false);
    expect((await verify(null)).ok).toBe(false);
    expect(verifyJiraJwt(`Bearer ${jwt({ exp: now + 60 })}`, "", Date.now())).toBe(false);
  });

  // Security fix, 22 October 2026: Jira's webhook ids are small numbers per site, so the route is Boredroom's own hook id
  // from the URL (`?hook=`), with Jira's matched ids as a cross-check; never Jira's id alone.
  it("routes by Boredroom's own hook id in the URL (Jira's matched ids only as a cross-check) to the one issue", () => {
    const HOOK_ID = "66666666-6666-4666-8666-666666666666";
    const at = (q: string) => new URL(`https://boredroom.test/api/connectors/webhooks/jira${q}`);
    expect(adapter.webhook!.route({ body: fixture("jira/webhook.issue_updated.json"), headers: new Headers(), url: at(`?hook=${HOOK_ID}`) }))
      .toEqual([{ by: "webhook", webhookId: HOOK_ID, ours: true, matched: ["1000"], externalId: "10101", kind: "issue" }]);
    expect(adapter.webhook!.route({ body: fixture("jira/webhook.issue_updated.json"), headers: new Headers(), url: at("") })).toEqual([]);
    expect(adapter.webhook!.route({ body: fixture("jira/webhook.issue_updated.json"), headers: new Headers() })).toEqual([]);
    expect(adapter.webhook!.route({ body: { ...fixture<Record<string, unknown>>("jira/webhook.issue_updated.json"), matchedWebhookIds: [] }, headers: new Headers(), url: at(`?hook=${HOOK_ID}`) })).toEqual([]);
  });

  it("registers (personal: assigned to them; workspace: the projects it can see), renews and deletes", async () => {
    mock.set(`POST ${API}/webhook`, { json: fixture("jira/webhook.register.json") });
    const made = await adapter.registerWebhooks!({ conn: conn(), http: http(conn()), hookUrl: () => "https://boredroom.test/api/connectors/webhooks/jira", newHook: async () => "66666666-6666-4666-8666-666666666666" });
    expect(made[0]).toMatchObject({ hookId: "66666666-6666-4666-8666-666666666666", externalId: "1000" });
    expect(lastJson()).toEqual({ url: "https://boredroom.test/api/connectors/webhooks/jira", webhooks: [{ events: ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"], jqlFilter: `assignee = "${ADA}"` }] });
    mock.set(`GET ${API}/project/search`, { json: fixture("jira/project-search.json") });
    await adapter.registerWebhooks!({ conn: workspace(), http: http(workspace()), hookUrl: () => "https://boredroom.test/api/connectors/webhooks/jira", newHook: async () => "77777777-7777-4777-8777-777777777777" });
    expect((lastJson().webhooks as { jqlFilter: string }[])[0].jqlFilter).toBe("project in (10001, 10002)");
    mock.set(`PUT ${API}/webhook/refresh`, { json: fixture("jira/webhook.refresh.json") });
    expect((await adapter.renewWebhook!({ conn: conn(), http: http(conn()), externalId: "1000" }))?.toISOString()).toBe("2026-11-21T09:00:00.000Z");
    expect(lastJson()).toEqual({ webhookIds: [1000] });
    mock.set(`DELETE ${API}/webhook`, { status: 202, text: "" });
    await adapter.deleteWebhook!({ conn: conn(), http: http(conn()), externalId: "1000" });
    expect(lastJson()).toEqual({ webhookIds: [1000] });
  });
});

describe("actions (the person's own connection only)", () => {
  it("every action is personal only", () => {
    for (const a of adapter.actions) expect(a.kinds).toEqual(["personal"]);
    expect(adapter.actions.map((a) => a.name)).toEqual(["create_issue", "comment", "set_state", "assign", "set_due"]);
  });

  it("create: the card, then a Task in the project with the description as ADF", async () => {
    const p = await spec("create_issue").prepare(act(conn(), { title: "Add dark mode", text: "Please add it." }, { item: null, source: project }));
    expect(p).toMatchObject({ risk: "shared", summary: "Create a Jira issue in Website (WEB)", detail: "Please add it.", appearsAs: "as you (ada@example.com on acme)", readback: { to: ["Everyone who can see Website (WEB) in Jira"], what: "A new issue “Add dark mode”, created as you (ada@example.com on acme)" } });
    mock.set(`GET ${API}/project/10001`, { json: fixture("jira/project.json") });
    mock.set(`POST ${API}/issue`, { status: 201, json: fixture("jira/issue.created.json") });
    const r = await spec("create_issue").run(act(conn(), { title: "Add dark mode", text: "Please add it." }, { item: null, source: project }));
    expect(lastJson()).toEqual({ fields: { project: { id: "10001" }, summary: "Add dark mode", issuetype: { id: "10012" }, description: textToAdf("Please add it.") } });
    expect(r).toMatchObject({ summary: "Created WEB-11 “Add dark mode” in Jira", href: "https://acme.atlassian.net/browse/WEB-11" });
  });

  it("comment: the exact words, as ADF", async () => {
    const p = await spec("comment").prepare(act(conn(), { text: "On it." }));
    expect(p).toMatchObject({ summary: "Comment on WEB-7", detail: "On it.", readback: { to: ["Everyone who can see WEB-7 in Jira, including the people following it"] } });
    mock.set(`POST ${API}/issue/10101/comment`, { status: 201, json: {} });
    await spec("comment").run(act(conn(), { text: "On it." }));
    expect(lastJson()).toEqual({ body: textToAdf("On it.") });
  });

  it("set_state: the transition to the wanted category (cancelled: a cancel-like one, destructive)", async () => {
    const t = fixture<{ transitions: unknown[] }>("jira/transitions.json").transitions;
    expect(chooseTransition(t, "done")).toEqual({ id: "31", to: "Done" });
    expect(chooseTransition(t, "cancelled")).toEqual({ id: "41", to: "Won't Do" });
    expect(chooseTransition(t, "in_progress")).toEqual({ id: "21", to: "In Progress" });
    expect(chooseTransition([], "todo")).toBeNull();
    mock.set(`GET ${API}/issue/10101/transitions`, { json: fixture("jira/transitions.json") });
    mock.set(`GET ${API}/issue/10101`, { json: fixture("jira/issue.json") });
    mock.set(`POST ${API}/issue/10101/transitions`, { status: 204 });
    const p = await spec("set_state").prepare(act(conn(), { state: "done" }));
    expect(p).toMatchObject({ risk: "shared", summary: "Move WEB-7 to Done", readback: { what: "WEB-7 moves from In Progress to Done" } });
    expect((await spec("set_state").prepare(act(conn(), { state: "cancelled" }))).risk).toBe("destructive");
    await spec("set_state").run(act(conn(), { state: "done" }));
    const posted = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/transitions"));
    expect(JSON.parse(posted!.body!)).toEqual({ transition: { id: "31" } });
    mock.set(`GET ${API}/issue/10101/transitions`, { json: { transitions: [] } });
    await expect(spec("set_state").prepare(act(conn(), { state: "todo" }))).rejects.toMatchObject({ name: "ActRefusal" });
  });

  it("assign: me, an exact email or name, or words listing who it suggests", async () => {
    const me = await spec("assign").prepare(act(conn(), { assignee: "me" }));
    expect(me.readback.to).toEqual(["You, whom Jira tells", "Everyone who can see WEB-7 in Jira"]);
    mock.set(`GET ${API}/user/assignable/search`, { json: fixture<{ users: unknown[] }>("jira/assignable.json").users });
    const ben = await spec("assign").prepare(act(conn(), { assignee: "ben@example.com" }));
    expect(ben.summary).toBe("Assign WEB-7 to Ben Ade");
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("issueKey")).toBe("WEB-7");
    await expect(spec("assign").prepare(act(conn(), { assignee: "Ben" }))).rejects.toMatchObject({ name: "ActRefusal", words: expect.stringContaining("Ben Ade, Ben Adeyemi") });
    mock.set(`PUT ${API}/issue/10101/assignee`, { status: 204 });
    mock.set(`GET ${API}/issue/10101`, { json: fixture("jira/issue.json") });
    await spec("assign").run(act(conn(), { assignee: "ben@example.com" }));
    const put = mock.calls.find((c) => c.method === "PUT");
    expect(JSON.parse(put!.body!)).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef5" });
  });

  it("set_due: fields.duedate, or null", async () => {
    expect((await spec("set_due").prepare(act(conn(), { due: "2026-10-24" }))).readback.what).toBe("WEB-7 is due Saturday 24 October");
    mock.set(`PUT ${API}/issue/10101`, { status: 204 });
    mock.set(`GET ${API}/issue/10101`, { json: fixture("jira/issue.json") });
    await spec("set_due").run(act(conn(), { due: null }));
    expect(JSON.parse(mock.calls.find((c) => c.method === "PUT")!.body!)).toEqual({ fields: { duedate: null } });
  });
});

describe("personal data reporting", () => {
  beforeEach(() => resetReportingCycleForTests());
  const input = (n: number, erased: string[], conns = [conn()]): MaintenanceInput => ({
    connections: conns,
    httpFor: (c) => http(c),
    accounts: async () => Array.from({ length: n }, (_, i) => ({ externalUserId: i === 0 ? "5b10ac8d82e05b22cc7d4ef7" : `acc-${i}`, tenantId: CLOUD, updatedAt: "2026-10-20T10:00:00.000Z", connectionId: conns[0].id })),
    eraseAccount: async (id) => { erased.push(id); },
    now: new Date("2026-10-22T09:00:00Z"),
  });

  it("batches of 90; closed accounts erased; Cycle-Period honoured", async () => {
    let n = 0;
    mock.set("POST https://api.atlassian.com/app/report-accounts/", () => (++n === 1 ? { json: fixture("jira/report-accounts.json"), headers: { "cycle-period": "1209600" } } : { status: 204 }));
    const erased: string[] = [];
    const r = await reportAccounts(input(95, erased));
    expect(r).toEqual({ reported: 95, erased: 1 });
    const bodies = mock.calls.map((c) => JSON.parse(c.body!) as { accounts: { accountId: string; updatedAt: string }[] });
    expect(bodies.map((b) => b.accounts.length)).toEqual([90, 5]);
    expect(bodies[0].accounts[0]).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef7", updatedAt: "2026-10-20T10:00:00.000Z" });
    expect(erased).toEqual(["5b10ac8d82e05b22cc7d4ef7"]);
    // Cycle-Period of 14 days: the next weekly run waits.
    mock.calls.length = 0;
    expect(await reportAccounts({ ...input(5, erased), now: new Date("2026-10-29T09:00:00Z") })).toEqual({ reported: 0, erased: 0 });
    expect(mock.calls).toHaveLength(0);
    expect(cyclePeriodMs("168")).toBe(168 * 3600_000);
    expect(cyclePeriodMs("604800")).toBe(604_800_000);
    expect(cyclePeriodMs(null)).toBeNull();
  });

  it("a 429 stops the cycle without recording it", async () => {
    mock.set("POST https://api.atlassian.com/app/report-accounts/", { status: 429, json: {}, headers: { "retry-after": "60" } });
    const erased: string[] = [];
    expect(await reportAccounts(input(3, erased))).toEqual({ reported: 0, erased: 0 });
    mock.set("POST https://api.atlassian.com/app/report-accounts/", { status: 204 });
    expect((await reportAccounts(input(3, erased))).reported).toBe(3);
  });

  it("is the adapter's weekly maintenance", () => {
    expect(adapter.maintenance?.map((m) => [m.name, m.everyHours])).toEqual([["report_accounts", 168]]);
  });
});
