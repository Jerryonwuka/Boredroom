/**
 * Before migration 0054 (owner decisions, 8 October 2026: phase 8, contract B.3): the code ships before the database
 * update (a deploy, the running dev server), so calls are off and nothing throws. Each server row of B.3:
 * `/calls/now` answers `{ ready: false, available: false, pollMs: 60000 }`, the history `{ ready: false, items: [] }`,
 * every other calls route 503 NOT_READY; Messages carry no call lines; nobody is "On a call" (the Workroom's source, the
 * notch's teammates); the worker's call jobs, its schedule and the sweep do nothing. Then 0054 is applied twice by hand:
 * no error, one of each object; with LiveKit not configured the writes answer 503 CALLS_NOT_CONFIGURED while the reads
 * work; then a call works end to end. The test schema is built from every migration before 0054. LiveKit is faked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(),
}));

const LK = { LIVEKIT_URL: "wss://test.livekit.invalid", LIVEKIT_API_KEY: "APItestkey", LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-000000000000" };
Object.assign(process.env, LK);

import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { withSystem, withUser, withWorker } from "@/server/db";
import { issueSession } from "@/server/auth";
import { forget0054, schema0054Ready } from "@/server/lib/schema-0054";
import { setLiveKitForTests } from "@/server/lib/livekit";
import {
  callHistory, callsAvailability, getCallView, joinCall, leaveCall, liveCalls, membersOnCall, settleCall, startCall, sweepCalls,
} from "@/server/services/calls";
import { inbox, openChannel, openDirect, sendMessage, thread } from "@/server/services/messaging";
import { desktopState } from "@/server/services/desktop";
import { memberCard } from "@/server/services/workspace";
import { scheduleCalls } from "../../worker/schedule";
import { handlers } from "../../worker/handlers";
import { GET as nowGET } from "@/app/api/orgs/[org]/calls/now/route";
import { GET as historyGET, POST as startPOST } from "@/app/api/orgs/[org]/calls/route";
import { GET as liveGET } from "@/app/api/orgs/[org]/calls/live/route";
import { GET as callGET } from "@/app/api/orgs/[org]/calls/[id]/route";
import { POST as joinPOST } from "@/app/api/orgs/[org]/calls/[id]/join/route";
import { POST as acceptPOST } from "@/app/api/orgs/[org]/calls/[id]/accept/route";
import { POST as declinePOST } from "@/app/api/orgs/[org]/calls/[id]/decline/route";
import { POST as leavePOST } from "@/app/api/orgs/[org]/calls/[id]/leave/route";
import { POST as endPOST } from "@/app/api/orgs/[org]/calls/[id]/end/route";
import { POST as heartbeatPOST } from "@/app/api/orgs/[org]/calls/[id]/heartbeat/route";
import type { OrgContext } from "@/server/lib/api";

const MIGRATION = join(process.cwd(), "db", "migrations", "0054_calls.sql");
const NOT_READY = { code: "NOT_READY", message: "Calls need a database update first. Try again later." };
const NOT_CONFIGURED = { code: "CALLS_NOT_CONFIGURED", message: "Calls aren't set up on this server yet." };
const SOME_ID = "11111111-1111-4111-8111-111111111111";

let a: CompanyFixture;
let david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string, dm: string;
const sessions = new Map<string, string>();
const ORG = { org: "company-a" };
const deleted: string[] = [];

function as(u: FixtureUser) { reqState.cookie = sessions.get(u.email) ?? null; }
type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, method: string, path: string, params: P, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body !== undefined ? { "content-type": "application/json" } : {} };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handler(new Request(`http://localhost:3000${path}`, init), { params: Promise.resolve(params) });
}

/** As resetTestDatabase, but stopping before 0054. */
async function schemaBefore0054() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0054").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0054() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync(MIGRATION, "utf8"));
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally { await c.end(); }
}

beforeAll(async () => {
  await schemaBefore0054();
  forget0054();
  setLiveKitForTests({ listRooms: async () => [], listParticipants: async () => [], deleteRoom: async (r) => { deleted.push(r); }, removeParticipant: async () => undefined });
  expect(await adminQuery("SELECT to_regclass('public.calls') IS NULL AS missing")).toEqual([{ missing: true }]);
  a = await buildCompany("a", { names: { owner: "Olu Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  for (const u of [a.manager, a.employee, a.employee2]) sessions.set(u.email, await withSystem((db) => issueSession(db, u.authUserId, { method: "password" })));
  design = await openChannel(david, a.teamId);
  dm = await openDirect(ada, ben.membership.id);
  await sendMessage(ada, { conversationId: dm, body: "Hello Ben" });
});

afterAll(() => { setLiveKitForTests(null); Object.assign(process.env, LK); });

describe("before 0054, calls are off and nothing throws", () => {
  it("the readiness check and the availability say not yet", async () => {
    expect(await withSystem((db) => schema0054Ready(db))).toBe(false);
    expect(await callsAvailability()).toEqual({ ready: false, configured: true, available: false });
  });

  it("GET /calls/now answers not ready, slowly polled; the history answers empty", async () => {
    as(a.employee);
    const r = await call(nowGET, "GET", "/api/orgs/company-a/calls/now", ORG);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ready: false, available: false, me: ada.membership.id, ringing: [], active: null, pollMs: 60000, serverNow: expect.any(String), ringsOnDesktop: false });
    const h = await call(historyGET, "GET", "/api/orgs/company-a/calls?filter=missed", ORG);
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ready: false, items: [], nextBefore: null });
  });

  it("every other calls route answers 503 NOT_READY", async () => {
    as(a.employee);
    const p = { org: "company-a", id: SOME_ID };
    const base = `/api/orgs/company-a/calls/${SOME_ID}`;
    const answers = [
      await call(startPOST, "POST", "/api/orgs/company-a/calls", ORG, { to: ben.membership.id }),
      await call(liveGET, "GET", "/api/orgs/company-a/calls/live", ORG),
      await call(callGET, "GET", base, p),
      await call(joinPOST, "POST", `${base}/join`, p, {}),
      await call(acceptPOST, "POST", `${base}/accept`, p, {}),
      await call(declinePOST, "POST", `${base}/decline`, p, {}),
      await call(leavePOST, "POST", `${base}/leave`, p),
      await call(endPOST, "POST", `${base}/end`, p),
      await call(heartbeatPOST, "POST", `${base}/heartbeat`, p),
    ];
    for (const r of answers) {
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject(NOT_READY);
    }
    expect(await liveCalls(ada)).toEqual([]);
  });

  it("Messages carry no call lines; nobody is on a call; the notch's teammates are not either", async () => {
    const t = await thread(ben, dm);
    expect(t!.messages.length).toBeGreaterThan(0);
    expect(t!.messages.every((m) => m.call === null)).toBe(true);
    const box = await inbox(ben);
    expect([...box.channels, ...box.direct].every((c) => c.last_is_call === false)).toBe(true);
    expect(await withUser(david.user.profileId, (db) => membersOnCall(db, david.org.id))).toEqual(new Set());
    // membersOnCall never spoils the caller's transaction.
    expect(await withUser(david.user.profileId, async (db) => { await membersOnCall(db, david.org.id); return (await db.one<{ n: number }>(`SELECT 1 AS n`)).n; })).toBe(1);
    const state = await desktopState(david, { opener: false });
    expect(state.team.length).toBeGreaterThan(0);
    expect(state.team.every((m) => m.onCall === false)).toBe(true);
    // The person card (integration patch P2, 10 October 2026): never "On a call" before 0054, and it still opens.
    expect((await memberCard(david, ada.membership.id)).on_call).toBe(false);
  });

  it("the worker's call jobs, the schedule and the sweep do nothing", async () => {
    await expect(settleCall(SOME_ID)).resolves.toBeUndefined();
    expect(await sweepCalls({ rooms: true })).toEqual({ settled: 0, roomsClosed: 0, recapsQueued: 0, strayRooms: 0 });
    expect(await scheduleCalls()).toEqual({ queued: false, due: false });
    await handlers["call.ring_timeout"]({ callId: SOME_ID }, { jobId: "x", attempt: 1 });
    await handlers["call.sweep"]({ rooms: true }, { jobId: "x", attempt: 1 });
    expect(await adminQuery(`SELECT type FROM jobs WHERE type LIKE 'call.%'`)).toEqual([]);
  });
});

describe("0054 applied by hand, twice", () => {
  it("applies twice with no error, one of each object", async () => {
    await apply0054();
    await apply0054();
    forget0054();
    expect(await withSystem((db) => schema0054Ready(db))).toBe(true);
    // The five call tables and call_ringers (fix review, 10 October 2026: one ringer, the notch's or the browser's).
    const tables = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('calls', 'call_participants', 'call_note_consents', 'call_transcript_lines', 'call_recaps', 'call_ringers') AND relkind = 'r'`);
    expect(tables[0].n).toBe(6);
    const triggers = await adminQuery<{ tgname: string; n: number }>(`SELECT tgname, count(*)::int AS n FROM pg_trigger WHERE tgrelid IN ('calls'::regclass, 'call_participants'::regclass, 'call_note_consents'::regclass) AND NOT tgisinternal GROUP BY tgname`);
    expect(triggers.every((t) => t.n === 1)).toBe(true);
    expect(triggers.length).toBe(9);
    const policies = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'call%'`);
    expect(policies[0].n).toBe(11);
    const procs = await adminQuery<{ proname: string; n: number }>(`SELECT proname, count(*)::int AS n FROM pg_proc WHERE proname LIKE 'app_call%' OR proname = 'app_members_on_call' GROUP BY proname`);
    expect(procs.every((p) => p.n === 1)).toBe(true);
    expect(procs.length).toBe(17);
  });

  it("without LiveKit configured: the writes answer CALLS_NOT_CONFIGURED, now says ready but unavailable, the reads work", async () => {
    delete process.env.LIVEKIT_URL;
    try {
      expect(await callsAvailability()).toEqual({ ready: true, configured: false, available: false });
      as(a.employee);
      const r = await call(nowGET, "GET", "/api/orgs/company-a/calls/now", ORG);
      expect(await r.json()).toMatchObject({ ready: true, available: false, ringing: [], active: null, pollMs: 60000 });
      const s = await call(startPOST, "POST", "/api/orgs/company-a/calls", ORG, { to: ben.membership.id });
      expect(s.status).toBe(503);
      expect(await s.json()).toMatchObject(NOT_CONFIGURED);
      expect((await callHistory(ada, { filter: "all" })).ready).toBe(true);
      expect(await liveCalls(ada)).toEqual([]);
    } finally { Object.assign(process.env, LK); }
  });

  it("then a call works end to end", async () => {
    const s = await startCall(ada, { to: ben.membership.id });
    expect(s.connection?.identity).toBe(ada.membership.id);
    const j = await joinCall(ben, s.call.id);
    expect(j.call.state).toBe("active");
    expect(await withWorker((db) => membersOnCall(db, ada.org.id))).toEqual(new Set([ada.membership.id, ben.membership.id]));
    const state = await desktopState(david, { opener: false });
    expect(state.team.filter((m) => m.onCall).map((m) => m.id).sort()).toEqual([ada.membership.id, ben.membership.id].sort());
    const l = await leaveCall(ada, s.call.id);
    expect(l.call).toMatchObject({ state: "ended", endReason: "completed" });
    expect(deleted).toEqual([`call-${s.call.id}`]);
    const t = await thread(ben, dm);
    expect(t!.messages.at(-1)?.call).toMatchObject({ id: s.call.id, part: "line", state: "ended" });
    expect((await getCallView(ben, s.call.id))?.durationSeconds).toBeGreaterThanOrEqual(0);
    // A group call too.
    const g = await startCall(david, { conversationId: design });
    expect(g.call.kind).toBe("group");
    expect(await scheduleCalls()).toEqual({ queued: true, due: true });
  });
});
