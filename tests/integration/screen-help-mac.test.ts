/**
 * Brenda for Mac, phase 3: the person's own Mac state and "Set up on my Mac" (owner report, 12 October 2026: "when I
 * turned this setting on, I stopped seeing my Brenda"; owner request the same day: the person sees what is on, the
 * employer still sees nothing; contract 0b.2, 0b.3, A.5, A.6, G.2, K.2, N).
 *
 * PUT /screen-help/mac stores what Brenda for Mac reports, from a desktop session only, never while someone else is signed
 * in as the person; GET /screen-help/me shows it with the device names, lists linked Macs with no report, and shows
 * nothing while impersonated; "Set up on my Mac" reaches the person's own desktop state for 15 minutes, and Turn off
 * clears it; nobody else sees any of it.
 *
 * Local test database only (TEST_DATABASE_URL); migration 0059 waits in db/pending and is applied here by hand.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { startLink, approveLink, pollLink, desktopState } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { forget0059 } from "@/server/lib/schema-0059";
import { myScreenHelp, saveMacState } from "@/server/services/screen-help";
import { PUT as macPUT } from "@/app/api/orgs/[org]/screen-help/mac/route";
import { GET as mineGET, PUT as minePUT } from "@/app/api/orgs/[org]/screen-help/me/route";
import type { MacState, ScreenHelpMine } from "@/lib/screen-help";
import type { OrgContext } from "@/server/lib/api";

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES };
let owner: OrgContext, hr: OrgContext, ada: OrgContext, ben: OrgContext;
const desk = new Map<string, string[]>();
const web = new Map<string, string>();
const logs: string[] = [];

const state = (o: Partial<MacState> = {}): MacState => ({
  v: 1, binary: 2, supported: true,
  look: { on: true, permission: "granted" }, mac: { on: false, accessibility: "unknown" }, files: { on: false, finder: "unknown", folders: null },
  companion: { on: true, shown: null, why: null }, preview: false, ...o,
});

async function link(c: OrgContext, name: string, n: number): Promise<string> {
  const l = await startLink({ deviceName: name }, { ip: `127.0.6.${n}`, origin: "http://localhost:3000" });
  await approveLink(c.user, { userCode: l.userCode, orgSlug: c.org.slug });
  return ((await pollLink({ deviceCode: l.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token;
}
type Handler = (req: Request, ctx: { params: Promise<{ org: string }> }) => Promise<Response>;
async function call(c: OrgContext, handler: Handler, method: string, path: string, body: unknown, o: { bearer?: string } = {}) {
  reqState.cookie = o.bearer ? null : web.get(c.membership.id) ?? null;
  reqState.bearer = o.bearer ?? null;
  const res = await handler(new Request(`http://localhost:3000/api/orgs/${c.org.slug}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ org: c.org.slug }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const report = (c: OrgContext, i: number, s: MacState, setupSeen: string | null = null) => call(c, macPUT, "PUT", "/screen-help/mac", { version: 1, state: s, setupSeen }, { bearer: desk.get(c.membership.id)![i] });

beforeAll(async () => {
  for (const k of ["error", "warn", "log", "info"] as const) vi.spyOn(console, k).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
  await resetTestDatabase();
  await adminQuery(readFileSync(join(process.cwd(), "db", "migrations", "0059_mac_help.sql"), "utf8"));
  forget0057(); forget0058(); forget0059();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real";
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  const a = await buildCompany("a");
  owner = a.ownerCtx; hr = a.hrCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  let n = 1;
  for (const c of [owner, hr, ada, ben]) web.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
  desk.set(ada.membership.id, [await link(ada, "Ada's MacBook Air", n++), await link(ada, "Ada's Studio", n++), await link(ada, "Ada's old iMac", n++)]);
  desk.set(ben.membership.id, [await link(ben, "Ben's Mac", n++)]);
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  reqState.cookie = null; reqState.bearer = null;
  vi.restoreAllMocks();
});

describe("PUT /screen-help/mac (contract A.6, K.2)", () => {
  it("from Brenda for Mac: stored for the person, newest first, an unchanged state within ten seconds not rewritten", async () => {
    expect((await report(ada, 0, state())).json).toEqual({ saved: true, ready: true });
    expect((await report(ada, 0, state())).json).toEqual({ saved: false, ready: true });
    expect((await report(ada, 1, state({ binary: 3, mac: { on: true, accessibility: "denied" }, files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "unknown", downloads: "denied" } }, companion: { on: true, shown: false, why: "call" } }))).json).toEqual({ saved: true, ready: true });
    const stored = (await adminQuery<{ macs: { session: string; state: MacState }[] }>("SELECT screen_help_macs AS macs FROM assistant_private WHERE membership_id = $1", [ada.membership.id]))[0].macs;
    expect(stored).toHaveLength(2);
    expect(stored[0].state.binary).toBe(3);
    expect(JSON.stringify(stored)).not.toMatch(/MacBook|Studio/);
  });
  it("from the web: 403 LOOK_DESKTOP_ONLY; a body that isn't the state: 422; never logged", async () => {
    expect(await call(ada, macPUT, "PUT", "/screen-help/mac", { version: 1, state: state(), setupSeen: null })).toMatchObject({ status: 403, json: { code: "LOOK_DESKTOP_ONLY" } });
    expect((await report(ada, 0, { ...state(), extra: "/Users/ada/Documents" } as MacState)).status).toBe(422);
    expect(logs.join("\n")).not.toMatch(/Documents|granted|MacBook/);
  });
  it("never while someone else is signed in as the person (403)", async () => {
    const session = (await adminQuery<{ id: string }>("SELECT id FROM auth_sessions WHERE kind = 'desktop' AND user_id = $1 LIMIT 1", [ada.user.authUserId]))[0].id;
    const as = { ...ada, user: { ...ada.user, sessionId: session, impersonation: { id: "00000000-0000-4000-8000-0000000000ae", adminEmail: "support@boredroom.test" } } } as OrgContext;
    await expect(saveMacState(as, { version: 1, state: state(), setupSeen: null })).rejects.toMatchObject({ status: 403 });
  });
});

describe("GET /screen-help/me and Set up on my Mac (contract A.5, 0b.3, G.3)", () => {
  it("each Mac with its name and when it checked in, linked Macs without a report, newest report first", async () => {
    const r = await call(ada, mineGET, "GET", "/screen-help/me", undefined);
    const m = r.json as unknown as ScreenHelpMine;
    expect(m).toMatchObject({ ready: true, macReady: true, setupAt: null, impersonated: false });
    expect(m.macs.map((x) => x.device)).toEqual(["Ada's Studio", "Ada's MacBook Air"]);
    expect(m.macs[0].state.companion).toEqual({ on: true, shown: false, why: "call" });
    expect(m.linked.map((x) => x.device)).toEqual(["Ada's old iMac"]);
    expect(Object.keys(m.macs[0]).sort()).toEqual(["device", "lastSeenAt", "reportedAt", "setupSeenAt", "state"]);
  });
  it("a Mac that is unlinked drops off the card", async () => {
    await adminQuery("UPDATE auth_sessions SET revoked_at = now() WHERE kind = 'desktop' AND user_id = $1 AND device_name = $2", [ada.user.authUserId, "Ada's old iMac"]);
    const m = (await call(ada, mineGET, "GET", "/screen-help/me", undefined)).json as unknown as ScreenHelpMine;
    expect(m.linked).toEqual([]);
  });
  it("Set up reaches only the person's own desktop state, for 15 minutes; the Mac's answer is recorded; Turn off clears it", async () => {
    const put = await call(ada, minePUT, "PUT", "/screen-help/me", { setup: true });
    expect(put.status).toBe(200);
    const setupAt = (put.json as unknown as ScreenHelpMine).setupAt!;
    expect(Date.parse(setupAt)).toBeGreaterThan(Date.now() - 60_000);
    expect((await desktopState(ada)).look).toMatchObject({ setupAt, mac: { ready: true } });
    expect((await desktopState(ben)).look).toMatchObject({ setupAt: null, mac: { ready: true } });
    // The Mac opened the setup card for it and says so.
    expect((await report(ada, 0, state({ preview: true }), setupAt)).json).toEqual({ saved: true, ready: true });
    const m = (await call(ada, mineGET, "GET", "/screen-help/me", undefined)).json as unknown as ScreenHelpMine;
    expect(m.macs.find((x) => x.device === "Ada's MacBook Air")!.setupSeenAt).toBe(setupAt);
    // Stale after 15 minutes.
    await adminQuery("UPDATE assistant_private SET screen_help_setup_at = now() - interval '16 minutes' WHERE membership_id = $1", [ada.membership.id]);
    expect((await desktopState(ada)).look.setupAt).toBeNull();
    // Turn off on my Macs clears a pending Set up.
    await call(ada, minePUT, "PUT", "/screen-help/me", { setup: true });
    const off = await call(ada, minePUT, "PUT", "/screen-help/me", { off: true });
    expect(off.json).toMatchObject({ setupAt: null });
    expect((await desktopState(ada)).look.setupAt).toBeNull();
    expect((await desktopState(ada)).look.offAt).toBe(off.json.offAt);
  });
  it("while someone else is signed in as the person: nothing about their Macs, and Set up is refused", async () => {
    const as = { ...ada, user: { ...ada.user, impersonation: { id: "00000000-0000-4000-8000-0000000000ae", adminEmail: "support@boredroom.test" } } } as OrgContext;
    expect(await myScreenHelp(as)).toMatchObject({ ready: true, macReady: true, macs: [], linked: [], setupAt: null, impersonated: true });
    expect((await desktopState(as)).look.setupAt).toBeNull();
  });
  it("RLS: owners, HR and colleagues read none of it", async () => {
    for (const c of [owner, hr, ben]) {
      expect(await appQueryAs(c.user.profileId, "SELECT screen_help_macs, screen_help_setup_at FROM assistant_private WHERE membership_id = $1", [ada.membership.id])).toEqual([]);
    }
    const own = await appQueryAs(ada.user.profileId, "SELECT jsonb_array_length(screen_help_macs) AS n FROM assistant_private WHERE membership_id = $1", [ada.membership.id]);
    expect(own).toEqual([{ n: 2 }]);
  });
});
