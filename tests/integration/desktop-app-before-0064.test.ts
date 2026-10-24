/**
 * Boredroom for Mac's one sign-in before migration 0064 (owner request, 24 October 2026: option A; spec §12.2, §13): the
 * website deploys first, so on a database without 0064 logout and unlinking still work (their old single-row
 * statements), the new desktop routes answer 503 DESKTOP_APP_NOT_READY, /desktop/app still answers (it needs no table),
 * and a connector start with `browser: true` answers 503 while one without works as before. Then 0064 applies twice
 * (idempotent), the routes come alive, and its order guard refuses without 0027.
 *
 * Local throwaway database only (TEST_DATABASE_URL).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const rq = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (rq.cookies.has(name) ? { name, value: rq.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(rq.headers),
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { withSystem } from "@/server/db";
import { buildCompany, contextFor, type CompanyFixture } from "@/server/services/fixtures";
import { issueSessionRow } from "@/server/auth";
import { randomToken } from "@/server/lib/crypto";
import { forget0064, schema0064Missing } from "@/server/lib/schema-0064";
import { insertDesktopSession, pkceChallengeOf } from "@/server/services/desktop-app";
import { revokeDevice } from "@/server/services/desktop";
import { resetStartSpacingForTests } from "@/server/connectors/oauth";
import { POST as authStart } from "@/app/api/desktop/app/auth/start/route";
import { POST as authApprove } from "@/app/api/desktop/app/auth/approve/route";
import { POST as authToken } from "@/app/api/desktop/app/auth/token/route";
import { POST as handoffMint } from "@/app/api/desktop/app/handoff/route";
import { POST as handoffRedeem } from "@/app/api/desktop/app/handoff/redeem/route";
import { POST as desktopSignOutRoute } from "@/app/api/desktop/app/sign-out/route";
import { POST as continuePost } from "@/app/api/desktop/continue/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as connectorStart } from "@/app/api/orgs/[org]/connectors/[provider]/start/route";
import { GET as entryGet } from "@/app/desktop/app/route";
import { GET as startGet } from "@/app/desktop/app/start/route";

const ORIGIN = "http://localhost:3000";
const SAME = { origin: ORIGIN, "sec-fetch-site": "same-origin" };
const sql = () => readFileSync(join(process.cwd(), "db", "migrations", "0064_desktop_app.sql"), "utf8");
let a: CompanyFixture;
let n = 0;
const savedFake = process.env.CONNECTORS_FAKE;

async function call(handler: (req: Request, ctx: { params: Promise<never> }) => Promise<Response>, c: { path: string; method?: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string>; params?: Record<string, string> }) {
  const headers: Record<string, string> = { "x-forwarded-for": `198.19.0.${++n % 250}`, ...(c.body !== undefined ? { "content-type": "application/json" } : {}), ...(c.headers ?? {}) };
  rq.headers = headers;
  rq.cookies = new Map(Object.entries(c.cookies ?? {}));
  return handler(new Request(`${ORIGIN}${c.path}`, { method: c.method ?? "POST", headers, body: c.body !== undefined ? JSON.stringify(c.body) : undefined }), { params: Promise.resolve(c.params ?? {}) as Promise<never> });
}
const code = async (r: Response) => ((await r.json()) as { code?: string }).code;
const revoked = async (id: string) => (await adminQuery<{ r: boolean }>(`SELECT revoked_at IS NOT NULL AS r FROM auth_sessions WHERE id = $1`, [id]))[0].r;
const web = (userId: string) => withSystem((db) => issueSessionRow(db, userId, { method: "password" }));
const desktop = (userId: string) => withSystem((db) => insertDesktopSession(db, { userId }));

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  // The reset applies every migration, 0064 included: take it out again to test the app without it.
  await adminQuery(`DROP TABLE IF EXISTS desktop_browser_tickets, desktop_handoff_codes, desktop_auth_requests CASCADE;
    DROP TRIGGER IF EXISTS auth_sessions_desktop_parent ON auth_sessions; DROP FUNCTION IF EXISTS app_auth_sessions_desktop_parent();
    ALTER TABLE auth_sessions DROP COLUMN IF EXISTS desktop_session_id CASCADE;`);
  forget0064();
  a = await buildCompany("a");
});
afterAll(() => { forget0064(); if (savedFake === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = savedFake; });

describe("without 0064", () => {
  it("logout still works (the old single-row statement)", async () => {
    const s = await web(a.employee.authUserId);
    const other = await web(a.employee.authUserId);
    const r = await call(logout, { path: "/api/auth/logout", body: {}, headers: SAME, cookies: { boredroom_session: s.token } });
    expect(r.status).toBe(200);
    expect(await revoked(s.id)).toBe(true);
    expect(await revoked(other.id)).toBe(false);
    expect(schema0064Missing()).toBe(true); // noted, without a probing query
  });

  it("unlinking a Mac still works", async () => {
    const d = await desktop(a.manager.authUserId);
    await revokeDevice((await contextFor(a.manager, "company-a")).user, d.id);
    expect(await revoked(d.id)).toBe(true);
  });

  it("the new routes answer 503 DESKTOP_APP_NOT_READY; the app's sign-out still signs the Mac out", async () => {
    const v = randomToken(32);
    const start = await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: pkceChallengeOf(v), state: randomToken(16), via: "window" } });
    expect(start.status).toBe(503);
    expect(await code(start)).toBe("DESKTOP_APP_NOT_READY");
    expect((await call(authToken, { path: "/api/desktop/app/auth/token", body: { code: randomToken(32), verifier: v } })).status).toBe(503);
    const s = await web(a.employee.authUserId);
    expect((await call(authApprove, { path: "/api/desktop/app/auth/approve", body: {}, headers: SAME, cookies: { boredroom_session: s.token, boredroom_desktop_auth: "x.y" } })).status).toBe(503);
    const d = await desktop(a.employee.authUserId);
    expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, headers: { authorization: `Bearer ${d.token}` } })).status).toBe(503);
    expect((await call(handoffRedeem, { path: "/api/desktop/app/handoff/redeem", body: { code: randomToken(32) }, headers: SAME })).status).toBe(503);
    expect((await call(continuePost, { path: "/api/desktop/continue", body: { t: randomToken(32) }, headers: SAME })).status).toBe(503);
    const out = await call(desktopSignOutRoute, { path: "/api/desktop/app/sign-out", body: {}, headers: { authorization: `Bearer ${d.token}` } });
    expect(out.status).toBe(200);
    expect(await revoked(d.id)).toBe(true);
    expect((await call((req) => startGet(req), { path: `/desktop/app/start?t=${randomToken(32)}`, method: "GET" })).status).toBe(503);
  });

  it("/desktop/app still answers (it needs no table)", async () => {
    const r = await call((req) => entryGet(req), { path: "/desktop/app?next=%2Fapp", method: "GET" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("__boredroomHandoff");
  });

  it("a connector start with browser: true answers 503; without it, as before", async () => {
    const s = await web(a.employee.authUserId);
    const go = (browser: boolean) => {
      resetStartSpacingForTests();
      return call(connectorStart, { path: "/api/orgs/company-a/connectors/fake/start", body: { kind: "personal", act: false, ...(browser ? { browser } : {}) }, headers: SAME, cookies: { boredroom_session: s.token }, params: { org: "company-a", provider: "fake" } });
    };
    expect((await go(true)).status).toBe(503);
    const plain = await go(false);
    expect(plain.status).toBe(200);
    expect(plain.headers.getSetCookie().some((c) => c.startsWith("boredroom_connector="))).toBe(true);
  });
});

describe("applying 0064", () => {
  it("twice (idempotent), and the routes come alive", async () => {
    await adminQuery(sql());
    await adminQuery(sql());
    forget0064();
    const ok = await adminQuery<{ ok: boolean }>(`SELECT to_regclass('public.desktop_auth_requests') IS NOT NULL AND to_regclass('public.desktop_handoff_codes') IS NOT NULL
      AND to_regclass('public.desktop_browser_tickets') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'auth_sessions'::regclass AND attname = 'desktop_session_id') AS ok`);
    expect(ok[0].ok).toBe(true);
    const v = randomToken(32);
    expect((await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: pkceChallengeOf(v), state: randomToken(16), via: "window" } })).status).toBe(200);
    // Row security: a person's own context sees nothing in the three tables; the app role can't read them outside it.
    const rows = await adminQuery<{ relname: string; relrowsecurity: boolean }>(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('desktop_auth_requests', 'desktop_handoff_codes', 'desktop_browser_tickets')`);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const seen = await (await import("../helpers/db")).appQueryAs(a.employee.profileId, `SELECT count(*)::int AS n FROM desktop_auth_requests`);
    expect(seen[0].n).toBe(0);
  });

  it("refuses without 0027 (MIGRATION_ORDER), changing nothing", async () => {
    await adminQuery(`ALTER TABLE desktop_link_codes RENAME TO desktop_link_codes_away`);
    try { await expect(adminQuery(sql())).rejects.toThrow(/MIGRATION_ORDER/); }
    finally { await adminQuery(`ALTER TABLE desktop_link_codes_away RENAME TO desktop_link_codes`); }
  });
});
