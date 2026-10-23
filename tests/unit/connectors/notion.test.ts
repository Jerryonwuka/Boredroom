/**
 * Notion adapter (knowledge group; owner decisions, 22 October 2026: connectors; spec §8.4, §9.5, §16.2). No network: every
 * call goes to `mockProviders` (an unmocked call throws), answered from fixtures hand-written from Notion's public API
 * reference (tests/fixtures/connectors/notion, each with its "_source"). People and pages in them are invented.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adapter, interpret, nid, parseToken, readCursor, NOTION_VERSION } from "@/server/connectors/adapters/notion";
import { BLOCKS_MAX, RICH_TEXT_MAX, blocksText, cleanMarkdown, parseText, richText, textToBlocks } from "@/server/connectors/adapters/notion-blocks";
import { httpFor, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fakeTokens, fixture, mockProviders, type MockRequest, type MockRoute, type ProviderMock } from "@/server/connectors/testing";
import { ConnectorError, type ActInput, type ActionSpec, type Actor, type ConnectionRef, type NormalisedItem, type SourceInfo, type StoredItem, type SyncInput } from "@/server/connectors/types";
import { entry } from "@/lib/connectors/providers/notion";

const API = "https://api.notion.com/v1";
const ID = {
  policies: "11111111-1111-4111-8111-111111111111", leave: "22222222-2222-4222-8222-222222222222", specs: "33333333-3333-4333-8333-333333333333",
  login: "44444444-4444-4444-8444-444444444444", roadmap: "66666666-6666-4666-8666-666666666666", row: "77777777-7777-4777-8777-777777777777",
  trashed: "88888888-8888-4888-8888-888888888888", column: "99999999-9999-4999-8999-999999999999", expenses: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  teamspace: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const NEXT = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";

const saved = { ...process.env };
beforeAll(() => {
  process.env.NOTION_CLIENT_ID = "test-notion-client-id";
  process.env.NOTION_CLIENT_SECRET = "test-notion-client-secret";
  process.env.APP_ORIGIN = "https://boredroom.test";
});
afterAll(() => { process.env = saved; });

let mock: ProviderMock | null = null;
afterEach(() => { mock?.restore(); mock = null; vi.restoreAllMocks(); });

function conn(kind: "workspace" | "personal", over: Partial<ConnectionRef> = {}): ConnectionRef {
  return {
    id: kind === "workspace" ? "c0000000-0000-4000-8000-00000000000a" : "c0000000-0000-4000-8000-00000000000b", organisationId: "o0000000-0000-4000-8000-000000000001",
    provider: "notion", kind, membershipId: kind === "personal" ? "m0000000-0000-4000-8000-000000000001" : null, connectedBy: "m0000000-0000-4000-8000-000000000001",
    externalAccountId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e", externalTenantId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e", accountLabel: "Acme",
    scopes: [], settings: {}, canRead: true, canAct: true, ...over,
  };
}

/** The adapter without its 350 ms spacing (unit tests only), on test token dependencies. */
function testHttp(c: ConnectionRef, o: { refreshes?: boolean[]; backoffs?: number[] } = {}) {
  const deps: HttpDeps = {
    token: async () => ({ accessToken: "test-access-token-0000", expiresAt: null }),
    refresh: async (force) => { o.refreshes?.push(force); return "test-access-token-0001"; },
    backoff: async (s) => { o.backoffs?.push(s); },
  };
  return httpFor(c, { ...adapter, limits: undefined }, deps);
}

function recordingSink() {
  const r = { upserts: [] as NormalisedItem[], gone: [] as string[], reconciled: null as string[] | null };
  return {
    r,
    sink: {
      upsert: async (items: NormalisedItem[]) => { r.upserts.push(...items); },
      gone: async (_k: string, ids: string[]) => { r.gone.push(...ids); },
      reconcileWindow: async () => { throw new Error("pages are never windowed"); },
      reconcileOpen: async (_k: string, ids: string[]) => { r.reconciled = ids; },
    },
  };
}

/** Search answers by start_cursor, like Notion's: the first page, then the second. */
const searchRoute = (o: { stale?: string } = {}): MockRoute => (req: MockRequest) => {
  const body = req.json() as { start_cursor?: string };
  if (o.stale && body.start_cursor === o.stale) return { status: 400, json: fixture("notion/error.validation.json") };
  return { json: fixture(body.start_cursor === NEXT ? "notion/search.pages.2.json" : "notion/search.pages.1.json") };
};

const md = (path: string) => ({ json: fixture(path) });
const markdownRoutes = (bump?: () => void): Record<string, MockRoute> => Object.fromEntries(
  [ID.policies, ID.leave, ID.specs, ID.login, ID.row, ID.expenses].map((id) => [`GET ${API}/pages/${id}/markdown`, () => {
    bump?.();
    return md(id === ID.leave ? "notion/page.markdown.leave.json" : id === ID.login ? "notion/page.markdown.long.json" : "notion/page.markdown.short.json");
  }]),
);

const selected = (ids: [string, string][]): SourceInfo[] => ids.map(([externalId, label]) => ({ kind: "page", externalId, label }));

function syncInput(c: ConnectionRef, sink: SyncInput["sink"], o: Partial<SyncInput> = {}): SyncInput {
  return { conn: c, http: testHttp(c), stream: "pages", cursor: null, full: false, selected: [], now: new Date("2026-10-22T09:00:00Z"), timeZone: "Europe/London", sink, deadline: Date.now() + 15_000, ...o };
}

const allHaveVersion = (m: ProviderMock) => m.calls.every((c) => c.headers.get("notion-version") === NOTION_VERSION);

// ---- OAuth -----------------------------------------------------------------------------------------------------------------

describe("Notion OAuth", () => {
  it("is offered only with both variables, and declares them", () => {
    expect(adapter.env).toEqual(["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"]);
    expect(adapter.configured({ NOTION_CLIENT_ID: "a", NOTION_CLIENT_SECRET: "b" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(adapter.configured({ NOTION_CLIENT_ID: "a" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(adapter.configured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("authorises with owner=user, no scopes and no PKCE; tokens by JSON with HTTP Basic", () => {
    for (const kind of ["workspace", "personal"] as const) {
      for (const act of [false, true]) {
        const scopes = adapter.oauth.scopes({ kind, act });
        expect(scopes).toEqual([]);
        const q = new URL(authorizeUrl(adapter, { kind, act, upgrade: false, state: "STATE", nonce: "NONCE", codeChallenge: "ignored", scopes })).searchParams;
        expect(q.get("owner")).toBe("user");
        expect(q.get("client_id")).toBe("test-notion-client-id");
        expect(q.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/notion/callback");
        expect(q.get("response_type")).toBe("code");
        expect(q.get("state")).toBe("STATE");
        expect(q.get("scope")).toBeNull();
        expect(q.get("code_challenge")).toBeNull();
      }
    }
    expect(adapter.oauth.authorizeUrl).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(adapter.oauth.tokenUrl).toBe("https://api.notion.com/v1/oauth/token");
    expect(adapter.oauth.clientAuth).toBe("basic");
    expect(adapter.oauth.tokenBody).toBe("json");
    expect(adapter.oauth.pkce).toBe("none");
    expect(adapter.oauth.refresh).toBe("rotating");
  });

  it("parses the token answer, with the workspace and the person as facts", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const t = parseToken(fixture("notion/token.ok.json"), now);
    expect(t.accessToken).toBe("ntn_test_access_token_fixture_0001");
    expect(t.refreshToken).toBe("nrt_test_refresh_token_fixture_0001");
    expect(t.expiresAt).toBeNull();
    expect(t.facts).toEqual({ botId: "b0b0b0b0-1111-4222-8333-444455556666", workspaceId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e", workspaceName: "Acme", ownerUserId: "f0e1d2c3-b4a5-4968-8776-655443322110", ownerName: "Ada Obi" });
    const r = parseToken(fixture("notion/token.refresh.json"), now);
    expect(r.refreshToken).toBe("nrt_test_refresh_token_fixture_0002");
    expect(parseToken({ ...fixture<Record<string, unknown>>("notion/token.ok.json"), expires_in: 3600 }, now).expiresAt?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });

  it("refuses an error answer as reconnect, without the provider's words or a token", () => {
    const now = new Date();
    try { parseToken(fixture("notion/token.error.json"), now); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ConnectorError); expect((e as ConnectorError).code).toBe("REAUTH_REQUIRED"); expect((e as Error).message).not.toMatch(/Invalid code/); }
    expect(() => parseToken({ object: "error", status: 400, code: "invalid_request", message: "bad" }, now)).toThrow(ConnectorError);
    expect(() => parseToken({ token_type: "bearer" }, now)).toThrow(/missing/);
  });

  it("identifies a workspace connection by its Notion workspace, a personal one by the workspace and the person", async () => {
    const tokens = parseToken(fixture("notion/token.ok.json"), new Date());
    const http = testHttp(conn("workspace"));
    mock = mockProviders({});
    expect(await adapter.identify({ kind: "workspace", http, tokens, pending: {} })).toEqual({ externalAccountId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e", externalTenantId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e", accountLabel: "Acme" });
    const p = await adapter.identify({ kind: "personal", http, tokens, pending: {} });
    expect(p).toEqual({
      externalAccountId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e:f0e1d2c3-b4a5-4968-8776-655443322110", externalTenantId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e",
      accountLabel: "Ada Obi in Acme", identity: { externalUserId: "f0e1d2c3-b4a5-4968-8776-655443322110", email: null },
    });
    expect(mock.calls).toHaveLength(0);
    await expect(adapter.identify({ kind: "workspace", http, tokens: fakeTokens({ facts: {} }), pending: {} })).rejects.toThrow(ConnectorError);
    await expect(adapter.identify({ kind: "personal", http, tokens: fakeTokens({ facts: { workspaceId: "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e" } }), pending: {} })).rejects.toThrow(ConnectorError);
  });

  it("revokes with the client's Basic credentials, the access token and Notion-Version", async () => {
    mock = mockProviders({ [`POST ${API}/oauth/revoke`]: { json: fixture("notion/revoke.ok.json") } });
    await adapter.revoke!({ conn: conn("personal"), http: testHttp(conn("personal")), tokens: fakeTokens() });
    const c = mock.calls[0];
    expect(c.headers.get("authorization")).toBe(`Basic ${Buffer.from("test-notion-client-id:test-notion-client-secret").toString("base64")}`);
    expect(JSON.parse(c.body!)).toEqual({ token: "test-access-token-0000" });
    expect(c.headers.get("notion-version")).toBe(NOTION_VERSION);
  });
});

// ---- Errors -----------------------------------------------------------------------------------------------------------------

describe("Notion errors", () => {
  const res = (status: number, path: string) => ({ status, headers: new Headers(), body: fixture(path) });

  it("maps Notion's error codes to fixed codes, never keeping the message", () => {
    const rl = interpret(res(429, "notion/error.rate_limited.json"));
    expect(rl?.code).toBe("RATE_LIMITED");
    expect(rl?.retryAfterSeconds).toBe(30);
    expect(interpret(res(529, "notion/error.overload.json"))?.code).toBe("RATE_LIMITED");
    expect(interpret(res(404, "notion/error.not_found.json"))?.code).toBe("NOT_FOUND");
    expect(interpret(res(403, "notion/error.restricted.json"))?.code).toBe("FORBIDDEN");
    expect(interpret(res(400, "notion/error.validation.json"))?.code).toBe("NOT_ALLOWED");
    expect(interpret({ status: 400, headers: new Headers(), body: { object: "error", code: "missing_version" } })?.code).toBe("BAD_RESPONSE");
    expect(interpret({ status: 429, headers: new Headers(), body: { object: "error", code: "rate_limited", additional_data: { rate_limit_reason: "public_api_request_blocked" } } })?.code).toBe("FORBIDDEN");
    expect(interpret({ status: 200, headers: new Headers(), body: { object: "list" } })).toBeNull();
    for (const p of ["error.rate_limited", "error.not_found", "error.validation", "error.restricted"]) expect(interpret(res(400, `notion/${p}.json`))?.message ?? "").not.toMatch(/Could not find|rate limited\. Please|failed validation|Insufficient/);
  });

  it("a 429 backs the connection off for Notion's Retry-After", async () => {
    const backoffs: number[] = [];
    mock = mockProviders({ [`GET ${API}/pages/${ID.leave}/markdown`]: { status: 429, json: fixture("notion/error.rate_limited.json"), headers: { "retry-after": "30" } } });
    await expect(adapter.fetchText!({ conn: conn("personal"), http: testHttp(conn("personal"), { backoffs }), kind: "page", externalId: ID.leave, maxChars: 100 })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect(backoffs).toEqual([30]);
  });

  it("a 401 refreshes once and tries again", async () => {
    const refreshes: boolean[] = [];
    let n = 0;
    mock = mockProviders({ [`GET ${API}/pages/${ID.leave}/markdown`]: () => (++n === 1 ? { status: 401, json: { object: "error", status: 401, code: "unauthorized", message: "API token is invalid." } } : md("notion/page.markdown.short.json")) });
    expect(await adapter.fetchText!({ conn: conn("personal"), http: testHttp(conn("personal"), { refreshes }), kind: "page", externalId: ID.leave, maxChars: 100 })).toBe("# Policies\n\nHow we work at Acme.");
    expect(refreshes).toEqual([true]);
    expect(mock.calls[1].headers.get("authorization")).toBe("Bearer test-access-token-0001");
  });
});

// ---- Sources -----------------------------------------------------------------------------------------------------------------

describe("Notion sources", () => {
  it("lists the top of what was shared: pages and data sources whose parent Boredroom can't open", async () => {
    mock = mockProviders({
      [`POST ${API}/search`]: { json: fixture("notion/search.sources.json") },
      [`GET ${API}/blocks/${ID.column}`]: { json: fixture("notion/block.column.json") },
    });
    const list = await adapter.sources!({ conn: conn("workspace"), http: testHttp(conn("workspace")) });
    expect(list).toEqual([
      { kind: "page", externalId: ID.roadmap, label: "Roadmap (database)", members: null },
      { kind: "page", externalId: ID.policies, label: "Policies", members: null },
      { kind: "page", externalId: ID.specs, label: "Specs", members: null },
    ]);
    const body = JSON.parse(mock.calls[0].body!);
    expect(body).toEqual({ sort: { timestamp: "last_edited_time", direction: "descending" }, page_size: 100 });
    expect(allHaveVersion(mock)).toBe(true);
  });

  it("reads at most 10 pages of 100", async () => {
    mock = mockProviders({ [`POST ${API}/search`]: { json: { ...fixture<Record<string, unknown>>("notion/search.empty.json"), has_more: true, next_cursor: NEXT } } });
    await adapter.sources!({ conn: conn("workspace"), http: testHttp(conn("workspace")) });
    expect(mock.calls).toHaveLength(10);
  });
});

// ---- Sync ------------------------------------------------------------------------------------------------------------------

describe("Notion sync", () => {
  it("one stream, pages, hourly, bounded", () => {
    expect(adapter.streams).toHaveLength(1);
    expect(adapter.streams[0]).toMatchObject({ name: "pages", kinds: ["page"], every: { workingMinutes: 60, offMinutes: 60 }, perRun: { pages: 10, items: 50, ms: 15_000 } });
    expect(adapter.limits?.spacingMs).toBe(350);
    expect(adapter.linkHosts).toEqual(["www.notion.so", "notion.so"]);
  });

  it("a full workspace run: reconciles ids, keeps only pages under chosen roots, fetches their markdown", async () => {
    mock = mockProviders({
      [`POST ${API}/search`]: searchRoute(),
      ...markdownRoutes(),
      [`GET ${API}/pages/${ID.teamspace}`]: { status: 404, json: fixture("notion/error.not_found.json") },
      [`GET ${API}/blocks/${ID.column}`]: { json: fixture("notion/block.column.json") },
    });
    const c = conn("workspace");
    const { r, sink } = recordingSink();
    const out = await adapter.sync!(syncInput(c, sink, { full: true, selected: selected([[ID.policies, "Policies"], [ID.roadmap, "Roadmap (database)"]]) }));
    expect(r.reconciled).toEqual([ID.login, ID.leave, ID.row, ID.expenses, ID.policies, ID.specs]);
    expect(r.upserts.map((i) => [i.externalId, i.sourceExternalId, i.containerLabel, i.subtype])).toEqual([
      [ID.leave, ID.policies, "Policies", "page"],
      [ID.row, ID.roadmap, "Roadmap (database)", "row"],
      [ID.expenses, ID.policies, "Policies", "page"],
      [ID.policies, ID.policies, "Policies", "page"],
    ]);
    expect(r.gone.sort()).toEqual([ID.login, ID.trashed, ID.specs].sort());
    const leave = r.upserts[0];
    expect(leave).toMatchObject({ kind: "page", title: "Leave policy", providerUpdatedAt: "2026-10-21T16:00:00.000Z", mine: false, url: `https://www.notion.so/Leave-policy-${ID.leave.replace(/-/g, "")}` });
    expect(leave.excerpt).toContain("Everyone gets 25 days of annual leave.");
    expect(leave.excerpt).toContain("[image: Calendar]");
    expect(leave.excerpt).toContain("[…]");
    expect(leave.excerpt).not.toMatch(/X-Amz|amazonaws|<unknown/);
    expect(r.upserts.find((i) => i.externalId === ID.row)?.title).toBe("Q4 launch");
    // Markdown only for pages kept; never for the trashed page or pages outside the chosen roots.
    const mdCalls = mock.calls.filter((x) => x.url.endsWith("/markdown")).map((x) => x.url);
    expect(mdCalls).toHaveLength(4);
    expect(mdCalls.some((u) => u.includes(ID.login) || u.includes(ID.trashed) || u.includes(ID.specs))).toBe(false);
    const cur = readCursor(out.cursor);
    expect(out.more).toBe(false);
    expect(cur).toMatchObject({ since: "2026-10-22T07:58:00.000Z", after: null, skip: 0, n: 0, rec: "2026-10-22T09:00:00.000Z" });
    expect(out.cursor!.length).toBeLessThanOrEqual(4000);
    expect(allHaveVersion(mock)).toBe(true);
    expect(mock.calls.every((x) => x.headers.get("authorization") === "Bearer test-access-token-0000")).toBe(true);
    const search = JSON.parse(mock.calls[0].body!);
    expect(search).toEqual({ sort: { timestamp: "last_edited_time", direction: "descending" }, page_size: 100, filter: { property: "object", value: "page" } });
    expect(new URL(mock.calls[0].url).searchParams.get("filter_properties")).toBe("title");
  });

  it("an incremental personal run stops at the watermark and fetches only what changed", async () => {
    mock = mockProviders({ [`POST ${API}/search`]: searchRoute(), ...markdownRoutes() });
    const c = conn("personal");
    const { r, sink } = recordingSink();
    const cursor = JSON.stringify({ v: 1, since: "2026-10-21T12:00:00.000Z", top: null, after: null, skip: 0, n: 0, rec: "2026-10-20T09:00:00.000Z" });
    const out = await adapter.sync!(syncInput(c, sink, { cursor }));
    expect(r.reconciled).toBeNull();
    expect(r.upserts.map((i) => i.externalId)).toEqual([ID.login, ID.leave]);
    expect(r.upserts.every((i) => i.sourceExternalId === null)).toBe(true);
    // A page past the 20,000-character excerpt is kept at exactly 20,000 (read_app_item asks Notion for later parts).
    expect(r.upserts[0].excerpt).toHaveLength(20_000);
    expect(mock.calls.filter((x) => x.url.includes("/search"))).toHaveLength(1);
    expect(readCursor(out.cursor).since).toBe("2026-10-22T07:58:00.000Z");
    expect(out.more).toBe(false);
  });

  it("a weekly ids-only reconciliation runs when the last one is over 7 days old", async () => {
    mock = mockProviders({ [`POST ${API}/search`]: searchRoute(), ...markdownRoutes() });
    const { r, sink } = recordingSink();
    const cursor = JSON.stringify({ v: 1, since: "2026-10-22T08:30:00.000Z", top: null, after: null, skip: 0, n: 0, rec: "2026-10-14T09:00:00.000Z" });
    const out = await adapter.sync!(syncInput(conn("personal"), sink, { cursor }));
    expect(r.reconciled).toHaveLength(6);
    expect(r.upserts).toHaveLength(0);
    expect(mock.calls.filter((x) => x.url.endsWith("/markdown"))).toHaveLength(0);
    expect(readCursor(out.cursor).rec).toBe("2026-10-22T09:00:00.000Z");
    // Nothing newer than the watermark: it stays where it was.
    expect(readCursor(out.cursor).since).toBe("2026-10-22T08:30:00.000Z");
  });

  it("an incomplete listing never reconciles", async () => {
    mock = mockProviders({ [`POST ${API}/search`]: (req) => ((req.json() as { page_size: number }).page_size === 100 ? { json: { ...fixture<Record<string, unknown>>("notion/search.empty.json"), has_more: true, next_cursor: NEXT } } : { json: fixture("notion/search.empty.json") }) });
    const { r, sink } = recordingSink();
    await adapter.sync!(syncInput(conn("personal"), sink, { full: true }));
    expect(r.reconciled).toBeNull();
    expect(mock.calls.filter((x) => JSON.parse(x.body!).page_size === 100)).toHaveLength(10);
  });

  it("a run that runs out of time saves where it was, and the continuation carries on from there", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    mock = mockProviders({ [`POST ${API}/search`]: searchRoute(), ...markdownRoutes(() => { clock += 6000; }) });
    const c = conn("personal");
    const first = recordingSink();
    const recent = "2026-10-22T08:00:00.000Z";
    const out1 = await adapter.sync!(syncInput(c, first.sink, { cursor: JSON.stringify({ v: 1, since: null, top: null, after: null, skip: 0, n: 0, rec: recent }), deadline: clock + 15_000 }));
    expect(out1.more).toBe(true);
    expect(first.r.upserts.map((i) => i.externalId)).toEqual([ID.login, ID.leave]);
    expect(readCursor(out1.cursor)).toMatchObject({ since: null, top: "2026-10-22T08:00:00.000Z", after: null, skip: 2, n: 2, rec: recent });

    clock = 2_000_000;
    const second = recordingSink();
    const out2 = await adapter.sync!(syncInput(c, second.sink, { cursor: out1.cursor, deadline: clock + 60_000 }));
    expect(second.r.upserts.map((i) => i.externalId)).toEqual([ID.row, ID.expenses, ID.policies, ID.specs]);
    expect(second.r.gone).toEqual([ID.trashed]);
    expect(out2.more).toBe(false);
    expect(readCursor(out2.cursor)).toMatchObject({ since: "2026-10-22T07:58:00.000Z", after: null, skip: 0, n: 0 });
  });

  it("a start cursor Notion no longer accepts starts the pass again from the newest edit", async () => {
    mock = mockProviders({ [`POST ${API}/search`]: searchRoute({ stale: "stale-cursor" }), ...markdownRoutes() });
    const { r, sink } = recordingSink();
    const cursor = JSON.stringify({ v: 1, since: "2026-10-21T12:00:00.000Z", top: "2026-10-22T08:00:00.000Z", after: "stale-cursor", skip: 3, n: 40, rec: "2026-10-22T08:00:00.000Z" });
    const out = await adapter.sync!(syncInput(conn("personal"), sink, { cursor }));
    const bodies = mock.calls.filter((x) => x.url.includes("/search")).map((x) => JSON.parse(x.body!).start_cursor ?? null);
    expect(bodies).toEqual(["stale-cursor", null]);
    expect(r.upserts.map((i) => i.externalId)).toEqual([ID.login, ID.leave]);
    expect(out.more).toBe(false);
  });

  it("a partial search result (only object and id, as Notion documents) is read in full before it is judged", async () => {
    const one = fixture<{ results: Record<string, unknown>[] }>("notion/search.pages.1.json");
    const partial = { ...one, results: one.results.map((o) => (o.id === ID.leave ? { object: "page", id: ID.leave } : o)), has_more: false, next_cursor: null };
    mock = mockProviders({
      [`POST ${API}/search`]: { json: partial },
      [`GET ${API}/pages/${ID.leave}`]: { json: fixture("notion/page.leave.json") },
      [`GET ${API}/pages/${ID.specs}`]: { json: fixture<{ results: Record<string, unknown>[] }>("notion/search.pages.2.json").results.find((o) => o.id === ID.specs) },
      ...markdownRoutes(),
      [`GET ${API}/pages/${ID.teamspace}`]: { status: 404, json: fixture("notion/error.not_found.json") },
    });
    const { r, sink } = recordingSink();
    const cursor = JSON.stringify({ v: 1, since: "2026-10-21T12:00:00.000Z", top: null, after: null, skip: 0, n: 0, rec: "2026-10-22T08:00:00.000Z" });
    await adapter.sync!(syncInput(conn("workspace"), sink, { cursor, selected: selected([[ID.policies, "Policies"]]) }));
    expect(r.upserts.map((i) => [i.externalId, i.sourceExternalId, i.title])).toEqual([[ID.leave, ID.policies, "Leave policy"]]);
    expect(r.gone).toEqual([ID.login]);
  });

  it("a workspace with nothing chosen reads nothing", async () => {
    mock = mockProviders({});
    const { r, sink } = recordingSink();
    expect(await adapter.sync!(syncInput(conn("workspace"), sink, { full: true }))).toEqual({ cursor: null, more: false });
    expect(mock.calls).toHaveLength(0);
    expect(r.upserts).toHaveLength(0);
  });

  it("a bad cursor starts afresh", () => {
    expect(readCursor("not json")).toMatchObject({ since: null, after: null, rec: null });
    expect(readCursor(JSON.stringify({ v: 2 }))).toMatchObject({ since: null });
    expect(readCursor(JSON.stringify({ v: 1, since: "nonsense", skip: -1, n: "x" }))).toMatchObject({ since: null, skip: 0, n: 0 });
  });
});

// ---- One page, its text ------------------------------------------------------------------------------------------------------

describe("Notion pages one at a time", () => {
  it("fetchItem: a workspace page with its shared root", async () => {
    mock = mockProviders({
      [`GET ${API}/pages/${ID.leave}`]: { json: fixture("notion/page.leave.json") },
      [`GET ${API}/pages/${ID.policies}`]: { json: fixture("notion/page.policies.json") },
      [`GET ${API}/pages/${ID.leave}/markdown`]: md("notion/page.markdown.short.json"),
    });
    const item = await adapter.fetchItem!({ conn: conn("workspace"), http: testHttp(conn("workspace")), kind: "page", externalId: ID.leave.replace(/-/g, "") });
    expect(item).toMatchObject({ kind: "page", externalId: ID.leave, title: "Leave policy", sourceExternalId: ID.policies, containerLabel: "Policies", excerpt: "# Policies\n\nHow we work at Acme." });
    expect(allHaveVersion(mock)).toBe(true);
  });

  it("fetchItem: gone when trashed or not found; nothing for other kinds", async () => {
    mock = mockProviders({
      [`GET ${API}/pages/${ID.trashed}`]: { json: (fixture("notion/search.pages.2.json") as { results: unknown[] }).results[0] },
      [`GET ${API}/pages/${ID.specs}`]: { status: 404, json: fixture("notion/error.not_found.json") },
    });
    const http = testHttp(conn("personal"));
    expect(await adapter.fetchItem!({ conn: conn("personal"), http, kind: "page", externalId: ID.trashed })).toBeNull();
    expect(await adapter.fetchItem!({ conn: conn("personal"), http, kind: "page", externalId: ID.specs })).toBeNull();
    expect(await adapter.fetchItem!({ conn: conn("personal"), http, kind: "issue", externalId: ID.specs })).toBeNull();
  });

  it("fetchText: the page's markdown, cleaned and cut at maxChars", async () => {
    mock = mockProviders({ [`GET ${API}/pages/${ID.login}/markdown`]: md("notion/page.markdown.long.json") });
    const text = await adapter.fetchText!({ conn: conn("personal"), http: testHttp(conn("personal")), kind: "page", externalId: ID.login, maxChars: 6000 });
    expect(text).toHaveLength(6000);
    expect(text!.startsWith("# Login spec")).toBe(true);
    expect(allHaveVersion(mock)).toBe(true);
    await expect(adapter.fetchText!({ conn: conn("personal"), http: testHttp(conn("personal")), kind: "page", externalId: "../../users", maxChars: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---- Acting ------------------------------------------------------------------------------------------------------------------

const actor: Actor = { membershipId: "m0000000-0000-4000-8000-000000000001", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const stored = (over: Partial<StoredItem> = {}): StoredItem => ({
  id: "i0000000-0000-4000-8000-000000000001", externalId: ID.policies, externalKey: null, kind: "page", title: "Policies", url: null, state: null, containerLabel: "Policies",
  sourceExternalId: ID.policies, assigneeExternalId: null, startsAt: null, endsAt: null, guests: null, response: null, ...over,
});
const spec = (name: string) => adapter.actions.find((a) => a.name === name) as ActionSpec;
function act(name: string, kind: "workspace" | "personal", input: Record<string, unknown>, item: StoredItem | null = stored()): ActInput<Record<string, unknown>> {
  const c = conn(kind);
  const parsed = spec(name).input.parse(input) as Record<string, unknown>;
  return { conn: c, http: testHttp(c), actor, input: parsed, item, source: null, now: new Date("2026-10-22T09:00:00Z") };
}

describe("Notion actions", () => {
  it("offers exactly three changes, all through notion_action, workspace and personal", () => {
    expect(adapter.actions.map((a) => [a.name, a.tool, [...a.kinds]])).toEqual([
      ["create_page", "notion_action", ["workspace", "personal"]],
      ["append", "notion_action", ["workspace", "personal"]],
      ["page_comment", "notion_action", ["workspace", "personal"]],
    ]);
    expect(adapter.workspaceActs).toBe(true);
    expect(adapter.ownerBound).toBe(false);
    expect(adapter.actions.every((a) => !a.undo)).toBe(true);
  });

  it("create_page: shared, the exact readback, signed through the workspace", async () => {
    const p = await spec("create_page").prepare(act("create_page", "workspace", { title: "Parental leave", text: "Sixteen weeks, fully paid." }));
    expect(p).toEqual({
      risk: "shared", summary: "Add a Notion page under “Policies”", detail: "Sixteen weeks, fully paid.\n\nFrom Jo via Max",
      readback: { to: ["Everyone who can see “Policies” in Notion"], what: "A new page “Parental leave”, added by the Boredroom app, signed “Jo via Max”" },
      appearsAs: "by the Boredroom app, signed “Jo via Max”", place: "Policies",
    });
    const mine = await spec("create_page").prepare(act("create_page", "personal", { title: "Parental leave", text: "Sixteen weeks." }));
    expect(mine.detail).toBe("Sixteen weeks.");
    expect(mine.appearsAs).toBe("by the Boredroom integration in your Notion");
    expect(mine.readback.what).toBe("A new page “Parental leave”, added by the Boredroom integration in your Notion");
  });

  it("create_page: the exact request, and the new page takes its parent's source", async () => {
    mock = mockProviders({ [`POST ${API}/pages`]: { json: fixture("notion/page.created.json") } });
    const res = await spec("create_page").run(act("create_page", "workspace", { title: "Parental leave", text: "Sixteen weeks, fully paid.\n\n- From the first day\n[ ] Tell HR" }));
    const call = mock.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${API}/pages`);
    expect(call.headers.get("notion-version")).toBe(NOTION_VERSION);
    expect(JSON.parse(call.body!)).toEqual({
      parent: { page_id: ID.policies },
      properties: { title: { title: [{ type: "text", text: { content: "Parental leave" } }] } },
      children: [
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Sixteen weeks, fully paid." } }] } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ type: "text", text: { content: "From the first day" } }] } },
        { object: "block", type: "to_do", to_do: { rich_text: [{ type: "text", text: { content: "Tell HR" } }], checked: false } },
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "From Jo via Max" } }] } },
      ],
    });
    expect(res.summary).toBe("Added “Parental leave” under “Policies” in Notion");
    expect(res.href).toBe("https://www.notion.so/Parental-leave-ddddddd1dddd4ddd8ddddddddddddddd");
    expect(res.item).toMatchObject({ kind: "page", externalId: "ddddddd1-dddd-4ddd-8ddd-dddddddddddd", title: "Parental leave", sourceExternalId: ID.policies, containerLabel: "Policies" });
  });

  it("create_page through the workspace under a page with no source keeps no copy (the next sync decides who sees it)", async () => {
    mock = mockProviders({ [`POST ${API}/pages`]: { json: fixture("notion/page.created.json") } });
    const res = await spec("create_page").run(act("create_page", "workspace", { title: "Parental leave", text: "x" }, stored({ sourceExternalId: null })));
    expect(res.item).toBeNull();
  });

  it("append: the exact request, at the end of the page", async () => {
    mock = mockProviders({ [`PATCH ${API}/blocks/${ID.login}/children`]: { json: fixture("notion/blocks.appended.json") } });
    const input = act("append", "personal", { text: "Decision: keep 30 days." }, stored({ externalId: ID.login, title: "Login spec" }));
    const p = await spec("append").prepare(input);
    expect(p).toMatchObject({ risk: "shared", summary: "Add to “Login spec” in Notion", detail: "Decision: keep 30 days.", readback: { to: ["Everyone who can see “Login spec” in Notion"], what: "These lines at the end of the page, added by the Boredroom integration in your Notion" } });
    const res = await spec("append").run(input);
    expect(mock.calls[0].method).toBe("PATCH");
    expect(JSON.parse(mock.calls[0].body!)).toEqual({ children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Decision: keep 30 days." } }] } }], position: { type: "end" } });
    expect(res.summary).toBe("Added to “Login spec” in Notion");
  });

  it("page_comment: the exact request, signed through the workspace", async () => {
    mock = mockProviders({ [`POST ${API}/comments`]: { json: fixture("notion/comment.created.json") } });
    const input = act("page_comment", "workspace", { text: "Looks good." }, stored({ externalId: ID.login, title: "Login spec" }));
    const p = await spec("page_comment").prepare(input);
    expect(p).toMatchObject({ risk: "shared", summary: "Comment on “Login spec” in Notion", detail: "Looks good.\n\nFrom Jo via Max", readback: { to: ["Everyone who can see “Login spec” in Notion"], what: "Your comment, added by the Boredroom app, signed “Jo via Max”" } });
    await spec("page_comment").run(input);
    expect(JSON.parse(mock.calls[0].body!)).toEqual({ parent: { page_id: ID.login }, rich_text: [{ type: "text", text: { content: "Looks good.\n\nFrom Jo via Max" } }] });
    expect(mock.calls[0].headers.get("notion-version")).toBe(NOTION_VERSION);
  });

  it("refuses without a page, or on something that isn't a page", async () => {
    for (const name of ["create_page", "append", "page_comment"]) {
      const input = name === "create_page" ? { title: "T", text: "x" } : { text: "x" };
      await expect(spec(name).prepare(act(name, "workspace", input, null))).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(spec(name).prepare(act(name, "workspace", input, stored({ kind: "issue" })))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    }
  });

  it("validates lengths: text up to 6,000 characters, titles up to 200", () => {
    expect(spec("append").input.safeParse({ text: "x".repeat(6000) }).success).toBe(true);
    expect(spec("append").input.safeParse({ text: "x".repeat(6001) }).success).toBe(false);
    expect(spec("append").input.safeParse({ text: "   " }).success).toBe(false);
    expect(spec("create_page").input.safeParse({ title: "t".repeat(201), text: "x" }).success).toBe(false);
    expect(spec("create_page").input.safeParse({ text: "x" }).success).toBe(false);
  });

  it("a Notion refusal while acting is a fixed code", async () => {
    mock = mockProviders({ [`POST ${API}/comments`]: { status: 403, json: fixture("notion/error.restricted.json") } });
    await expect(spec("page_comment").run(act("page_comment", "personal", { text: "x" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---- Plain text to blocks, markdown to an excerpt ------------------------------------------------------------------------

describe("Notion blocks", () => {
  it("rich text items of at most 2,000 characters, never splitting a character", () => {
    const parts = richText("a".repeat(4500));
    expect(parts.map((p) => p.text.content.length)).toEqual([2000, 2000, 500]);
    const emoji = "😀".repeat(2001);
    const e = richText(emoji);
    expect(e).toHaveLength(2);
    expect(Array.from(e[0].text.content)).toHaveLength(RICH_TEXT_MAX);
    expect(e.map((p) => p.text.content).join("")).toBe(emoji);
  });

  it("paragraphs, '- ' bullets and '[ ] ' to-dos", () => {
    expect(parseText("Line one\nline two\n\n- a\n* b\n[ ] c\n[x] d\n- [ ] e\n\nEnd")).toEqual([
      { kind: "paragraph", text: "Line one\nline two" },
      { kind: "bullet", text: "a" }, { kind: "bullet", text: "b" },
      { kind: "todo", text: "c", checked: false }, { kind: "todo", text: "d", checked: true }, { kind: "todo", text: "e", checked: false },
      { kind: "paragraph", text: "End" },
    ]);
  });

  it("at most 100 blocks, the rest folded into the last paragraph: nothing is lost", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `- item ${i + 1}`);
    const blocks = textToBlocks(lines.join("\n"), { signature: "From Jo via Max" });
    expect(blocks).toHaveLength(BLOCKS_MAX);
    expect(blocks.at(-1)).toEqual({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "From Jo via Max" } }] } });
    expect(blocks[98].type).toBe("paragraph");
    const text = blocksText(blocks);
    for (let i = 1; i <= 150; i++) expect(text).toContain(`item ${i}`);
    const long = textToBlocks("y".repeat(6000));
    expect(long).toHaveLength(1);
    expect(long[0].type === "paragraph" && long[0].paragraph.rich_text.map((r) => r.text.content.length)).toEqual([2000, 2000, 2000]);
  });

  it("markdown: placeholders and signed links out, at most 20,000 characters", () => {
    const out = cleanMarkdown("Intro\n\n<unknown url=\"https://www.notion.so/x\" alt=\"embed\"/>\n\n![](https://s3.example.com/f.png?X-Amz-Signature=abc)\n\n[file](https://prod-files-secure.s3.amazonaws.com/a?X-Amz-Credential=k)\n\n\n\nEnd");
    expect(out).toBe("Intro\n\n[…]\n\n[image]\n\n[file]\n\nEnd");
    expect(cleanMarkdown("z".repeat(25_000))).toHaveLength(20_000);
  });

  it("Notion ids in one form", () => {
    expect(nid("22222222222242228222222222222222")).toBe(ID.leave);
    expect(nid(ID.leave.toUpperCase())).toBe(ID.leave);
  });
});

// ---- The card -------------------------------------------------------------------------------------------------------------

describe("Notion's provider entry", () => {
  it("matches the adapter: kinds, variables, redirect path; no secrets", () => {
    expect(entry).toMatchObject({ id: "notion", slug: "notion", label: "Notion", category: "knowledge", kinds: ["workspace", "personal"] });
    expect(entry.setup.env).toEqual([...adapter.env]);
    expect(entry.setup.redirectPath).toBe("/api/connectors/notion/callback");
    expect(entry.setup.webhookPath).toBeUndefined();
    expect(JSON.stringify(entry)).not.toMatch(/test-notion|secret_|ntn_/);
    expect(entry.workspace?.does).toHaveLength(3);
    expect(entry.personal?.actLabel).toContain("{name}");
  });
});
