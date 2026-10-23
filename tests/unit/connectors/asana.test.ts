/**
 * Asana adapter (work group, owner decisions 22 October 2026: connectors; spec §8.8, §16.2). No database, no network:
 * answers from tests/fixtures/connectors/asana (written from Asana's public developer docs).
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adapter, hookIdFrom, parseToken, routeAsana } from "@/server/connectors/adapters/asana";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fakeTokens, fixture, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import type { ActInput, ActionSpec, Actor, ConnectionRef, NormalisedItem, StoredItem, StoredSource, SyncSink } from "@/server/connectors/types";

const API = "https://app.asana.com/api/1.0";
const ADA = "1201000000000001";
const WS = "1200000000000001";
const WS2 = "1200000000000002";
const HOOK = "2f6a0c1e-0000-4000-8000-0000000000aa";
const saved = { ...process.env };

const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", provider: "asana", kind: "personal",
  membershipId: "33333333-3333-4333-8333-333333333333", connectedBy: "33333333-3333-4333-8333-333333333333", externalAccountId: ADA,
  externalTenantId: WS, accountLabel: "ada@example.com", scopes: [], settings: { workspaces: [{ gid: WS, name: "Acme" }, { gid: WS2, name: "Personal Projects" }] }, canRead: true, canAct: true, ...over,
});
const workspace = () => conn({ kind: "workspace", membershipId: null, externalAccountId: WS, accountLabel: "Acme (Asana)", settings: {} });
const deps = (): HttpDeps => ({ token: async () => ({ accessToken: "test-access", expiresAt: null }), refresh: async () => "test-access", backoff: async () => undefined });
const http = (c: ConnectionRef) => httpFor(c, adapter, deps());
const actor: Actor = { membershipId: "33333333-3333-4333-8333-333333333333", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const item: StoredItem = {
  id: "44444444-4444-4444-8444-444444444444", externalId: "1203000000000001", externalKey: null, kind: "issue", title: "Write the plan",
  url: null, state: "open", containerLabel: "Website", sourceExternalId: "1202000000000001", assigneeExternalId: ADA, startsAt: null, endsAt: null, guests: null, response: null,
};
const project: StoredSource = { id: "55555555-5555-4555-8555-555555555555", kind: "project", externalId: "1202000000000001", label: "Website", members: null };
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
  Object.assign(process.env, { ASANA_CLIENT_ID: "asana-client", ASANA_CLIENT_SECRET: "asana-secret", APP_ORIGIN: "https://boredroom.test" });
  mock = mockProviders({});
});
afterAll(() => { mock.restore(); process.env = saved; });
beforeEach(() => { mock.calls.length = 0; });

describe("OAuth", () => {
  it("the full set of specific scopes every time (space-separated), acting adds tasks:write and stories:write; PKCE", () => {
    const q = new URL(authorizeUrl(adapter, { kind: "personal", act: true, upgrade: true, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "personal", act: true }) })).searchParams;
    expect(q.get("scope")).toBe("openid email profile users:read workspaces:read projects:read tasks:read webhooks:read webhooks:write webhooks:delete tasks:write stories:write");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(adapter.oauth.scopes({ kind: "workspace", act: false })).not.toContain("tasks:write");
    expect(adapter.oauth.refresh).toBe("reusable");
  });

  it("token answers; refresh without a new refresh token; errors", () => {
    expect(parseToken(fixture("asana/token.ok.json"), new Date())).toMatchObject({ accessToken: "asana-access-fixture-0001", refreshToken: "asana-refresh-fixture-0001", facts: { userGid: ADA } });
    expect(parseToken(fixture("asana/token.refresh.json"), new Date()).refreshToken).toBeNull();
    expect(() => parseToken(fixture("asana/token.error.json"), new Date())).toThrow(expect.objectContaining({ code: "REAUTH_REQUIRED" }));
  });

  it("revokes with the refresh token and the client's credentials", async () => {
    mock.set("POST https://app.asana.com/-/oauth_revoke", { status: 200, text: "" });
    await adapter.revoke!({ conn: conn(), http: http(conn()), tokens: fakeTokens() });
    const f = Object.fromEntries(new URLSearchParams(mock.calls.at(-1)!.body!).entries());
    expect(f).toEqual({ client_id: "asana-client", client_secret: "asana-secret", token: "test-refresh-token-0000" });
    expect(mock.calls.at(-1)!.headers.get("authorization")).toBeNull();
  });
});

describe("identify and sources", () => {
  beforeEach(() => mock.set(`GET ${API}/users/me`, { json: fixture("asana/users-me.json") }));
  it("personal: the user, their first workspace as tenant, up to 5 workspaces kept", async () => {
    const a = await adapter.identify({ kind: "personal", http: http(conn()), tokens: fakeTokens(), pending: {} });
    expect(a).toMatchObject({ externalAccountId: ADA, externalTenantId: WS, accountLabel: "ada@example.com", identity: { externalUserId: ADA, email: "ada@example.com" } });
    expect(a.settings?.workspaces).toHaveLength(2);
  });
  it("workspace: the first Asana workspace, named on the card when there were several", async () => {
    const a = await adapter.identify({ kind: "workspace", http: http(workspace()), tokens: fakeTokens(), pending: {} });
    expect(a).toMatchObject({ externalAccountId: WS, externalTenantId: WS, accountLabel: "Acme (Asana)", settings: { public: { workspace: "Acme" } } });
    expect(a.identity).toBeUndefined();
  });
  it("projects of the workspace, private ones marked", async () => {
    mock.set(`GET ${API}/projects`, { json: fixture("asana/projects.json") });
    expect(await adapter.sources!({ conn: workspace(), http: http(workspace()) })).toEqual([
      { kind: "project", externalId: "1202000000000001", label: "Website", isPrivate: false, archived: false },
      { kind: "project", externalId: "1202000000000002", label: "Hiring", isPrivate: true, archived: false },
    ]);
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("workspace")).toBe(WS);
  });
});

describe("sync", () => {
  it("personal full run: every workspace's open tasks (offset pages), reconciled, then changes since (completed ones included)", async () => {
    const qs: Record<string, string>[] = [];
    mock.set(`GET ${API}/tasks`, (r) => {
      const q = Object.fromEntries(r.url.searchParams.entries());
      qs.push(q);
      if (q.completed_since === "now" && q.workspace === WS) return { json: fixture(q.offset ? "asana/tasks.mine.page2.json" : "asana/tasks.mine.page1.json") };
      return { json: fixture("asana/tasks.empty.json") };
    });
    const { s, api } = sink();
    const now = new Date("2026-10-22T09:00:00Z");
    const r = await adapter.sync!({ conn: conn(), http: http(conn()), stream: "issues", cursor: null, full: true, selected: [], now, timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 });
    expect(qs.map((q) => [q.workspace, q.completed_since, q.offset ?? null])).toEqual([
      [WS, "now", null], [WS, "now", "eyJ0eXAiOJiKV1iQLCJhbGciOiJIUzI1NiJ9"], [WS2, "now", null],
      [WS, "2026-10-20T09:00:00.000Z", null], [WS2, "2026-10-20T09:00:00.000Z", null],
    ]);
    expect(qs[3]).toMatchObject({ assignee: "me", modified_since: "2026-10-20T09:00:00.000Z", limit: "50" });
    expect(s.upserts.map((i) => [i.externalId, i.state, i.mine, i.containerLabel])).toEqual([
      ["1203000000000001", "open", true, "Website"], ["1203000000000002", "done", true, "Website"], ["1203000000000003", "open", true, null],
    ]);
    expect(s.upserts[0]).toMatchObject({ subtype: "task", dueOn: "2026-10-24", url: "https://app.asana.com/0/0/1203000000000001", excerpt: "Draft the copy.", assigneeEmail: "ada@example.com" });
    expect(s.open).toEqual([["1203000000000001", "1203000000000003"]]);
    expect(JSON.parse(r.cursor!)).toEqual({ ph: "inc", i: 0, w: "2026-10-22T07:58:00.000Z", pg: null, mx: null });
  });

  it("workspace: per selected project, the item's source is that project; nothing selected, nothing read", async () => {
    let q: Record<string, string> = {};
    mock.set(`GET ${API}/tasks`, (r) => { q = Object.fromEntries(r.url.searchParams.entries()); return { json: { data: [fixture<{ data: unknown }>("asana/task.json").data], next_page: null } }; });
    const { s, api } = sink();
    await adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: JSON.stringify({ ph: "inc", i: 0, w: "2026-10-21T00:00:00.000Z" }), full: false, selected: [{ kind: "project", externalId: "1202000000000002", label: "Hiring" }], now: new Date(), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 });
    expect(q).toMatchObject({ project: "1202000000000002", modified_since: "2026-10-21T00:00:00.000Z", completed_since: "2026-10-21T00:00:00.000Z" });
    expect(q.assignee).toBeUndefined();
    expect(s.upserts[0]).toMatchObject({ sourceExternalId: "1202000000000002", mine: false });
    mock.calls.length = 0;
    expect(await adapter.sync!({ conn: workspace(), http: http(workspace()), stream: "issues", cursor: null, full: true, selected: [], now: new Date(), timeZone: "UTC", sink: api, deadline: Date.now() + 10_000 })).toEqual({ cursor: null, more: false });
    expect(mock.calls).toHaveLength(0);
  });

  it("402 (a paid Asana feature) is FORBIDDEN; 429 backs off", async () => {
    mock.set(`GET ${API}/tasks/1203000000000001`, { status: 402, json: { errors: [{ message: "payment required" }] } });
    await expect(adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "1203000000000001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.set(`GET ${API}/tasks/1203000000000001`, { status: 429, json: {}, headers: { "retry-after": "30" } });
    await expect(adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "1203000000000001" })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
    mock.set(`GET ${API}/tasks/1203000000000001`, { status: 404, json: { errors: [{ message: "Not found" }] } });
    expect(await adapter.fetchItem!({ conn: conn(), http: http(conn()), kind: "issue", externalId: "1203000000000001" })).toBeNull();
  });
});

describe("webhooks", () => {
  const url = new URL(`https://boredroom.test/api/connectors/webhooks/asana/${HOOK}`);
  const secrets = new Map<string, string>();
  const verify = (raw: string, headers: Record<string, string>, u = url) => adapter.webhook!.verify({
    raw: new TextEncoder().encode(raw), headers: new Headers(headers), url: u,
    secretFor: async (id) => secrets.get(id) ?? null,
    saveSecret: async (id, s) => { if (secrets.has(id)) return false; secrets.set(id, s); return true; },
  });

  it("the handshake seals the secret once and echoes it", async () => {
    const r = await verify("", { "x-hook-secret": "handshake-secret-0001" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.reply?.headers.get("x-hook-secret")).toBe("handshake-secret-0001");
    expect(secrets.get(HOOK)).toBe("handshake-secret-0001");
    expect((await verify("", { "x-hook-secret": "another-secret-0002" })).ok).toBe(false);
    expect((await verify("", { "x-hook-secret": "x" }, new URL("https://boredroom.test/api/connectors/webhooks/asana/not-a-hook"))).ok).toBe(false);
  });

  it("deliveries: X-Hook-Signature with that secret; routed to the hook's connection by task", async () => {
    const body = JSON.stringify(fixture("asana/webhook.events.json"));
    const sig = createHmac("sha256", "handshake-secret-0001").update(body).digest("hex");
    const v = await verify(body, { "x-hook-signature": sig });
    expect(v.ok).toBe(true);
    expect((await verify(body, { "x-hook-signature": createHmac("sha256", "wrong").update(body).digest("hex") })).ok).toBe(false);
    expect((await verify(body, {})).ok).toBe(false);
    // verify handed the hook id to route (the framework parses the same raw body).
    expect(adapter.webhook!.route({ body: JSON.parse(body), headers: new Headers() })).toEqual([{ by: "webhook", webhookId: HOOK, ours: true, externalId: "1203000000000001", kind: "issue" }]);
    // The framework now passes the hook id from the path too (security fix, 22 October 2026).
    expect(adapter.webhook!.route({ body: JSON.parse(body), headers: new Headers(), hookId: HOOK })).toEqual([{ by: "webhook", webhookId: HOOK, ours: true, externalId: "1203000000000001", kind: "issue" }]);
    expect(adapter.webhook!.route({ body: JSON.parse(body), headers: new Headers() })).toEqual([]);
  });

  it("a heartbeat keeps the hook alive; the hook id from the path", () => {
    expect(routeAsana({ events: [] }, HOOK)).toEqual([{ by: "webhook", webhookId: HOOK, ours: true }]);
    expect(hookIdFrom(new URL(`https://x.test/api/connectors/webhooks/asana/${HOOK.toUpperCase()}`))).toBe(HOOK);
    expect(hookIdFrom(new URL("https://x.test/api/connectors/webhooks/asana/../slack"))).toBeNull();
  });

  it("registers on the workspace's selected projects only (none for personal), skipping projects that already have a live hook", async () => {
    mock.set(`GET ${API}/webhooks`, { json: fixture("asana/webhooks.list.json") });
    mock.set(`GET ${API}/projects`, { json: fixture("asana/projects.json") });
    mock.set(`POST ${API}/webhooks`, { status: 201, json: fixture("asana/webhook.created.json") });
    mock.set(`DELETE ${API}/webhooks/1205000000000009`, { status: 200, json: { data: {} } });
    const both = [{ kind: "project" as const, externalId: "1202000000000001", label: "Website" }, { kind: "project" as const, externalId: "1202000000000002", label: "Hiring" }];
    // Nothing selected (just connected): no hooks at all (security fix, 22 October 2026).
    expect(await adapter.registerWebhooks!({ conn: workspace(), http: http(workspace()), hookUrl: (id) => `https://boredroom.test/api/connectors/webhooks/asana/${id}`, newHook: async () => HOOK, selected: [] })).toEqual([]);
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
    const made = await adapter.registerWebhooks!({ conn: workspace(), http: http(workspace()), hookUrl: (id) => `https://boredroom.test/api/connectors/webhooks/asana/${id}`, newHook: async () => HOOK, selected: both });
    expect(made).toEqual([{ hookId: HOOK, externalId: "1205000000000001", expiresAt: null }]);
    expect(lastJson()).toEqual({ data: { resource: "1202000000000001", target: `https://boredroom.test/api/connectors/webhooks/asana/${HOOK}`, filters: ["added", "changed", "removed", "deleted", "undeleted"].map((action) => ({ resource_type: "task", action })) } });
    expect(await adapter.registerWebhooks!({ conn: conn(), http: http(conn()), hookUrl: () => "", newHook: async () => HOOK })).toEqual([]);
    mock.set(`DELETE ${API}/webhooks/1205000000000001`, { status: 200, json: { data: {} } });
    await adapter.deleteWebhook!({ conn: workspace(), http: http(workspace()), externalId: "1205000000000001" });
    expect(mock.calls.at(-1)!.method).toBe("DELETE");
  });

  it("a project no longer selected loses Boredroom's hook at Asana; nothing new is made for it", async () => {
    mock.set(`GET ${API}/webhooks`, { json: fixture("asana/webhooks.list.json") });
    mock.set(`GET ${API}/projects`, { json: fixture("asana/projects.json") });
    mock.set(`DELETE ${API}/webhooks/1205000000000009`, { status: 200, json: { data: {} } });
    const made = await adapter.registerWebhooks!({ conn: workspace(), http: http(workspace()), hookUrl: (id) => `https://boredroom.test/api/connectors/webhooks/asana/${id}`, newHook: async () => HOOK, selected: [] });
    expect(made).toEqual([]);
    expect(mock.calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname)).toEqual(["/api/1.0/webhooks/1205000000000009"]);
  });
});

describe("actions (the person's own connection only)", () => {
  it("personal only; changes need the person's own account", () => {
    for (const a of adapter.actions) expect(a.kinds).toEqual(["personal"]);
    expect(adapter.workspaceActs).toBe(false);
    expect(adapter.ownerBound).toBe(true);
  });

  it("create: a task in the project (or My Tasks), as the person", async () => {
    const p = await spec("create_issue").prepare(act(conn(), { title: "Book the venue", text: "For 40 people." }, { item: null, source: project }));
    expect(p).toMatchObject({ risk: "shared", summary: "Create an Asana task in Website", detail: "For 40 people.", readback: { to: ["Everyone who can see Website in Asana"], what: "A new task “Book the venue”, created as you (ada@example.com)" } });
    mock.set(`POST ${API}/tasks`, { status: 201, json: fixture("asana/task.json") });
    await spec("create_issue").run(act(conn(), { title: "Book the venue", text: "For 40 people." }, { item: null, source: project }));
    expect(lastJson()).toEqual({ data: { name: "Book the venue", notes: "For 40 people.", projects: ["1202000000000001"] } });
    await spec("create_issue").run(act(conn(), { title: "Book the venue" }, { item: null, source: null }));
    expect(lastJson()).toEqual({ data: { name: "Book the venue", workspace: WS, assignee: "me" } });
  });

  it("comment: a story with the exact words", async () => {
    expect((await spec("comment").prepare(act(conn(), { text: "Done by Friday." }))).summary).toBe("Comment on “Write the plan”");
    mock.set(`POST ${API}/tasks/1203000000000001/stories`, { status: 201, json: fixture("asana/story.json") });
    await spec("comment").run(act(conn(), { text: "Done by Friday." }));
    expect(lastJson()).toEqual({ data: { text: "Done by Friday." } });
  });

  it("set_state: completed or not; no in-progress or cancelled in Asana", async () => {
    mock.set(`GET ${API}/tasks/1203000000000001`, { json: fixture("asana/task.json") });
    expect(await spec("set_state").prepare(act(conn(), { state: "done" }))).toMatchObject({ risk: "shared", summary: "Move “Write the plan” to Completed", readback: { what: "“Write the plan” moves from Not completed to Completed" } });
    await expect(spec("set_state").prepare(act(conn(), { state: "in_progress" }))).rejects.toMatchObject({ name: "ActRefusal" });
    await expect(spec("set_state").prepare(act(conn(), { state: "cancelled" }))).rejects.toMatchObject({ name: "ActRefusal" });
    mock.set(`PUT ${API}/tasks/1203000000000001`, { json: fixture("asana/task.done.json") });
    const r = await spec("set_state").run(act(conn(), { state: "done" }));
    expect(lastJson()).toEqual({ data: { completed: true } });
    expect(r.item?.state).toBe("done");
  });

  it("assign: me, an email Asana knows, or one exact name; otherwise words", async () => {
    expect((await spec("assign").prepare(act(conn(), { assignee: "me" }))).readback.to[0]).toBe("You, whom Asana tells");
    mock.set(`GET ${API}/users/ben%40example.com`, { json: fixture("asana/user.ben.json") });
    expect((await spec("assign").prepare(act(conn(), { assignee: "ben@example.com" }))).summary).toBe("Assign “Write the plan” to Ben Ade");
    mock.set(`GET ${API}/tasks/1203000000000001`, { json: fixture("asana/task.workspace.json") });
    mock.set(`GET ${API}/workspaces/${WS}/typeahead`, { json: fixture("asana/typeahead.json") });
    expect((await spec("assign").prepare(act(conn(), { assignee: "Ben Ade" }))).summary).toBe("Assign “Write the plan” to Ben Ade");
    await expect(spec("assign").prepare(act(conn(), { assignee: "Ben" }))).rejects.toMatchObject({ name: "ActRefusal", words: expect.stringContaining("Ben Ade, Ben Adeyemi") });
    mock.set(`PUT ${API}/tasks/1203000000000001`, { json: fixture("asana/task.json") });
    await spec("assign").run(act(conn(), { assignee: "me" }));
    expect(lastJson()).toEqual({ data: { assignee: "me" } });
  });

  it("set_due: due_on, or both cleared", async () => {
    expect((await spec("set_due").prepare(act(conn(), { due: "2026-10-24" }))).readback.what).toBe("“Write the plan” is due Saturday 24 October");
    mock.set(`PUT ${API}/tasks/1203000000000001`, { json: fixture("asana/task.json") });
    await spec("set_due").run(act(conn(), { due: null }));
    expect(lastJson()).toEqual({ data: { due_on: null, due_at: null } });
  });
});
