/**
 * Microsoft Teams adapter (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.2, §9.5, §10.3,
 * §16.2). No database and no network: injected token deps and mockProviders with fixtures hand-written from Microsoft's
 * public reference (tests/fixtures/connectors/microsoft). An unmocked call throws.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adapter, channelSourceId, splitChannelSourceId, teamsContent } from "@/server/connectors/adapters/teams";
import { MSA_TENANT } from "@/server/connectors/adapters/microsoft";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fixture, fakeTokens, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import type { ActInput, ActionSpec, Actor, ConnectionRef, ProviderAdapter, StoredSource } from "@/server/connectors/types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN = "test-ms-access-token-0002";
const TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const TEAM = "172b0cce-e65d-44ce-9a49-91d9f2e8493a";
const CHANNEL = "19:561fbdbbfca848a484f0a6f00ce9dbbd@thread.tacv2";
const saved = { ...process.env };

const unspaced: ProviderAdapter = adapter;
const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: randomUUID(), organisationId: randomUUID(), provider: "teams", kind: "workspace", membershipId: null, connectedBy: "m-owner",
  externalAccountId: TENANT, externalTenantId: TENANT, accountLabel: "Contoso Ltd (Teams)", scopes: [], settings: { postsAs: "Jerry Onwuka", public: { postsAs: "Jerry Onwuka" } }, canRead: true, canAct: true, ...over,
});
function client(c: ConnectionRef = conn()) {
  const deps: HttpDeps = { token: async () => ({ accessToken: TOKEN, expiresAt: null }), refresh: async () => TOKEN, backoff: async () => undefined };
  return { http: httpFor(c, unspaced, deps), conn: c };
}
const actor: Actor = { membershipId: "m-1", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const source: StoredSource = { id: randomUUID(), kind: "channel", externalId: channelSourceId(TEAM, CHANNEL), label: "Design › General", members: null };
const post = adapter.actions.find((a) => a.name === "post") as ActionSpec;
const act = (c: ConnectionRef, http: ReturnType<typeof client>["http"], input: Record<string, unknown>, src: StoredSource | null = source): ActInput<Record<string, unknown>> =>
  ({ conn: c, http, actor, input: post.input.parse(input) as Record<string, unknown>, item: null, source: src, now: new Date("2026-10-22T09:00:00Z") });

let mock: ProviderMock;
beforeAll(() => {
  process.env.MICROSOFT_CLIENT_ID = "test-ms-client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "test-ms-client-secret";
  process.env.APP_ORIGIN = "https://boredroom.test";
  mock = mockProviders({});
});
afterEach(() => { mock.calls.length = 0; });
afterAll(() => { mock.restore(); process.env = saved; });

describe("Microsoft Teams: connecting", () => {
  it("work and school accounts only (organizations), workspace only, the posting scopes asked for at connect", () => {
    expect(adapter.kinds).toEqual(["workspace"]);
    expect(adapter.ownerBound).toBe(true);
    expect(adapter.workspaceActs).toBe(true);
    for (const a of [false, true]) {
      const u = new URL(authorizeUrl(adapter, { kind: "workspace", act: a, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "workspace", act: a }) }));
      expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
      expect(u.searchParams.get("scope")).toBe("openid profile email offline_access User.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send");
      expect(u.searchParams.get("response_mode")).toBe("query");
      expect(u.searchParams.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/teams/callback");
    }
    const t = adapter.oauth.parseToken(fixture("microsoft/token.teams.json"), new Date());
    expect(adapter.oauth.scopes({ kind: "workspace", act: true }).every((s) => t.scopes!.includes(s))).toBe(true);
  });

  it("identifies the tenant (so another owner can reconnect it) and keeps whose account posts", async () => {
    const { http } = client();
    mock.set(`GET ${GRAPH}/me`, { json: fixture("microsoft/me.json") });
    mock.set(`GET ${GRAPH}/organization`, { json: fixture("microsoft/organization.json") });
    const a = await adapter.identify({ kind: "workspace", http, tokens: fakeTokens({ facts: { idTokenClaims: { tid: TENANT } } }), pending: {} });
    expect(a).toEqual({ externalAccountId: TENANT, externalTenantId: TENANT, accountLabel: "Contoso Ltd (Teams)", settings: { postsAs: "Ada Obi", public: { postsAs: "Ada Obi" } } });
  });

  it("falls back to the domain when the organisation can't be read; refuses personal Microsoft accounts", async () => {
    const { http } = client();
    mock.set(`GET ${GRAPH}/me`, { json: fixture("microsoft/me.json") });
    mock.set(`GET ${GRAPH}/organization`, { status: 403, json: fixture("microsoft/error.accessDenied.json") });
    const a = await adapter.identify({ kind: "workspace", http, tokens: fakeTokens({ facts: { idTokenClaims: { tid: TENANT } } }), pending: {} });
    expect(a.accountLabel).toBe("Microsoft Teams (contoso.example.com)");
    await expect(adapter.identify({ kind: "workspace", http, tokens: fakeTokens({ facts: { idTokenClaims: { tid: MSA_TENANT } } }), pending: {} })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("an admin-approval answer at the token endpoint is ADMIN_APPROVAL", () => {
    expect(() => adapter.oauth.parseToken(fixture("microsoft/token.error.admin.json"), new Date())).toThrow(expect.objectContaining({ code: "ADMIN_APPROVAL" }));
  });
});

describe("Microsoft Teams: channels", () => {
  it("lists the person's teams' channels as 'Team › Channel', member counts unknown", async () => {
    const { http, conn: c } = client();
    mock.set(`GET ${GRAPH}/me/joinedTeams`, { json: fixture("microsoft/joinedTeams.json") });
    mock.set(`GET ${GRAPH}/teams/${TEAM}/channels`, { json: fixture("microsoft/channels.design.json") });
    mock.set(`GET ${GRAPH}/teams/2e2b1c4a-0000-4b6c-9a49-91d9f2e84900/channels`, { status: 403, json: fixture("microsoft/error.accessDenied.json") });
    const s = await adapter.sources!({ conn: c, http });
    expect(s).toEqual([
      { kind: "channel", externalId: `${TEAM}|${CHANNEL}`, label: "Design › General", members: null, isPrivate: false, archived: false },
      { kind: "channel", externalId: `${TEAM}|19:8c4b2f7e@thread.tacv2`, label: "Design › Leads", members: null, isPrivate: true, archived: false },
    ]);
    expect(new URL(mock.calls[1].url).searchParams.get("$select")).toBe("id,displayName,membershipType");
  });

  it("splits a channel source id back into team and channel", () => {
    expect(splitChannelSourceId(`${TEAM}|${CHANNEL}`)).toEqual({ teamId: TEAM, channelId: CHANNEL });
    expect(splitChannelSourceId("no-separator")).toBeNull();
  });
});

describe("Microsoft Teams: posting", () => {
  it("prepare: shared, the exact card, from whose account and signed", async () => {
    const { http, conn: c } = client();
    const p = await post.prepare(act(c, http, { text: "Release is out." }));
    expect(p).toEqual({
      risk: "shared", summary: "Post in Design › General on Microsoft Teams", detail: "Release is out.\n\nPosted by Boredroom for Jo",
      readback: { to: ["Design › General in Microsoft Teams, member count not available"], what: "Your words, posted from Jerry Onwuka's Microsoft account, signed “Posted by Boredroom for Jo”" },
      appearsAs: "from Jerry Onwuka's Microsoft account, signed “Posted by Boredroom for Jo”", place: "Design › General", people: null,
    });
    await expect(post.prepare(act(c, http, { text: "x" }, null))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("run: POST to the channel's messages with escaped HTML, exactly the card's words", async () => {
    const { http, conn: c } = client();
    mock.set(`POST ${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages`, { status: 201, json: fixture("microsoft/chatMessage.created.json") });
    const r = await post.run(act(c, http, { text: "Ship <b>it</b> & \"go\"\nnext line\n\n<script>alert(1)</script>" }));
    const call = mock.calls.at(-1)!;
    expect(call.method).toBe("POST");
    expect(new URL(call.url).pathname).toBe(`/v1.0/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages`);
    expect(JSON.parse(call.body!)).toEqual({ body: { contentType: "html", content: "<p>Ship &lt;b&gt;it&lt;/b&gt; &amp; &quot;go&quot;<br>next line</p><p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>Posted by Boredroom for Jo</p>" } });
    expect(r.summary).toBe("Posted in Design › General on Microsoft Teams");
    expect(r.href).toMatch(/^https:\/\/teams\.microsoft\.com\//);
  });

  it("route posts render the neutral post as escaped HTML, signed by Boredroom", () => {
    const c = conn();
    const html = teamsContent({ conn: c, http: client(c).http, actor, input: { text: "x", post: { heading: "Design <digest>", lines: ["Done: “Fix & ship”"], link: { label: "Open Boredroom", href: "https://boredroom.test/app/acme/tasks" } } }, item: null, source, now: new Date() });
    expect(html).toBe("<p><strong>Design &lt;digest&gt;</strong></p><p>Done: “Fix &amp; ship”</p><p><a href=\"https://boredroom.test/app/acme/tasks\">Open Boredroom</a></p><p><em>Posted by Boredroom</em></p>");
  });

  it("a channel Boredroom can't post in any more is FORBIDDEN or NOT_FOUND (the route turns off)", async () => {
    const { http, conn: c } = client();
    mock.set(`POST ${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages`, { status: 403, json: fixture("microsoft/error.accessDenied.json") });
    await expect(post.run(act(c, http, { text: "hi" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.set(`POST ${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages`, { status: 404, json: fixture("microsoft/error.notFound.json") });
    await expect(post.run(act(c, http, { text: "hi" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("post only, workspace only; no fixed spacing; no revoke", () => {
    expect(adapter.actions.map((a) => [a.name, a.tool, a.kinds])).toEqual([["post", "post_to_channel", ["workspace"]]]);
    expect(adapter.limits?.spacingMs).toBeUndefined();
    expect(adapter.revoke).toBeUndefined();
    expect(() => post.input.parse({ text: "x".repeat(3001) })).toThrow();
  });
});
