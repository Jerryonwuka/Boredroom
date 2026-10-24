/**
 * Boredroom for Mac's one sign-in, end to end on the server (owner request, 24 October 2026: option A; spec §6, §7.1,
 * §12.2): the PKCE sign-in (start, the start link, approve, token), the handoff (mint with the app's Bearer, redeem for
 * the window's cookie), the sign-out cascades, the desktop-only gates, the browser bridge for connector consents, and
 * the window's route handlers. Each route handler is called with a `new Request`, `next/headers` mocked from the same
 * headers and cookies.
 *
 * Local throwaway database only (TEST_DATABASE_URL): 0064 waits in db/pending and is applied here by hand.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const rq = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (rq.cookies.has(name) ? { name, value: rq.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(rq.headers),
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { withSystem } from "@/server/db";
import { buildCompany, createVerifiedUser, contextFor, type CompanyFixture } from "@/server/services/fixtures";
import { createOrganisation } from "@/server/services/orgs";
import { issueSessionRow, resetPassword } from "@/server/auth";
import { randomToken, sha256, signPayload } from "@/server/lib/crypto";
import { forget0064 } from "@/server/lib/schema-0064";
import { pkceChallengeOf, requestCookieValue, userDigest, previewTicket, finishView } from "@/server/services/desktop-app";
import { revokeDevice } from "@/server/services/desktop";
import { isDesktopSession } from "@/server/services/screen-help";
import { orgContextForToken } from "@/server/lib/api";
import { completeConnect, resetStartSpacingForTests } from "@/server/connectors/oauth";
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
import { GET as readyGet } from "@/app/desktop/app/ready/route";
import { GET as startGet } from "@/app/desktop/app/start/route";

const ORIGIN = "http://localhost:3000";
const APP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 BoredroomDesktop/0.2.0";
const SAME = { origin: ORIGIN, "sec-fetch-site": "same-origin" };
let a: CompanyFixture;
let ip = 0;
const savedFake = process.env.CONNECTORS_FAKE;

type Call = { path: string; method?: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string | undefined>; params?: Record<string, string> };
/** One request: the same headers reach the handler's Request and next/headers; a fresh network address each time. */
async function call(handler: (req: Request, ctx: { params: Promise<never> }) => Promise<Response>, c: Call): Promise<Response> {
  const headers: Record<string, string> = { "x-forwarded-for": `198.18.${Math.floor(++ip / 250)}.${ip % 250}`, ...(c.body !== undefined ? { "content-type": "application/json" } : {}), ...(c.headers ?? {}) };
  rq.headers = headers;
  rq.cookies = new Map(Object.entries(c.cookies ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
  const req = new Request(`${ORIGIN}${c.path}`, { method: c.method ?? "POST", headers, body: c.body !== undefined ? JSON.stringify(c.body) : undefined });
  return handler(req, { params: Promise.resolve(c.params ?? {}) as Promise<never> });
}
const get = (handler: (req: Request) => Promise<Response>, c: Call) => call((req) => handler(req), { ...c, method: "GET" });
const json = async <T = Record<string, unknown>>(r: Response) => (await r.json()) as T;
/** The value of one Set-Cookie on a response, with its attributes. */
function setCookie(r: Response, name: string): string | null {
  return r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
}
const cookieValue = (c: string | null) => (c ? c.split(";")[0].split("=").slice(1).join("=") : null);

async function webSession(userId: string) {
  return withSystem((db) => issueSessionRow(db, userId, { method: "password" }));
}
function pkce() {
  const verifier = randomToken(32);
  return { verifier, challenge: pkceChallengeOf(verifier), state: randomToken(16) };
}
/** start → the start link (bound, cookie) → approve, with a signed-in web session. Answers what each step gave. */
async function signInFlow(o: { userId: string; via: "window" | "browser"; token?: string; orgSlug?: string }) {
  const p = pkce();
  const started = await json<{ startUrl: string }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: o.via, deviceName: "Test Mac" } }));
  const t = new URL(started.startUrl).searchParams.get("t")!;
  const web = o.token ? { token: o.token } : await webSession(o.userId);
  const bound = await get(startGet, { path: `/desktop/app/start?t=${t}`, cookies: { boredroom_session: web.token } });
  const reqCookie = cookieValue(setCookie(bound, "boredroom_desktop_auth"))!;
  const approved = await call(authApprove, { path: "/api/desktop/app/auth/approve", body: o.orgSlug ? { orgSlug: o.orgSlug } : {}, headers: SAME, cookies: { boredroom_session: web.token, boredroom_desktop_auth: reqCookie } });
  return { ...p, t, web, bound, reqCookie, approved };
}
async function redeemCode(redirect: string, verifier: string) {
  const code = new URL(redirect).searchParams.get("code")!;
  return call(authToken, { path: "/api/desktop/app/auth/token", body: { code, verifier } });
}
async function linkedMac(userId: string, via: "window" | "browser" = "browser") {
  const f = await signInFlow({ userId, via });
  const { redirect } = await json<{ redirect: string }>(f.approved);
  const tok = await json<{ token: string }>(await redeemCode(redirect, f.verifier));
  const id = (await adminQuery<{ id: string }>(`SELECT id FROM auth_sessions WHERE token_hash = $1`, [sha256(tok.token)]))[0].id;
  return { token: tok.token, id, web: f.web };
}
async function windowSession(desktopToken: string) {
  const minted = await json<{ code: string }>(await call(handoffMint, { path: "/api/desktop/app/handoff", body: { next: "/app/company-a/home" }, headers: { authorization: `Bearer ${desktopToken}` } }));
  const r = await call(handoffRedeem, { path: "/api/desktop/app/handoff/redeem", body: { code: minted.code }, headers: SAME });
  const token = cookieValue(setCookie(r, "boredroom_session"))!;
  const id = (await adminQuery<{ id: string }>(`SELECT id FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]))[0].id;
  return { token, id, res: r };
}
const revoked = async (id: string) => (await adminQuery<{ r: boolean }>(`SELECT revoked_at IS NOT NULL AS r FROM auth_sessions WHERE id = $1`, [id]))[0].r;

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  const sql = readFileSync(join(process.cwd(), "db", "migrations", "0064_desktop_app.sql"), "utf8");
  await adminQuery(sql);
  forget0064();
  a = await buildCompany("a");
});
afterAll(() => { forget0064(); if (savedFake === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = savedFake; });
beforeEach(async () => { await adminQuery(`DELETE FROM auth_rate_limits`); resetStartSpacingForTests(); });

describe("PKCE sign-in", () => {
  it("start: a bad challenge is refused; 30 an hour from one address, then 429", async () => {
    const p = pkce();
    const bad = await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: "short", state: p.state, via: "window" } });
    expect(bad.status).toBe(422);
    const plain = await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "sideways" } });
    expect(plain.status).toBe(422);
    const fixed = { "x-forwarded-for": "203.0.113.77" };
    for (let i = 0; i < 30; i++) expect((await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "window" }, headers: fixed })).status).toBe(200);
    expect((await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "window" }, headers: fixed })).status).toBe(429);
  });

  it("the start link: a prefetch never uses it; once only; then the sign-in page, Google, or finish", async () => {
    const p = pkce();
    const started = await json<{ startUrl: string; expiresIn: number }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "window" } }));
    expect(started.expiresIn).toBe(1800);
    expect(started.startUrl.startsWith(`${ORIGIN}/desktop/app/start?t=`)).toBe(true);
    const t = new URL(started.startUrl).searchParams.get("t")!;
    const stored = await adminQuery<{ start_hash: string }>(`SELECT start_hash FROM desktop_auth_requests WHERE state = $1`, [p.state]);
    expect(stored[0].start_hash).toBe(sha256(t)); // only the hash is kept
    const prefetch = await get(startGet, { path: `/desktop/app/start?t=${t}`, headers: { rsc: "1" } });
    expect(prefetch.status).toBe(200);
    const first = await get(startGet, { path: `/desktop/app/start?t=${t}` });
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fdesktop%2Fapp%2Ffinish`);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const c = setCookie(first, "boredroom_desktop_auth")!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=1800/);
    const again = await get(startGet, { path: `/desktop/app/start?t=${t}` });
    expect(again.headers.get("location")).toBe(`${ORIGIN}/desktop/app/expired`);
    expect(setCookie(again, "boredroom_desktop_auth")).toBeNull();
    // Google's request goes to Google; a signed-in browser straight to finish; an unknown link to expired.
    const g = pkce();
    const gs = await json<{ startUrl: string }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: g.challenge, state: g.state, via: "browser", intent: "google" } }));
    const gr = await get(startGet, { path: new URL(gs.startUrl).pathname + new URL(gs.startUrl).search });
    expect(gr.headers.get("location")).toBe(`${ORIGIN}/api/auth/google/start?next=%2Fdesktop%2Fapp%2Ffinish`);
    const w = await webSession(a.employee.authUserId);
    const s = pkce();
    const ss = await json<{ startUrl: string }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: s.challenge, state: s.state, via: "browser" } }));
    const sr = await get(startGet, { path: new URL(ss.startUrl).pathname + new URL(ss.startUrl).search, cookies: { boredroom_session: w.token } });
    expect(sr.headers.get("location")).toBe(`${ORIGIN}/desktop/app/finish`);
    expect((await get(startGet, { path: `/desktop/app/start?t=${randomToken(32)}` })).headers.get("location")).toBe(`${ORIGIN}/desktop/app/expired`);
    // Past its 10 minutes the link is spent even unused.
    const late = pkce();
    const ls = await json<{ startUrl: string }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: late.challenge, state: late.state, via: "window" } }));
    await adminQuery(`UPDATE desktop_auth_requests SET created_at = now() - interval '11 minutes' WHERE state = $1`, [late.state]);
    expect((await get(startGet, { path: new URL(ls.startUrl).pathname + new URL(ls.startUrl).search })).headers.get("location")).toBe(`${ORIGIN}/desktop/app/expired`);
  });

  it("approve: the session cookie only, strict origin, the request cookie, the person's own checks", async () => {
    const f = await signInFlow({ userId: a.manager.authUserId, via: "window" });
    expect(f.approved.status).toBe(200); // the happy path, then every refusal on a fresh request
    const fresh = async () => {
      const p = pkce();
      const s = await json<{ startUrl: string }>(await call(authStart, { path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "window" } }));
      const b = await get(startGet, { path: new URL(s.startUrl).pathname + new URL(s.startUrl).search });
      return cookieValue(setCookie(b, "boredroom_desktop_auth"))!;
    };
    const rc = await fresh();
    const w = await webSession(a.manager.authUserId);
    const approve = (o: { headers?: Record<string, string>; session?: string; cookie?: string; body?: unknown }) =>
      call(authApprove, { path: "/api/desktop/app/auth/approve", body: o.body ?? {}, headers: o.headers ?? SAME, cookies: { boredroom_session: o.session, boredroom_desktop_auth: o.cookie } });
    expect((await approve({ cookie: rc })).status).toBe(401);
    for (const h of <Record<string, string>[]>[{ origin: "https://evil.example", "sec-fetch-site": "cross-site" }, { origin: ORIGIN, "sec-fetch-site": "same-site" }, { origin: ORIGIN, "sec-fetch-site": "none" }, { "sec-fetch-site": "same-origin" }]) {
      const r = await approve({ headers: h, session: w.token, cookie: rc });
      expect(r.status).toBe(403);
      expect((await json(r)).code).toBe("BAD_ORIGIN");
    }
    // A Bearer may not approve: the header is ignored (no cookie, 401), and a desktop session in the cookie is refused.
    const mac = await linkedMac(a.hr.authUserId);
    expect((await call(authApprove, { path: "/api/desktop/app/auth/approve", body: {}, headers: { ...SAME, authorization: `Bearer ${mac.token}` }, cookies: { boredroom_desktop_auth: rc } })).status).toBe(401);
    expect((await approve({ session: mac.token, cookie: rc })).status).toBe(401);
    // No request cookie, or one for another purpose: 410.
    expect((await json(await approve({ session: w.token }))).code).toBe("REQUEST_EXPIRED");
    const id = (await adminQuery<{ id: string }>(`SELECT id FROM desktop_auth_requests ORDER BY created_at DESC LIMIT 1`))[0].id;
    expect((await approve({ session: w.token, cookie: signPayload({ p: "other", r: id }, 600) })).status).toBe(410);
    // Impersonated.
    const imp = (await adminQuery<{ id: string }>(`INSERT INTO admin_impersonations(admin_user_id, target_user_id, reason) VALUES ($1, $1, 'support') RETURNING id`, [a.manager.authUserId]))[0].id;
    const impSession = await webSession(a.manager.authUserId);
    await adminQuery(`UPDATE auth_sessions SET impersonation_id = $1 WHERE token_hash = $2`, [imp, sha256(impSession.token)]);
    expect((await json(await approve({ session: impSession.token, cookie: rc }))).code).toBe("IMPERSONATED");
    // Not confirmed.
    const unconfirmed = await createVerifiedUser("unconfirmed@a.test", "Not Yet");
    await adminQuery(`UPDATE auth_users SET email_verified_at = NULL WHERE id = $1`, [unconfirmed.authUserId]);
    const us = await webSession(unconfirmed.authUserId);
    expect((await json(await approve({ session: us.token, cookie: rc }))).code).toBe("EMAIL_NOT_VERIFIED");
    // No workspace.
    const lonely = await createVerifiedUser("lonely@a.test", "Lonely");
    expect((await json(await approve({ session: (await webSession(lonely.authUserId)).token, cookie: rc }))).code).toBe("NO_WORKSPACE");
    // An expired request: 410.
    const rc2 = await fresh();
    await adminQuery(`UPDATE desktop_auth_requests SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM desktop_auth_requests ORDER BY created_at DESC LIMIT 1)`);
    expect((await approve({ session: w.token, cookie: rc2 })).status).toBe(410);
  });

  it("one workspace is chosen by itself; two ask which, and only the person's own is accepted", async () => {
    const one = await signInFlow({ userId: a.employee.authUserId, via: "browser" });
    const ok = await json<{ redirect: string; via: string }>(one.approved);
    expect(ok.via).toBe("browser");
    const u = new URL(ok.redirect);
    expect(u.protocol).toBe("boredroom:");
    expect(u.host).toBe("auth");
    expect(u.searchParams.get("state")).toBe(one.state);
    expect(u.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie(one.approved, "boredroom_desktop_auth")).toMatch(/Max-Age=0/);
    const approvedRow = await adminQuery<{ code_hash: string }>(`SELECT code_hash FROM desktop_auth_requests WHERE state = $1`, [one.state]);
    expect(approvedRow[0].code_hash).toBe(sha256(u.searchParams.get("code")!));
    const audit = await adminQuery(`SELECT 1 FROM audit_events WHERE action = 'auth.desktop_app_approved' AND actor_user_id = $1`, [a.employee.authUserId]);
    expect(audit.length).toBeGreaterThan(0);

    await createOrganisation(a.employee2.profileId, { name: "Second Place", slug: "second-place", timezone: "Africa/Lagos", employeeCode: "SP-001" });
    const two = await signInFlow({ userId: a.employee2.authUserId, via: "browser" });
    expect(two.approved.status).toBe(409);
    const body = await json<{ code: string; details: { workspaces: { slug: string }[] } }>(two.approved);
    expect(body.code).toBe("CHOOSE_WORKSPACE");
    expect(body.details.workspaces.map((w) => w.slug).sort()).toEqual(["company-a", "second-place"]);
    const again = (slug: string) => call(authApprove, { path: "/api/desktop/app/auth/approve", body: { orgSlug: slug }, headers: SAME, cookies: { boredroom_session: two.web.token, boredroom_desktop_auth: two.reqCookie } });
    expect((await again("company-b")).status).toBe(404);
    const chosen = await again("second-place");
    expect(chosen.status).toBe(200);
    const tok = await json<{ workspace: { slug: string } }>(await redeemCode((await json<{ redirect: string }>(chosen)).redirect, two.verifier));
    expect(tok.workspace.slug).toBe("second-place");
  });

  it("token: single use, a wrong verifier burns the code, expiry, and the desktop session it makes", async () => {
    const f = await signInFlow({ userId: a.owner.authUserId, via: "window" });
    const { redirect } = await json<{ redirect: string }>(f.approved);
    const wrong = await redeemCode(redirect, randomToken(32));
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).code).toBe("CODE_INVALID");
    expect((await redeemCode(redirect, f.verifier)).status).toBe(400); // burnt

    const g = await signInFlow({ userId: a.owner.authUserId, via: "window" });
    const r2 = (await json<{ redirect: string }>(g.approved)).redirect;
    await adminQuery(`UPDATE desktop_auth_requests SET code_expires_at = now() - interval '1 second' WHERE state = $1`, [g.state]);
    expect((await redeemCode(r2, g.verifier)).status).toBe(400);

    const h = await signInFlow({ userId: a.owner.authUserId, via: "window" });
    const r3 = (await json<{ redirect: string }>(h.approved)).redirect;
    const ok = await redeemCode(r3, h.verifier);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await json<{ status: string; token: string; workspace: { slug: string; name: string }; displayName: string; userDigest: string }>(ok);
    expect(body).toMatchObject({ status: "approved", workspace: { slug: "company-a", name: "Company A" }, displayName: a.owner.displayName, userDigest: userDigest(a.owner.authUserId) });
    const row = await adminQuery<{ id: string; kind: string; days: number; device_name: string }>(
      `SELECT id, kind, round(extract(epoch FROM expires_at - now()) / 86400)::int AS days, device_name FROM auth_sessions WHERE token_hash = $1`, [sha256(body.token)]);
    expect(row[0]).toMatchObject({ kind: "desktop", days: 90, device_name: "Test Mac" });
    // A window request: the approving web session now belongs to this Mac.
    const web = await adminQuery<{ desktop_session_id: string | null }>(`SELECT desktop_session_id FROM auth_sessions WHERE token_hash = $1`, [sha256(h.web.token)]);
    expect(web[0].desktop_session_id).toBe(row[0].id);
    expect((await redeemCode(r3, h.verifier)).status).toBe(400); // single use
    const signIn = await adminQuery<{ metadata: { method: string; via: string } }>(`SELECT metadata FROM audit_events WHERE action = 'auth.sign_in' AND subject_id = $1`, [row[0].id]);
    expect(signIn[0].metadata).toMatchObject({ method: "desktop_app", via: "window" });
    // A browser request: the browser's session stays its own.
    const b = await signInFlow({ userId: a.owner.authUserId, via: "browser" });
    await redeemCode((await json<{ redirect: string }>(b.approved)).redirect, b.verifier);
    const bweb = await adminQuery<{ desktop_session_id: string | null }>(`SELECT desktop_session_id FROM auth_sessions WHERE token_hash = $1`, [sha256(b.web.token)]);
    expect(bweb[0].desktop_session_id).toBeNull();
  });

  it("token failures from one address are counted: after 20, 429", async () => {
    const fixed = { "x-forwarded-for": "203.0.113.90" };
    for (let i = 0; i < 20; i++) expect((await call(authToken, { path: "/api/desktop/app/auth/token", body: { code: randomToken(32), verifier: randomToken(32) }, headers: fixed })).status).toBe(400);
    expect((await call(authToken, { path: "/api/desktop/app/auth/token", body: { code: randomToken(32), verifier: randomToken(32) }, headers: fixed })).status).toBe(429);
  });
});

describe("handoff", () => {
  it("mint needs a desktop Bearer: a cookie, a web Bearer or a revoked desktop session get 401", async () => {
    const mac = await linkedMac(a.employee.authUserId);
    const w = await webSession(a.employee.authUserId);
    expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, cookies: { boredroom_session: mac.token } })).status).toBe(401);
    expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, headers: { authorization: `Bearer ${w.token}` } })).status).toBe(401);
    const ok = await call(handoffMint, { path: "/api/desktop/app/handoff", body: { next: "//evil.com" }, headers: { authorization: `Bearer ${mac.token}` } });
    expect(ok.status).toBe(200);
    const body = await json<{ code: string; expiresIn: number; userDigest: string }>(ok);
    expect(body.expiresIn).toBe(60);
    expect(body.userDigest).toBe(userDigest(a.employee.authUserId));
    const stored = await adminQuery<{ next: string; origin: string }>(`SELECT next, origin FROM desktop_handoff_codes WHERE code_hash = $1`, [sha256(body.code)]);
    expect(stored[0]).toEqual({ next: "/app", origin: ORIGIN });
    await adminQuery(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [mac.id]);
    expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, headers: { authorization: `Bearer ${mac.token}` } })).status).toBe(401);
  });

  it("mint: 60 an hour per Mac, then 429", async () => {
    const mac = await linkedMac(a.hr.authUserId);
    for (let i = 0; i < 60; i++) expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, headers: { authorization: `Bearer ${mac.token}` } })).status).toBe(200);
    expect((await call(handoffMint, { path: "/api/desktop/app/handoff", body: {}, headers: { authorization: `Bearer ${mac.token}` } })).status).toBe(429);
  });

  it("redeem: strict origin, JSON only, single use, 60 seconds, its origin, a live desktop session; the cookie", async () => {
    const mac = await linkedMac(a.manager.authUserId);
    await adminQuery(`UPDATE auth_sessions SET expires_at = now() + interval '1 day' WHERE id = $1`, [mac.id]);
    const mint = async () => (await json<{ code: string }>(await call(handoffMint, { path: "/api/desktop/app/handoff", body: { next: "/app/company-a/home" }, headers: { authorization: `Bearer ${mac.token}` } }))).code;
    const redeem = (code: string, headers: Record<string, string> = SAME) => call(handoffRedeem, { path: "/api/desktop/app/handoff/redeem", body: { code }, headers });
    const c1 = await mint();
    for (const h of <Record<string, string>[]>[{ origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "same-site" }, { origin: ORIGIN, "sec-fetch-site": "none" }, {}]) expect((await redeem(c1, h)).status).toBe(403);
    const form = await call(handoffRedeem, { path: "/api/desktop/app/handoff/redeem", headers: { ...SAME, "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(422);
    const ok = await redeem(c1);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ next: "/app/company-a/home" });
    const cookie = setCookie(ok, "boredroom_session")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i); // only in production
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)![1]);
    expect(maxAge).toBeGreaterThan(86_000);
    expect(maxAge).toBeLessThanOrEqual(86_400); // capped by the desktop session's end, not 14 days
    const s = await adminQuery<{ kind: string; desktop_session_id: string }>(`SELECT kind, desktop_session_id FROM auth_sessions WHERE token_hash = $1`, [sha256(cookieValue(cookie)!)]);
    expect(s[0]).toEqual({ kind: "web", desktop_session_id: mac.id });
    expect((await redeem(c1)).status).toBe(400); // single use
    const c2 = await mint();
    await adminQuery(`UPDATE desktop_handoff_codes SET expires_at = now() - interval '1 second' WHERE code_hash = $1`, [sha256(c2)]);
    expect((await redeem(c2)).status).toBe(400);
    const c3 = await mint();
    await adminQuery(`UPDATE desktop_handoff_codes SET origin = 'https://preview.example' WHERE code_hash = $1`, [sha256(c3)]);
    expect((await redeem(c3)).status).toBe(400);
    const c4 = await mint();
    await adminQuery(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [mac.id]);
    expect((await redeem(c4)).status).toBe(400);
    expect((await adminQuery(`SELECT 1 FROM desktop_handoff_codes WHERE code_hash = $1 AND used_at IS NOT NULL`, [sha256(c4)])).length).toBe(1); // spent
  });

  it("the parent trigger refuses tying a session to another person's desktop session", async () => {
    const mac = await linkedMac(a.hr.authUserId);
    const other = await webSession(a.employee.authUserId);
    await expect(adminQuery(`UPDATE auth_sessions SET desktop_session_id = $1 WHERE token_hash = $2`, [mac.id, sha256(other.token)])).rejects.toThrow(/DESKTOP_PARENT/);
    const desk2 = await linkedMac(a.employee.authUserId);
    await expect(adminQuery(`UPDATE auth_sessions SET desktop_session_id = $1 WHERE id = $2`, [mac.id, desk2.id])).rejects.toThrow(/auth_sessions_desktop_parent_check|DESKTOP_PARENT/);
  });
});

describe("cascades", () => {
  it("logout of a window session revokes its Mac and the Mac's other windows; a plain browser session is untouched", async () => {
    const mac = await linkedMac(a.owner.authUserId);
    const w1 = await windowSession(mac.token);
    const w2 = await windowSession(mac.token);
    const browser = await webSession(a.owner.authUserId);
    const r = await call(logout, { path: "/api/auth/logout", body: {}, headers: SAME, cookies: { boredroom_session: w1.token } });
    expect(r.status).toBe(200);
    expect(await revoked(w1.id)).toBe(true);
    expect(await revoked(mac.id)).toBe(true);
    expect(await revoked(w2.id)).toBe(true);
    expect(await revoked(browser.id)).toBe(false);
    // Logout of the unrelated browser session touches only itself.
    const mac2 = await linkedMac(a.owner.authUserId);
    const w3 = await windowSession(mac2.token);
    await call(logout, { path: "/api/auth/logout", body: {}, headers: SAME, cookies: { boredroom_session: browser.token } });
    expect(await revoked(browser.id)).toBe(true);
    expect(await revoked(mac2.id)).toBe(false);
    expect(await revoked(w3.id)).toBe(false);
  });

  it("unlinking a Mac in Settings revokes its windows; the app's own sign-out revokes the family", async () => {
    const mac = await linkedMac(a.manager.authUserId);
    const w = await windowSession(mac.token);
    const me = await contextFor(a.manager, "company-a");
    await revokeDevice(me.user, mac.id);
    expect(await revoked(mac.id)).toBe(true);
    expect(await revoked(w.id)).toBe(true);
    const mac2 = await linkedMac(a.manager.authUserId);
    const w2 = await windowSession(mac2.token);
    expect((await call(desktopSignOutRoute, { path: "/api/desktop/app/sign-out", body: {} })).status).toBe(401);
    expect((await call(desktopSignOutRoute, { path: "/api/desktop/app/sign-out", body: {}, headers: { authorization: `Bearer ${w2.token}` } })).status).toBe(401);
    const ok = await call(desktopSignOutRoute, { path: "/api/desktop/app/sign-out", body: {}, headers: { authorization: `Bearer ${mac2.token}` } });
    expect(await json(ok)).toEqual({ ok: true });
    expect(await revoked(mac2.id)).toBe(true);
    expect(await revoked(w2.id)).toBe(true);
  });

  it("a password reset still revokes everything, the Mac and its windows included", async () => {
    const u = await createVerifiedUser("reset-desk@a.test", "Reset Desk");
    const desk = await withSystem(async (db) => (await import("@/server/services/desktop-app")).insertDesktopSession(db, { userId: u.authUserId }));
    const w = await withSystem((db) => issueSessionRow(db, u.authUserId, { method: "desktop_handoff", desktopSessionId: desk.id }));
    const token = randomToken(32);
    await adminQuery(`INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, 'recover_password', $2, now() + interval '1 hour')`, [u.authUserId, sha256(token)]);
    await resetPassword(token, "a-whole-new-password");
    expect(await revoked(desk.id)).toBe(true);
    expect(await revoked(w.id)).toBe(true);
  });
});

describe("relinking the notch from the window (security review, 24 October 2026: SEC-3)", () => {
  /** A window request the app starts (with its Bearer when given), bound by `bindWith`'s session. */
  async function windowRequest(bearer: string | undefined, bindWith: string) {
    const p = pkce();
    const started = await json<{ startUrl: string }>(await call(authStart, {
      path: "/api/desktop/app/auth/start", body: { challenge: p.challenge, state: p.state, via: "window" },
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    }));
    const t = new URL(started.startUrl).searchParams.get("t")!;
    const bound = await get(startGet, { path: `/desktop/app/start?t=${t}`, cookies: { boredroom_session: bindWith } });
    return cookieValue(setCookie(bound, "boredroom_desktop_auth"))!;
  }

  it("names who the notch is signed in as, knows the same person, and is fresh only after signing in in the flow", async () => {
    const mac = await linkedMac(a.employee.authUserId);
    // Someone else's session in the window: not fresh, and it names the notch's person.
    const foreign = await webSession(a.hr.authUserId);
    const v1 = await finishView(foreign.token, await windowRequest(mac.token, foreign.token));
    expect(v1).toMatchObject({ state: "ready", via: "window", fresh: false, sameAsNotch: false, replacing: { email: a.employee.email } });
    // The notch's own person: same, nobody replaced.
    const own = await webSession(a.employee.authUserId);
    expect(await finishView(own.token, await windowRequest(mac.token, own.token))).toMatchObject({ fresh: false, sameAsNotch: true, replacing: null });
    // No Bearer (an unlinked notch): nobody to name, not the same.
    expect(await finishView(foreign.token, await windowRequest(undefined, foreign.token))).toMatchObject({ fresh: false, sameAsNotch: false, replacing: null });
    // A Bearer that isn't a live desktop session is ignored.
    expect(await finishView(foreign.token, await windowRequest(foreign.token, foreign.token))).toMatchObject({ sameAsNotch: false, replacing: null });
    // Signed in after the request was bound: fresh.
    const cookie = await windowRequest(mac.token, foreign.token);
    await new Promise((r) => setTimeout(r, 5));
    const later = await webSession(a.hr.authUserId);
    expect(await finishView(later.token, cookie)).toMatchObject({ fresh: true, replacing: { email: a.employee.email } });
  });
});

describe("desktop-only gates", () => {
  it("a window session is a web session: never a desktop one", async () => {
    const mac = await linkedMac(a.employee.authUserId);
    const w = await windowSession(mac.token);
    const winCtx = await orgContextForToken("company-a", w.token);
    const macCtx = await orgContextForToken("company-a", mac.token);
    expect(await isDesktopSession(winCtx)).toBe(false);
    expect(await isDesktopSession(macCtx)).toBe(true);
  });
});

describe("the browser bridge", () => {
  it("only a window session may ask; the preview uses nothing; the press is strict, single use and in date", async () => {
    const plain = await webSession(a.employee.authUserId);
    const start = (token: string) => call(connectorStart, { path: "/api/orgs/company-a/connectors/fake/start", body: { kind: "personal", act: false, browser: true }, headers: SAME, cookies: { boredroom_session: token }, params: { org: "company-a", provider: "fake" } });
    const refused = await start(plain.token);
    expect(refused.status).toBe(403);
    expect((await json(refused)).code).toBe("NOT_A_WINDOW_SESSION");
    // Without `browser`, the plain start works as before (the state cookie and the provider's URL).
    const normal = await call(connectorStart, { path: "/api/orgs/company-a/connectors/fake/start", body: { kind: "personal", act: false }, headers: SAME, cookies: { boredroom_session: plain.token }, params: { org: "company-a", provider: "fake" } });
    expect(normal.status).toBe(200);
    expect(setCookie(normal, "boredroom_connector")).toBeTruthy();
    resetStartSpacingForTests();

    const mac = await linkedMac(a.employee.authUserId);
    const w = await windowSession(mac.token);
    const mineBrowser = await webSession(a.employee.authUserId);
    const minted = await start(w.token);
    expect(minted.status).toBe(200);
    expect(setCookie(minted, "boredroom_connector")).toBeNull(); // no state yet: the browser starts it
    const { url } = await json<{ url: string }>(minted);
    expect(url.startsWith(`${ORIGIN}/desktop/continue?t=`)).toBe(true);
    const t = new URL(url).searchParams.get("t")!;
    expect(await previewTicket(t, undefined)).toMatchObject({ app: "Test app", workspaceName: "Company A", email: a.employee.email, browser: "none", otherEmail: null });
    expect(await previewTicket(t, undefined)).not.toBeNull(); // read only
    const someoneElse = await webSession(a.hr.authUserId);
    expect(await previewTicket(t, someoneElse.token)).toMatchObject({ browser: "other", otherEmail: a.hr.email });
    expect((await previewTicket(t, w.token))?.browser).toBe("window");

    for (const h of <Record<string, string>[]>[{ origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "same-site" }, {}]) {
      expect((await call(continuePost, { path: "/api/desktop/continue", body: { t }, headers: h })).status).toBe(403);
    }
    // Security review, 24 October 2026 (SEC-1, SEC-2, SEC-3): the bridge never signs a browser in. Each refusal leaves
    // the ticket unused and sets no session cookie.
    const sessionsBefore = (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1`, [a.employee.authUserId]))[0].n;
    const imp = (await adminQuery<{ id: string }>(`INSERT INTO admin_impersonations(admin_user_id, target_user_id, reason) VALUES ($1, $2, 'support') RETURNING id`, [a.owner.authUserId, a.employee.authUserId]))[0].id;
    const impSession = await webSession(a.employee.authUserId);
    await adminQuery(`UPDATE auth_sessions SET impersonation_id = $1 WHERE token_hash = $2`, [imp, sha256(impSession.token)]);
    expect((await previewTicket(t, impSession.token))?.browser).toBe("impersonated");
    for (const [cookie, status, code] of <[string | undefined, number, string][]>[
      [undefined, 401, "SIGN_IN_FIRST"], [someoneElse.token, 403, "WRONG_ACCOUNT"], [w.token, 403, "IN_APP_WINDOW"], [impSession.token, 403, "IMPERSONATED"],
    ]) {
      const r = await call(continuePost, { path: "/api/desktop/continue", body: { t }, headers: SAME, cookies: { boredroom_session: cookie } });
      expect(r.status, code).toBe(status);
      expect((await json(r)).code).toBe(code);
      expect(setCookie(r, "boredroom_session")).toBeNull();
      expect(setCookie(r, "boredroom_connector")).toBeNull();
    }
    expect((await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1`, [a.employee.authUserId]))[0].n).toBe(sessionsBefore + 1); // only impSession
    expect(await previewTicket(t, undefined)).not.toBeNull(); // still unused
    expect((await previewTicket(t, mineBrowser.token))?.browser).toBe("same");

    // The person's own browser session: the consent starts there; still no session cookie.
    const pressed = await call(continuePost, { path: "/api/desktop/continue", body: { t }, headers: SAME, cookies: { boredroom_session: mineBrowser.token } });
    expect(pressed.status).toBe(200);
    const goTo = new URL((await json<{ url: string }>(pressed)).url);
    const state = cookieValue(setCookie(pressed, "boredroom_connector"))!;
    expect(goTo.searchParams.get("state")).toBe(state);
    expect(setCookie(pressed, "boredroom_from_desktop")).toMatch(/Max-Age=900/);
    expect(setCookie(pressed, "boredroom_session")).toBeNull();
    const used = await adminQuery<{ browser_session_id: string }>(`SELECT browser_session_id FROM desktop_browser_tickets WHERE ticket_hash = $1`, [sha256(t)]);
    expect(used[0].browser_session_id).toBe(mineBrowser.id);
    // The callback completes in that browser as today.
    const browserUser = (await orgContextForToken("company-a", mineBrowser.token)).user;
    const done = await completeConnect({ provider: "fake", query: goTo.searchParams, cookieState: state, user: browserUser });
    expect(done.ok).toBe(true);
    expect(done.location).toContain("connected=");
    // Single use.
    expect((await call(continuePost, { path: "/api/desktop/continue", body: { t }, headers: SAME, cookies: { boredroom_session: mineBrowser.token } })).status).toBe(410);
    expect(await previewTicket(t, undefined)).toBeNull();
  });

  it("the same person keeps their browser session; an expired ticket or a signed-out window refuses", async () => {
    const mac = await linkedMac(a.manager.authUserId);
    const w = await windowSession(mac.token);
    const mint = async () => {
      resetStartSpacingForTests();
      const r = await call(connectorStart, { path: "/api/orgs/company-a/connectors/fake/start", body: { kind: "personal", act: false, browser: true }, headers: SAME, cookies: { boredroom_session: w.token }, params: { org: "company-a", provider: "fake" } });
      return new URL((await json<{ url: string }>(r)).url).searchParams.get("t")!;
    };
    const mine = await webSession(a.manager.authUserId);
    const t1 = await mint();
    resetStartSpacingForTests();
    const pressed = await call(continuePost, { path: "/api/desktop/continue", body: { t: t1 }, headers: SAME, cookies: { boredroom_session: mine.token } });
    expect(pressed.status).toBe(200);
    expect(setCookie(pressed, "boredroom_session")).toBeNull();
    const t2 = await mint();
    await adminQuery(`UPDATE desktop_browser_tickets SET expires_at = now() - interval '1 second' WHERE ticket_hash = $1`, [sha256(t2)]);
    expect((await call(continuePost, { path: "/api/desktop/continue", body: { t: t2 }, headers: SAME })).status).toBe(410);
    const t3 = await mint();
    await call(logout, { path: "/api/auth/logout", body: {}, headers: SAME, cookies: { boredroom_session: w.token } });
    expect((await call(continuePost, { path: "/api/desktop/continue", body: { t: t3 }, headers: SAME })).status).toBe(410);
  });
});

describe("the window's route handlers", () => {
  it("/desktop/app: the handoff page with no session; 303 next for the same person; ready otherwise", async () => {
    const page = await get(entryGet, { path: "/desktop/app?next=%2Fapp%2Fcompany-a%2Fhome" });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await page.text();
    expect(html).toContain("__boredroomHandoff");
    expect(html).toContain("/api/desktop/app/handoff/redeem");
    expect(html).not.toMatch(/https?:\/\/(?!localhost)/); // nothing external
    const w = await webSession(a.employee.authUserId);
    const d = userDigest(a.employee.authUserId);
    const fast = await get(entryGet, { path: `/desktop/app?next=%2Fapp%2Fcompany-a%2Fhome&u=${d}`, cookies: { boredroom_session: w.token } });
    expect(fast.status).toBe(303);
    expect(fast.headers.get("location")).toBe(`${ORIGIN}/app/company-a/home`);
    const noU = await get(entryGet, { path: "/desktop/app?next=%2Fapp", cookies: { boredroom_session: w.token } });
    expect(noU.headers.get("location")).toBe(`${ORIGIN}/desktop/app/ready?next=%2Fapp&u=${d}`);
    const other = await get(entryGet, { path: "/desktop/app?next=%2Fapp&u=0000000000000000", cookies: { boredroom_session: w.token } });
    expect(other.headers.get("location")).toBe(`${ORIGIN}/desktop/app/ready?next=%2Fapp&u=${d}`);
    const evil = await get(entryGet, { path: `/desktop/app?next=%2F%2Fevil.com&u=${d}`, cookies: { boredroom_session: w.token } });
    expect(evil.headers.get("location")).toBe(`${ORIGIN}/app`);
    // An impersonation session is "imp", and never takes the fast path.
    const imp = (await adminQuery<{ id: string }>(`INSERT INTO admin_impersonations(admin_user_id, target_user_id, reason) VALUES ($1, $2, 'support') RETURNING id`, [a.owner.authUserId, a.employee.authUserId]))[0].id;
    const is = await webSession(a.employee.authUserId);
    await adminQuery(`UPDATE auth_sessions SET impersonation_id = $1 WHERE token_hash = $2`, [imp, sha256(is.token)]);
    const impR = await get(entryGet, { path: `/desktop/app?next=%2Fapp&u=imp`, cookies: { boredroom_session: is.token } });
    expect(impR.headers.get("location")).toBe(`${ORIGIN}/desktop/app/ready?next=%2Fapp&u=imp`);
    // A Bearer is not a session here.
    const mac = await linkedMac(a.employee.authUserId);
    expect((await get(entryGet, { path: "/desktop/app", headers: { authorization: `Bearer ${mac.token}` } })).status).toBe(200);
  });

  it("/desktop/app/ready: the app decides (no redirect in the app's window); a browser goes straight on", async () => {
    const inApp = await (await get(readyGet, { path: "/desktop/app/ready?next=%2Fapp%2Fx", headers: { "user-agent": APP_UA } })).text();
    expect(inApp).not.toContain("http-equiv=\"refresh\"");
    expect(inApp).toContain("\"ready\"");
    const browser = await (await get(readyGet, { path: "/desktop/app/ready?next=%2F%2Fevil.com" })).text();
    expect(browser).toContain(`http-equiv="refresh" content="0;url=/app"`);
  });

  it("the request cookie from one browser can't be read as another request's", async () => {
    expect(requestCookieValue("6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b")).not.toBe(requestCookieValue("00000000-0000-4000-8000-000000000000"));
  });
});
