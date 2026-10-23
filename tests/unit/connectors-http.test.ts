/**
 * Connected apps: the HTTP client every provider call goes through (owner decisions, 22 October 2026: connectors; spec
 * §4.2, §15, §16.2). No database: the token, refresh and backoff are injected; the network is mockProviders.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConnectorError, type ConnectionRef, type ProviderAdapter } from "@/server/connectors/types";
import { httpFor, hostAllowed, retryAfterSeconds, rawRequest, type HttpDeps } from "@/server/connectors/http";
import { mockProviders, fixture, type ProviderMock } from "@/server/connectors/testing";
import { stubAdapter } from "@/server/connectors/registry";

const TOKEN = "secret-access-token-abc123";
const NEW_TOKEN = "secret-access-token-def456";
const conn: ConnectionRef = {
  id: "11111111-1111-1111-1111-111111111111", organisationId: "22222222-2222-2222-2222-222222222222", provider: "fake", kind: "personal",
  membershipId: "33333333-3333-3333-3333-333333333333", connectedBy: "33333333-3333-3333-3333-333333333333", externalAccountId: "u1",
  externalTenantId: null, accountLabel: null, scopes: [], settings: {}, canRead: true, canAct: false,
};
const adapter: ProviderAdapter = {
  ...stubAdapter("fake"), hosts: ["api.example.com"],
  interpret: (res) => {
    const b = res.body as { ok?: boolean; error?: string } | null;
    if (b && b.ok === false && b.error === "ratelimited") return new ConnectorError("RATE_LIMITED", "slow down", 30);
    if (b && b.ok === false && b.error === "invalid_auth") return new ConnectorError("REAUTH_REQUIRED", "auth");
    if (b && b.ok === false) return new ConnectorError("NOT_ALLOWED", `provider said ${b.error} with ${TOKEN}`);
    return null;
  },
};

function deps(o: { expiresAt?: Date | null; refreshFails?: boolean } = {}) {
  const calls = { refresh: 0, backoff: [] as number[] };
  let current = TOKEN;
  const d: HttpDeps = {
    token: async () => ({ accessToken: current, expiresAt: o.expiresAt ?? null }),
    refresh: async () => {
      calls.refresh++;
      if (o.refreshFails) throw new ConnectorError("REAUTH_REQUIRED", "refused");
      current = NEW_TOKEN;
      return current;
    },
    backoff: async (s) => { calls.backoff.push(s); },
  };
  return { d, calls };
}

let mock: ProviderMock;
beforeAll(() => { mock = mockProviders({}); });
afterAll(() => mock.restore());

describe("the guard", () => {
  it("https and the adapter's own hosts only", async () => {
    expect(hostAllowed("https://api.example.com/x", ["api.example.com"])).toBe(true);
    expect(hostAllowed("http://api.example.com/x", ["api.example.com"])).toBe(false);
    expect(hostAllowed("https://evil.example.com/x", ["api.example.com"])).toBe(false);
    expect(hostAllowed("https://api.example.com.evil.io/x", ["api.example.com"])).toBe(false);
    expect(hostAllowed("https://user:pw@api.example.com/x", ["api.example.com"])).toBe(false);
    expect(hostAllowed("https://acme.atlassian.net/browse/X-1", ["*.atlassian.net"])).toBe(true);
    expect(hostAllowed("https://atlassian.net/browse/X-1", ["*.atlassian.net"])).toBe(false);
    const { d } = deps();
    await expect(httpFor(conn, adapter, d).request({ url: "https://evil.example.com/steal" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(httpFor(conn, adapter, d).request({ url: "http://api.example.com/x" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("an unmocked call throws, naming only the method, host and path", async () => {
    mock.restore();
    await expect(rawRequest(["api.example.com"], { url: "https://api.example.com/nothing?token=x" })).rejects.toThrow("unmocked provider call: GET api.example.com/nothing");
    mock = mockProviders({});
  });

  it("follows a redirect only to another allowed host", async () => {
    mock.set("GET https://api.example.com/moved", { status: 302, headers: { location: "https://evil.example.com/x" } });
    const { d } = deps();
    await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/moved" })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    mock.set("GET https://api.example.com/moved2", { status: 302, headers: { location: "/here" } });
    mock.set("GET https://api.example.com/here", { json: { ok: true } });
    expect((await httpFor(conn, adapter, d).request({ url: "https://api.example.com/moved2" })).body).toEqual({ ok: true });
  });
});

describe("tokens", () => {
  it("injects the bearer token", async () => {
    mock.set("GET https://api.example.com/me", (req) => ({ json: { auth: req.headers.get("authorization") } }));
    const { d } = deps();
    const r = await httpFor(conn, adapter, d).request<{ auth: string }>({ url: "https://api.example.com/me" });
    expect(r.body.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("refreshes ahead of expiry (within 2 minutes)", async () => {
    mock.set("GET https://api.example.com/me", (req) => ({ json: { auth: req.headers.get("authorization") } }));
    const { d, calls } = deps({ expiresAt: new Date(Date.now() + 60_000) });
    const r = await httpFor(conn, adapter, d).request<{ auth: string }>({ url: "https://api.example.com/me" });
    expect(calls.refresh).toBe(1);
    expect(r.body.auth).toBe(`Bearer ${NEW_TOKEN}`);
  });

  it("a 401 refreshes once and retries; a second 401 is REAUTH_REQUIRED", async () => {
    mock.set("GET https://api.example.com/me", (req) => (req.headers.get("authorization") === `Bearer ${NEW_TOKEN}` ? { json: { ok: true } } : { status: 401, json: { error: "expired" } }));
    const a = deps();
    expect((await httpFor(conn, adapter, a.d).request({ url: "https://api.example.com/me" })).body).toEqual({ ok: true });
    expect(a.calls.refresh).toBe(1);
    mock.set("GET https://api.example.com/me", { status: 401, json: { error: "expired" } });
    const b = deps();
    await expect(httpFor(conn, adapter, b.d).request({ url: "https://api.example.com/me" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(b.calls.refresh).toBe(1);
  });

  it("an adapter's 'token expired' answer (interpret) refreshes too", async () => {
    let n = 0;
    mock.set("POST https://api.example.com/post", () => (++n === 1 ? { json: { ok: false, error: "invalid_auth" } } : { json: { ok: true } }));
    const { d, calls } = deps();
    expect((await httpFor(conn, adapter, d).request({ method: "POST", url: "https://api.example.com/post", json: {} })).body).toEqual({ ok: true });
    expect(calls.refresh).toBe(1);
  });

  it("no token stored: REAUTH_REQUIRED without a call", async () => {
    const d: HttpDeps = { token: async () => null, refresh: async () => "x", backoff: async () => undefined };
    await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/me" })).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });
});

describe("limits and failures", () => {
  it("429 with Retry-After: RATE_LIMITED and the backoff, capped at an hour", async () => {
    mock.set("GET https://api.example.com/busy", { status: 429, headers: { "retry-after": "120" }, json: {} });
    const { d, calls } = deps();
    const err = await httpFor(conn, adapter, d).request({ url: "https://api.example.com/busy" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).code).toBe("RATE_LIMITED");
    expect((err as ConnectorError).retryAfterSeconds).toBe(120);
    expect(calls.backoff).toEqual([120]);
    mock.set("GET https://api.example.com/busy", { status: 429, headers: { "retry-after": "999999" }, json: {} });
    const b = deps();
    await httpFor(conn, adapter, b.d).request({ url: "https://api.example.com/busy" }).catch(() => undefined);
    expect(b.calls.backoff).toEqual([3600]);
    expect(retryAfterSeconds(new Headers({ "retry-after": new Date(Date.now() + 30_000).toUTCString() }))).toBeGreaterThanOrEqual(29);
  });

  it("an adapter's own rate limit (HTTP 200 or 400 with a code) is RATE_LIMITED with its seconds", async () => {
    mock.set("GET https://api.example.com/gql", { status: 200, json: { ok: false, error: "ratelimited" } });
    const { d, calls } = deps();
    await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/gql" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls.backoff).toEqual([30]);
  });

  it("statuses map to fixed codes; 5xx is PROVIDER_DOWN", async () => {
    const { d } = deps();
    for (const [status, code] of [[403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [500, "PROVIDER_DOWN"], [503, "PROVIDER_DOWN"], [400, "BAD_RESPONSE"]] as const) {
      mock.set("GET https://api.example.com/s", { status, json: { message: `boom ${TOKEN}` } });
      await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/s" })).rejects.toMatchObject({ code });
    }
  });

  it("a network failure or a timeout is PROVIDER_DOWN", async () => {
    mock.set("GET https://api.example.com/slow", () => new Promise((_r, reject) => setTimeout(() => reject(new Error("aborted")), 20)));
    const { d } = deps();
    await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/slow", timeoutMs: 1000 })).rejects.toMatchObject({ code: "PROVIDER_DOWN" });
  });

  it("caps a response at 5 MB", async () => {
    mock.set("GET https://api.example.com/big", { text: "x".repeat(5 * 1024 * 1024 + 10) });
    const { d } = deps();
    await expect(httpFor(conn, adapter, d).request({ url: "https://api.example.com/big", expect: "text" })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("never puts a token or a body in a thrown message", async () => {
    mock.set("GET https://api.example.com/x", { status: 200, json: { ok: false, error: "nope" } });
    const { d } = deps();
    const err = await httpFor(conn, adapter, d).request({ url: "https://api.example.com/x?access_token=" + TOKEN }).catch((e: unknown) => e as Error);
    expect((err as ConnectorError).code).toBe("NOT_ALLOWED");
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(String((err as Error).stack)).not.toContain(TOKEN);
    mock.set("GET https://api.example.com/y", { status: 500, json: { secret: TOKEN } });
    const err2 = (await httpFor(conn, adapter, d).request({ url: "https://api.example.com/y" }).catch((e: unknown) => e)) as Error;
    expect(String(err2.message)).not.toContain(TOKEN);
  });

  it("a shared budget is spent before the call", async () => {
    mock.set("GET https://api.example.com/jira", { json: { ok: true } });
    const spent: [string, number, number][] = [];
    const { d } = deps();
    const withBudget: ProviderAdapter = { ...adapter, limits: { budget: { bucket: "jira:global", capPerHour: 50_000 } } };
    await httpFor(conn, withBudget, { ...d, spend: async (b, c, cap) => { spent.push([b, c, cap]); } }).request({ url: "https://api.example.com/jira", cost: 51 });
    expect(spent).toEqual([["jira:global", 51, 50_000]]);
    await expect(httpFor(conn, withBudget, { ...d, spend: async () => { throw new ConnectorError("RATE_LIMITED", "budget", 600); } }).request({ url: "https://api.example.com/jira" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("fixtures load without their _source", () => {
    const f = fixture<Record<string, unknown>>("fake/token.ok.json");
    expect(f._source).toBeUndefined();
    expect(f.access_token).toBeTruthy();
  });
});
