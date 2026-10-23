/**
 * Slack adapter (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §7, §8.3, §9.5, §10.3,
 * §16.2). No database and no network: injected token deps and mockProviders with fixtures hand-written from Slack's
 * public reference (tests/fixtures/connectors/slack). An unmocked call throws.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adapter, interpretSlack, slackSignatureOf, slackText } from "@/server/connectors/adapters/slack";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fixture, fakeTokens, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import { ConnectorError, type ActInput, type ActionSpec, type Actor, type ConnectionRef, type ProviderAdapter, type StoredSource } from "@/server/connectors/types";

const API = "https://slack.com/api";
const TOKEN = "xoxe.xoxb-test-slack-access-token";
const SECRET = "test-slack-signing-secret";
const saved = { ...process.env };

const unspaced: ProviderAdapter = { ...adapter, limits: undefined };
const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: randomUUID(), organisationId: randomUUID(), provider: "slack", kind: "workspace", membershipId: null, connectedBy: "m-owner",
  externalAccountId: "T9TK3CUKW", externalTenantId: "T9TK3CUKW", accountLabel: "Acme Design (Slack)", scopes: [], settings: {}, canRead: true, canAct: true, ...over,
});
function client(c: ConnectionRef = conn(), a: ProviderAdapter = unspaced) {
  const calls = { refresh: 0, backoff: [] as number[] };
  const deps: HttpDeps = {
    token: async () => ({ accessToken: TOKEN, expiresAt: null }),
    refresh: async () => { calls.refresh++; return TOKEN; },
    backoff: async (s) => { calls.backoff.push(s); },
  };
  return { http: httpFor(c, a, deps), calls, conn: c };
}
const actor: Actor = { membershipId: "m-1", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const source: StoredSource = { id: randomUUID(), kind: "channel", externalId: "C012AB3CD", label: "#design", members: 14 };
const post = adapter.actions.find((a) => a.name === "post") as ActionSpec;
const act = (c: ConnectionRef, http: ReturnType<typeof client>["http"], input: Record<string, unknown>, src: StoredSource | null = source): ActInput<Record<string, unknown>> =>
  ({ conn: c, http, actor, input: post.input.parse(input) as Record<string, unknown>, item: null, source: src, now: new Date("2026-10-22T09:00:00Z") });

let mock: ProviderMock;
beforeAll(() => {
  process.env.SLACK_CLIENT_ID = "test-slack-client-id";
  process.env.SLACK_CLIENT_SECRET = "test-slack-client-secret";
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.APP_ORIGIN = "https://boredroom.test";
  mock = mockProviders({});
});
afterEach(() => { mock.calls.length = 0; });
afterAll(() => { mock.restore(); process.env = saved; });

describe("Slack: connecting", () => {
  it("needs all three variables; workspace only; bot scopes comma-separated; no PKCE", () => {
    expect(adapter.configured({ SLACK_CLIENT_ID: "a", SLACK_CLIENT_SECRET: "b" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(adapter.configured({ SLACK_CLIENT_ID: "a", SLACK_CLIENT_SECRET: "b", SLACK_SIGNING_SECRET: "c" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(adapter.kinds).toEqual(["workspace"]);
    const u = new URL(authorizeUrl(adapter, { kind: "workspace", act: true, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "workspace", act: true }) }));
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("scope")).toBe("chat:write,channels:read,groups:read");
    expect(u.searchParams.get("user_scope")).toBeNull();
    expect(u.searchParams.get("code_challenge")).toBeNull();
    expect(u.searchParams.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/slack/callback");
    expect(adapter.oauth.scopes({ kind: "workspace", act: false })).toEqual(["chat:write", "channels:read", "groups:read"]);
    expect(adapter.oauth.scopes({ kind: "workspace", act: true }).join()).not.toContain("chat:write.public");
  });

  it("parses the rotating bot token and the team; identifies the workspace", async () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const t = adapter.oauth.parseToken(fixture("slack/oauth.v2.access.ok.json"), now);
    expect(t).toMatchObject({ accessToken: "xoxe.xoxb-test-slack-access-0001", refreshToken: "xoxe-test-slack-refresh-0001", tokenType: "bot", scopes: ["chat:write", "channels:read", "groups:read"] });
    expect(t.expiresAt?.toISOString()).toBe("2026-10-22T21:00:00.000Z");
    expect(adapter.oauth.scopes({ kind: "workspace", act: true }).every((s) => t.scopes!.includes(s))).toBe(true);
    const { http } = client();
    const a = await adapter.identify({ kind: "workspace", http, tokens: t, pending: {} });
    expect(a).toEqual({ externalAccountId: "T9TK3CUKW", externalTenantId: "T9TK3CUKW", accountLabel: "Acme Design (Slack)", settings: { botUserId: "U0KRQLJ9H" } });
    expect(mock.calls).toHaveLength(0);
    expect(adapter.oauth.parseToken(fixture("slack/oauth.v2.access.refresh.json"), now).refreshToken).toBe("xoxe-test-slack-refresh-0003");
  });

  it("refuses an Enterprise Grid organisation install with the fixed code", () => {
    try { adapter.oauth.parseToken(fixture("slack/oauth.v2.access.enterprise.json"), new Date()); expect.unreachable(); }
    catch (e) { expect((e as ConnectorError).code).toBe("NOT_ALLOWED"); expect((e as Error).message.split(":")[0]).toBe("enterprise_install"); }
  });

  it("ok:false token answers: a bad refresh token means reconnect; a bad code is a plain failure", () => {
    expect(() => adapter.oauth.parseToken(fixture("slack/oauth.v2.access.invalid_refresh_token.json"), new Date())).toThrow(expect.objectContaining({ code: "REAUTH_REQUIRED" }));
    expect(() => adapter.oauth.parseToken(fixture("slack/oauth.v2.access.invalid_code.json"), new Date())).toThrow(expect.objectContaining({ code: "BAD_RESPONSE" }));
  });
});

describe("Slack: channels", () => {
  it("lists only channels Boredroom is in (public and private), up to 5 pages, with member counts", async () => {
    const { http, conn: c } = client();
    mock.set(`GET ${API}/conversations.list`, (req) => ({ json: fixture(req.url.searchParams.get("cursor") ? "slack/conversations.list.page2.json" : "slack/conversations.list.page1.json") }));
    const s = await adapter.sources!({ conn: c, http });
    expect(s).toEqual([
      { kind: "channel", externalId: "C012AB3CD", label: "#design", members: 14, isPrivate: false, archived: false },
      { kind: "channel", externalId: "G0AKFJBEU", label: "#leads", members: 4, isPrivate: true, archived: false },
      { kind: "channel", externalId: "C0G9QF9GW", label: "#standups", members: null, isPrivate: false, archived: false },
    ]);
    const q = new URL(mock.calls[0].url).searchParams;
    expect(q.get("types")).toBe("public_channel,private_channel");
    expect(q.get("exclude_archived")).toBe("true");
    expect(q.get("limit")).toBe("200");
    expect(new URL(mock.calls[1].url).searchParams.get("cursor")).toBe("dGVhbTpDMDYxRkE1UEI=");
    expect(mock.calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);

    mock.calls.length = 0;
    mock.set(`GET ${API}/conversations.list`, { json: fixture("slack/conversations.list.page1.json") });
    await adapter.sources!({ conn: c, http });
    expect(mock.calls).toHaveLength(5);
  });
});

describe("Slack: posting", () => {
  it("prepare: shared, the exact card as the Boredroom app, signed", async () => {
    const { http, conn: c } = client();
    const p = await post.prepare(act(c, http, { text: "Release is out." }));
    expect(p).toEqual({
      risk: "shared", summary: "Post in #design on Slack", detail: "Release is out.\n\nFrom Jo via Max",
      readback: { to: ["#design in Slack, 14 people"], what: "Your words, posted by the Boredroom app, signed “Jo via Max”" },
      appearsAs: "by the Boredroom app, signed “Jo via Max”", place: "#design", people: 14,
    });
    await expect(post.prepare(act(c, http, { text: "x" }, null))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("run: chat.postMessage with escaped mrkdwn, no unfurls, no link names", async () => {
    const { http, conn: c } = client();
    mock.set(`POST ${API}/chat.postMessage`, { json: fixture("slack/chat.postMessage.ok.json") });
    const r = await post.run(act(c, http, { text: "Heads up <!channel> @here & <@U123> <https://evil.example.com|click>" }));
    const body = JSON.parse(mock.calls.at(-1)!.body!);
    expect(body).toEqual({
      channel: "C012AB3CD",
      text: "Heads up &lt;!channel&gt; @here &amp; &lt;@U123&gt; &lt;https://evil.example.com|click&gt;\n\nFrom Jo via Max",
      unfurl_links: false, unfurl_media: false, link_names: false, parse: "none",
    });
    expect(body.text).not.toMatch(/<!|<@|<http/);
    expect(mock.calls.at(-1)!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(r.summary).toBe("Posted in #design on Slack");
  });

  it("route posts render the neutral post (escaped, one Boredroom link), unsigned", () => {
    const c = conn();
    const text = slackText({ conn: c, http: client(c).http, actor, input: { text: "x", post: { heading: "Design <!here>", lines: ["Done: Fix & ship"], link: { label: "Open Boredroom", href: "https://boredroom.test/app/acme/tasks" } } }, item: null, source, now: new Date() });
    expect(text).toBe("*Design &lt;!here&gt;*\nDone: Fix &amp; ship\n<https://boredroom.test/app/acme/tasks|Open Boredroom>");
  });

  it("Slack's ok:false answers become fixed codes (the route turns off on NOT_ALLOWED)", async () => {
    const { http, conn: c, calls } = client();
    for (const [f, code] of [["slack/chat.postMessage.not_in_channel.json", "NOT_ALLOWED"], ["slack/chat.postMessage.is_archived.json", "NOT_ALLOWED"], ["slack/token_revoked.json", "REVOKED"]] as const) {
      mock.set(`POST ${API}/chat.postMessage`, { json: fixture(f) });
      await expect(post.run(act(c, http, { text: "hi" }))).rejects.toMatchObject({ code });
    }
    mock.set(`POST ${API}/chat.postMessage`, { status: 429, json: fixture("slack/ratelimited.json"), headers: { "retry-after": "30" } });
    await expect(post.run(act(c, http, { text: "hi" }))).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect(calls.backoff).toEqual([30]);
    // invalid_auth: one refresh and a retry, then reconnect.
    mock.set(`POST ${API}/chat.postMessage`, { json: fixture("slack/invalid_auth.json") });
    await expect(post.run(act(c, http, { text: "hi" }))).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(calls.refresh).toBe(1);
    expect(interpretSlack({ status: 200, headers: new Headers(), body: { ok: true } })).toBeNull();
    expect(interpretSlack({ status: 200, headers: new Headers(), body: { ok: false, error: "msg_too_long" } })?.code).toBe("TOO_LARGE");
  });

  it("post only, workspace only; one call a second", () => {
    expect(adapter.actions.map((a) => [a.name, a.tool, a.kinds])).toEqual([["post", "post_to_channel", ["workspace"]]]);
    expect(adapter.limits?.spacingMs).toBe(1000);
    expect(adapter.ownerBound).toBe(false);
    expect(adapter.workspaceActs).toBe(true);
  });
});

describe("Slack: events", () => {
  const raw = (f: string) => new TextEncoder().encode(JSON.stringify(fixture(f)));
  const signed = (body: Uint8Array, ts = Math.floor(Date.now() / 1000), secret = SECRET) =>
    new Headers({ "x-slack-request-timestamp": String(ts), "x-slack-signature": slackSignatureOf(secret, String(ts), body), "content-type": "application/json" });
  const verify = (body: Uint8Array, headers: Headers) => adapter.webhook!.verify({ raw: body, headers, url: new URL("https://boredroom.test/api/connectors/webhooks/slack"), secretFor: async () => null, saveSecret: async () => false });

  it("accepts a good signature, deduplicates by event id", async () => {
    const body = raw("slack/event.app_uninstalled.json");
    const r = await verify(body, signed(body));
    expect(r).toEqual({ ok: true, deliveryId: "Ev0PV52K21" });
  });

  it("refuses a bad signature, another secret, a stale or missing timestamp", async () => {
    const body = raw("slack/event.app_uninstalled.json");
    const tampered = new TextEncoder().encode(new TextDecoder().decode(body).replace("T9TK3CUKW", "T0000EVIL"));
    expect(await verify(tampered, signed(body))).toEqual({ ok: false });
    expect(await verify(body, signed(body, undefined, "another-secret"))).toEqual({ ok: false });
    expect(await verify(body, signed(body, Math.floor(Date.now() / 1000) - 301))).toEqual({ ok: false });
    expect(await verify(body, new Headers({ "x-slack-signature": "v0=abc" }))).toEqual({ ok: false });
  });

  it("answers url_verification with the challenge, only after verifying it", async () => {
    const body = raw("slack/event.url_verification.json");
    const r = await verify(body, signed(body));
    expect(r.ok).toBe(true);
    const reply = (r as { reply?: Response }).reply!;
    expect(await reply.json()).toEqual({ challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" });
    expect(await verify(body, signed(body, undefined, "wrong"))).toEqual({ ok: false });
  });

  it("routes app_uninstalled and a revoked bot token to a disconnect of that team; ignores the rest", () => {
    const route = (f: string) => adapter.webhook!.route({ body: fixture(f), headers: new Headers() });
    expect(route("slack/event.app_uninstalled.json")).toEqual([{ by: "tenant", tenantId: "T9TK3CUKW", revoked: true }]);
    expect(route("slack/event.tokens_revoked.json")).toEqual([{ by: "tenant", tenantId: "T9TK3CUKW", revoked: true }]);
    expect(route("slack/event.tokens_revoked.user.json")).toEqual([]);
    expect(route("slack/event.url_verification.json")).toEqual([]);
  });
});

describe("Slack: revoking", () => {
  it("calls auth.revoke with the stored token", async () => {
    const { http, conn: c } = client();
    mock.set(`POST ${API}/auth.revoke`, { json: fixture("slack/auth.revoke.ok.json") });
    await adapter.revoke!({ conn: c, http, tokens: fakeTokens({ accessToken: "xoxe.xoxb-to-revoke" }) });
    expect(mock.calls.at(-1)!.headers.get("authorization")).toBe("Bearer xoxe.xoxb-to-revoke");
  });
});
