/**
 * Connected apps: test helpers (owner decisions, 22 October 2026: connectors; spec §16.1). Imported only by tests.
 * `mockProviders` installs a fetch that answers "METHOD https://host/path" routes (query ignored) and throws
 * `unmocked provider call: METHOD host/path` for anything else, so no test can reach a real provider. Fixtures are
 * hand-written from the providers' public API references (tests/fixtures/connectors/<provider>/*.json, each with a
 * "_source" naming the reference page); people in them are invented.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setConnectorFetchForTests } from "./http";
import type { TokenSet } from "./types";

export type MockRequest = { method: string; url: URL; headers: Headers; body: string | null; json(): unknown; form(): Record<string, string> };
export type MockReply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };
export type MockRoute = MockReply | ((req: MockRequest) => MockReply | Promise<MockReply>);

export type ProviderMock = {
  calls: { method: string; url: string; body: string | null; headers: Headers }[];
  /** Replace or add routes while installed. */
  set(key: string, route: MockRoute): void;
  restore(): void;
};

export function mockProviders(routes: Record<string, MockRoute>): ProviderMock {
  const table = new Map(Object.entries(routes));
  const calls: ProviderMock["calls"] = [];
  setConnectorFetchForTests(async (input, init) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : null;
    const headers = new Headers(init.headers);
    calls.push({ method, url: url.toString(), body, headers });
    const key = `${method} ${url.origin}${url.pathname}`;
    const route = table.get(key);
    if (!route) throw new Error(`unmocked provider call: ${method} ${url.host}${url.pathname}`);
    const req: MockRequest = {
      method, url, headers, body,
      json: () => (body ? JSON.parse(body) : null),
      form: () => Object.fromEntries(new URLSearchParams(body ?? "").entries()),
    };
    const r = typeof route === "function" ? await route(req) : route;
    const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
    return new Response(r.status === 204 ? null : text, { status: r.status ?? 200, headers: { "content-type": r.json !== undefined ? "application/json" : "text/plain", ...(r.headers ?? {}) } });
  });
  return {
    calls,
    set: (key, route) => { table.set(key, route); },
    restore: () => setConnectorFetchForTests(null),
  };
}

/** A fixture by its path under tests/fixtures/connectors (e.g. "slack/chat.postMessage.ok.json"), without its "_source". */
export function fixture<T = Record<string, unknown>>(path: string): T {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "connectors", path), "utf8")) as Record<string, unknown>;
  delete raw._source;
  return raw as T;
}

/** A token set for tests (never a real token). */
export function fakeTokens(over: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: "test-access-token-0000", refreshToken: "test-refresh-token-0000", tokenType: "bearer",
    expiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: null, scopes: null, ...over,
  };
}

// ---- Integration helpers (the throwaway database only) ---------------------------------------------------------------

/**
 * Applies 0061_connectors.sql with the caller's admin query (tests/helpers/db adminQuery) and forgets a noted "missing".
 * It moved to db/migrations, so the test reset has applied it already; applying it again is harmless (idempotent).
 */
export async function applyConnectorsMigration(adminQuery: (sql: string) => Promise<unknown>): Promise<void> {
  const { forget0061 } = await import("@/server/lib/schema-0061");
  await adminQuery(readFileSync(join(process.cwd(), "db", "migrations", "0061_connectors.sql"), "utf8"));
  forget0061();
}

/**
 * Connects the fake provider for `ctx` through the real flow (start, then the callback with the state and its cookie),
 * as the person themself. CONNECTORS_FAKE must be "1". Answers the connection id.
 */
export async function connectFake(ctx: import("@/server/lib/api").OrgContext, kind: "workspace" | "personal", o: { act?: boolean } = {}): Promise<string> {
  const { beginConnect, completeConnect, resetStartSpacingForTests } = await import("./oauth");
  resetStartSpacingForTests();
  const started = await beginConnect(ctx, "fake", { kind, act: o.act ?? true });
  const url = new URL(started.url);
  const r = await completeConnect({ provider: "fake", query: url.searchParams, cookieState: started.state, user: ctx.user });
  if (!r.ok || !r.connectionId) throw new Error(`connectFake: ${r.code ?? "failed"}`);
  return r.connectionId;
}
