/**
 * Screen help on Brenda for Mac: the workspace's and the person's settings (owner decisions, 11 October 2026: "start
 * building with your recommendations"; contract 0.9, 0.11, D.2, D.3, D.5, G).
 *
 * 1. Before migration 0057 (the code ships first): the desktop state reads `look.ready: false`, the views `ready: false`,
 *    the writes and the look route answer 503, a workspace is still created (with no row). Then 0057 is applied by hand,
 *    twice: no error.
 * 2. The lazy notice: the first time a workspace in the pilot is read, its 14 days' notice starts and owners and HR are
 *    told, once. Owners and HR switch it, list apps and start it now; staff are refused; members read it. A workspace
 *    created while it is offered is available at once.
 * 3. The person's own side: their never-look list and "Turn off on my Macs", refused while someone is signed in as them.
 * 4. Row-level security: staff cannot change the workspace's row; nobody but the worker reads the look costs; an owner
 *    cannot read a member's screen help columns.
 *
 * Local test database only (TEST_DATABASE_URL); no model.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null, bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: async () => { throw new Error("no model in this test"); } }; } }));

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, contextFor, createVerifiedUser, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem } from "@/server/db";
import { issueSession } from "@/server/auth";
import { createOrganisation, DEFAULT_NOTICE, PHASE8_DEFAULT_NOTICE } from "@/server/services/orgs";
import { desktopState, startLink, approveLink, pollLink } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { myScreenHelp, saveMyScreenHelp, saveScreenHelp, screenHelpView } from "@/server/services/screen-help";
import { recordLookUsage } from "@/server/services/ai-usage";
import { brendaOverview } from "@/server/services/brenda";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/orgs/[org]/screen-help/route";
import { GET as mineGET, PUT as minePUT } from "@/app/api/orgs/[org]/screen-help/me/route";
import type { OrgContext } from "@/server/lib/api";

const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES };
let a: CompanyFixture;
let owner: OrgContext, hr: OrgContext, david: OrgContext, ada: OrgContext;
const web = new Map<string, string>();
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;

function apply0057() {
  const pending = join(process.cwd(), "db", "pending", "0057_screen_help.sql");
  const file = existsSync(pending) ? pending : join(process.cwd(), "db", "migrations", "0057_screen_help.sql");
  return adminQuery(readFileSync(file, "utf8"));
}

type Handler = (req: Request, ctx: { params: Promise<{ org: string }> }) => Promise<Response>;
async function call(c: OrgContext, handler: Handler, method: string, path: string, body?: unknown, o: { bearer?: string } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  reqState.cookie = o.bearer ? null : web.get(c.membership.id) ?? null;
  reqState.bearer = o.bearer ?? null;
  const init: RequestInit = { method, headers: body !== undefined ? { "content-type": "application/json" } : {} };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handler(new Request(`http://localhost:3000/api/orgs/${c.org.slug}${path}`, init), { params: Promise.resolve({ org: c.org.slug }) });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

/**
 * 0057 moved from db/pending to db/migrations when it was applied (12 October 2026), so the reset applies it: its objects
 * are taken out again here, so the first describe still proves the code before 0057 (nothing else depends on them).
 */
async function before0057() {
  await adminQuery(`DROP TABLE IF EXISTS look_usage_daily; DROP TABLE IF EXISTS screen_help_settings;
    ALTER TABLE assistant_private DROP CONSTRAINT IF EXISTS assistant_private_screen_help_check;
    ALTER TABLE assistant_private DROP COLUMN IF EXISTS screen_help_never_look; ALTER TABLE assistant_private DROP COLUMN IF EXISTS screen_help_off_at;`);
}

beforeAll(async () => {
  await resetTestDatabase(); // every migration in db/migrations
  await before0057();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real";
  process.env.BRENDA_LOOK_WORKSPACES = "company-a, early-co, fresh-co";
  a = await buildCompany("a");
  owner = a.ownerCtx; hr = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx;
  for (const c of [owner, hr, david, ada]) web.set(c.membership.id, await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password" })));
});

afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  reqState.cookie = null; reqState.bearer = null;
});

describe("before migration 0057 (contract D.3)", () => {
  it("nothing throws: not ready everywhere, writes and looks answer 503, a workspace is still created", async () => {
    forget0057();
    expect(await count("SELECT count(*)::int AS n FROM pg_class WHERE relname = 'screen_help_settings'")).toBe(0);
    // Phase 2 (owner request, 12 October 2026; contract D.4): the state also says v2 looks and, not ready, no tasks.
    expect((await desktopState(ada)).look).toEqual({ ready: false, eligible: true, available: false, reason: "not_ready", availableFrom: null, neverLook: [], offAt: null, v: 2, act: { ready: false, available: false, reason: "not_ready" }, setupAt: null, mac: { ready: false } });
    expect(await screenHelpView(owner)).toMatchObject({ ready: false, eligible: true, available: false, reason: "not_ready", canEdit: true });
    // Phase 3 (contract G.3): the card's Mac fields, empty.
    const noMacs = { macReady: false, macs: [], linked: [], setupAt: null, impersonated: false };
    expect(await myScreenHelp(ada)).toEqual({ ready: false, neverLook: [], offAt: null, ...noMacs });
    await expect(saveScreenHelp(owner, { allowed: false })).rejects.toMatchObject({ status: 503, code: "NOT_READY", message: "Screen help needs a database update first." });
    await expect(saveMyScreenHelp(ada, { off: true })).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    // The look route, from a linked Mac.
    const link = await startLink({ deviceName: "Early Mac" }, { ip: "127.0.8.1", origin: "http://localhost:3000" });
    await approveLink(ada.user, { userCode: link.userCode, orgSlug: a.slug });
    const token = (await pollLink({ deviceCode: link.deviceCode }, {}) as { token: string }).token;
    const r = await call(ada, lookPOST, "POST", "/assistant/look", { version: 1 }, { bearer: token });
    expect([r.status, r.json.code, r.json.message]).toEqual([503, "LOOK_NOT_READY", "Screen help needs a database update first."]);
    // A workspace in the pilot is created as before, with no row.
    const u = await createVerifiedUser("founder@early-co.test", "Early Founder");
    const created = await createOrganisation(u.profileId, { name: "Early Co", slug: "early-co", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    expect(created.slug).toBe("early-co");
  });

  it("0057 applies, and applies again, with no error", async () => {
    await apply0057();
    await apply0057();
    forget0057();
    expect(await count("SELECT count(*)::int AS n FROM screen_help_settings")).toBe(0);
  });
});

describe("the lazy notice and the workspace's switch (contract 0.9, D.5)", () => {
  it("the first read starts the 14 days' notice and tells owners and HR, once", async () => {
    const v = await screenHelpView(ada);
    expect(v).toMatchObject({ ready: true, eligible: true, allowed: true, available: false, reason: "notice", neverLook: [], canEdit: false });
    const days = (Date.parse(v.availableFrom as string) - Date.parse(v.noticeAt as string)) / 86_400_000;
    expect(days).toBeCloseTo(14, 3);
    for (let i = 0; i < 3; i++) await screenHelpView(owner);
    await desktopState(ada);
    const told = await adminQuery<{ recipient_membership_id: string; title: string; body: string; href: string }>(
      "SELECT recipient_membership_id, title, body, href FROM notifications WHERE type = 'brenda.screen_help_notice' ORDER BY recipient_membership_id");
    expect(told.map((n) => n.recipient_membership_id).sort()).toEqual([owner.membership.id, hr.membership.id].sort());
    const date = new Date(v.availableFrom as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });
    expect(told[0]).toMatchObject({
      title: `Screen help on Brenda for Mac starts on ${date}`,
      body: "Each person can let Brenda look at a window on their Mac when they ask her to, with her keys or her Look button. You can switch it off, or start it now, in Settings › Brenda.",
      href: "/app/company-a/settings?section=brenda",
    });
    expect(await count("SELECT count(*)::int AS n FROM screen_help_settings WHERE organisation_id = $1", [owner.org.id])).toBe(1);
  });

  it("staff and team leads cannot change it (403); members read it; a workspace outside the pilot answers 404", async () => {
    for (const c of [ada, david]) {
      const r = await call(c, settingsPUT, "PUT", "/screen-help", { allowed: false });
      expect([r.status, r.json.message]).toEqual([403, "Only the organisation owner or HR can change screen help."]);
      const g = await call(c, settingsGET, "GET", "/screen-help");
      expect(g.status).toBe(200);
      expect(g.json).toMatchObject({ ready: true, eligible: true, allowed: true, reason: "notice", canEdit: false });
    }
    process.env.BRENDA_LOOK_WORKSPACES = "someone-else";
    try {
      expect((await call(owner, settingsGET, "GET", "/screen-help")).status).toBe(404);
      expect((await call(owner, settingsPUT, "PUT", "/screen-help", { allowed: false })).status).toBe(404);
    } finally {
      process.env.BRENDA_LOOK_WORKSPACES = "company-a, early-co, fresh-co";
    }
  });

  it("owners and HR switch it, list apps (repeats dropped) and start it now; each change is logged and audited", async () => {
    const off = await call(hr, settingsPUT, "PUT", "/screen-help", { allowed: false });
    expect(off.json).toMatchObject({ allowed: false, available: false, reason: "switched_off", canEdit: true });
    const list = await call(owner, settingsPUT, "PUT", "/screen-help", { allowed: true, neverLook: [{ name: "Excel", bundleId: "com.microsoft.Excel" }, { name: "excel 2", bundleId: "COM.MICROSOFT.EXCEL" }, { name: " Notion " }] });
    expect(list.json).toMatchObject({ allowed: true, reason: "notice", neverLook: [{ name: "Excel", bundleId: "com.microsoft.Excel" }, { name: "Notion", bundleId: null }] });
    const bad = await call(owner, settingsPUT, "PUT", "/screen-help", { neverLook: [{ name: "", bundleId: null }] });
    expect(bad.status).toBe(422);
    const now = await call(owner, settingsPUT, "PUT", "/screen-help", { startNow: true });
    expect(now.json).toMatchObject({ available: true, reason: null });
    expect(Date.parse(now.json.availableFrom as string)).toBeLessThanOrEqual(Date.now() + 1000);
    // Starting it again does not move it later.
    const again = await saveScreenHelp(owner, { startNow: true });
    expect(Date.parse(again.availableFrom as string)).toBe(Date.parse(now.json.availableFrom as string));
    const logged = await adminQuery<{ summary: string }>("SELECT summary FROM brenda_actions WHERE organisation_id = $1 AND tool = 'settings' ORDER BY created_at", [owner.org.id]);
    expect(logged.map((x) => x.summary)).toEqual([
      "Screen help on Brenda for Mac: not allowed", "Screen help on Brenda for Mac: allowed", "Screen help on Brenda for Mac: never-look list changed",
      "Screen help on Brenda for Mac: started now", "Screen help on Brenda for Mac: started now",
    ]);
    expect(await count("SELECT count(*)::int AS n FROM audit_events WHERE organisation_id = $1 AND action = 'screen_help.updated'", [owner.org.id])).toBe(4); // one per save that changed something
    expect((await desktopState(ada)).look).toMatchObject({ ready: true, eligible: true, available: true, reason: null, neverLook: [{ name: "Excel", bundleId: "com.microsoft.Excel", source: "workspace" }, { name: "Notion", bundleId: null, source: "workspace" }] });
  });

  it("without Boredroom's own key it is not available ('no_key')", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect((await desktopState(ada)).look).toMatchObject({ available: false, reason: "no_key" });
    } finally {
      process.env.ANTHROPIC_API_KEY = "test-env-key-not-real";
    }
  });

  it("a workspace created while it is offered is available at once, with no notice and nobody told", async () => {
    const u = await createVerifiedUser("founder@fresh-co.test", "Fresh Founder");
    await createOrganisation(u.profileId, { name: "Fresh Co", slug: "fresh-co", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const ctx = await contextFor(u, "fresh-co");
    expect(await screenHelpView(ctx)).toMatchObject({ ready: true, eligible: true, allowed: true, available: true, reason: null });
    expect(await count("SELECT count(*)::int AS n FROM notifications WHERE organisation_id = $1 AND type = 'brenda.screen_help_notice'", [ctx.org.id])).toBe(0);
    // Its notice describes screen help; one created outside the pilot gets phase 8's text (review, 11 October 2026).
    const notice = async (slug: string) => (await adminQuery<{ t: string }>("SELECT p.notice_text AS t FROM policies p JOIN organisations o ON o.current_policy_id = p.id WHERE o.slug = $1", [slug]))[0].t;
    expect(await notice("fresh-co")).toBe(DEFAULT_NOTICE);
    const outside = await createVerifiedUser(`outside-${Date.now()}@company-x.test`, "Out Side");
    await createOrganisation(outside.profileId, { name: "Outside Co", slug: "outside-co", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    expect(await notice("outside-co")).toBe(PHASE8_DEFAULT_NOTICE);
    // early-co, created before 0057, gets its notice on its first read.
    const early = await contextFor(await earlyFounder(), "early-co");
    expect(await screenHelpView(early)).toMatchObject({ reason: "notice" });
  });
});

/** The founder of early-co (made before 0057), as a fixture user. */
async function earlyFounder() {
  const [row] = await adminQuery<{ auth_user_id: string; id: string; display_name: string }>("SELECT p.auth_user_id, p.id, p.display_name FROM profiles p JOIN auth_users u ON u.id = p.auth_user_id WHERE u.email = 'founder@early-co.test'");
  return { profileId: row.id, authUserId: row.auth_user_id, email: "founder@early-co.test", displayName: row.display_name, password: "" };
}

describe("the person's own side (contract 0.11, D.5)", () => {
  it("their never-look list and Turn off on my Macs; nothing about whether they turned it on", async () => {
    const empty = await call(ada, mineGET, "GET", "/screen-help/me");
    // Phase 3 (contract G.3): 0059 now ships in db/migrations, so the reset applies it (security audit verification,
    // 23 October 2026): the card's Mac fields are ready, with the Mac linked earlier in this file and nothing set up
    // (screen-help-mac.test.ts covers the rest).
    const noMacs = { macReady: true, macs: [], linked: [{ device: "Early Mac", lastSeenAt: expect.any(String) }], setupAt: null, impersonated: false };
    expect(empty.json).toEqual({ ready: true, neverLook: [], offAt: null, ...noMacs });
    const listed = await call(ada, minePUT, "PUT", "/screen-help/me", { neverLook: [{ name: "Preview", bundleId: "com.apple.Preview" }] });
    expect(listed.json).toEqual({ ready: true, neverLook: [{ name: "Preview", bundleId: "com.apple.Preview" }], offAt: null, ...noMacs });
    const off = await call(ada, minePUT, "PUT", "/screen-help/me", { off: true });
    expect(off.json).toMatchObject({ neverLook: [{ name: "Preview", bundleId: "com.apple.Preview" }] });
    expect(Date.parse(off.json.offAt as string)).toBeGreaterThan(Date.now() - 60_000);
    const look = (await desktopState(ada)).look;
    expect(look.offAt).toBe(off.json.offAt);
    expect(look.neverLook).toContainEqual({ name: "Preview", bundleId: "com.apple.Preview", source: "you" });
    // Someone else's list is theirs: David sees none of Ada's.
    expect((await desktopState(david)).look.neverLook.filter((r) => r.source === "you")).toEqual([]);
    // The columns are the only screen help state about her (no opt-in, no use).
    const cols = await adminQuery<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'assistant_private' AND column_name LIKE 'screen_help%' ORDER BY 1");
    // 0059 (applied by the reset since it moved to db/migrations) adds the Mac state and the Set up time.
    expect(cols.map((c) => c.column_name)).toEqual(["screen_help_macs", "screen_help_never_look", "screen_help_off_at", "screen_help_setup_at"]);
  });

  it("refused while someone else is signed in as the person", async () => {
    const as = { ...ada, user: { ...ada.user, impersonation: { id: "00000000-0000-4000-8000-0000000000ae", adminEmail: "support@boredroom.test" } } };
    await expect(saveMyScreenHelp(as, { off: true })).rejects.toMatchObject({ status: 403 });
  });
});

describe("row-level security (contract D.2)", () => {
  it("staff cannot change or create the workspace's row; owners can", async () => {
    const upd = await appQueryAs(ada.user.profileId, "UPDATE screen_help_settings SET allowed = false WHERE organisation_id = $1 RETURNING organisation_id", [owner.org.id]);
    expect(upd).toEqual([]);
    await expect(appQueryAs(ada.user.profileId, "INSERT INTO screen_help_settings(organisation_id) VALUES ($1)", [owner.org.id])).rejects.toThrow();
    await expect(appQueryAs(owner.user.profileId, "DELETE FROM screen_help_settings WHERE organisation_id = $1", [owner.org.id])).rejects.toThrow();
    expect(await appQueryAs(ada.user.profileId, "SELECT allowed FROM screen_help_settings WHERE organisation_id = $1", [owner.org.id])).toEqual([{ allowed: true }]);
    expect(await appQueryAs(owner.user.profileId, "UPDATE screen_help_settings SET allowed = true WHERE organisation_id = $1 RETURNING organisation_id", [owner.org.id])).toHaveLength(1);
  });

  it("another workspace's members read nothing of it", async () => {
    const b = await buildCompany("b");
    expect(await appQueryAs(b.owner.profileId, "SELECT * FROM screen_help_settings WHERE organisation_id = $1", [owner.org.id])).toEqual([]);
  });

  it("nobody but the worker reads or writes the look costs", async () => {
    await recordLookUsage({ model: "claude-look-test", usage: { input_tokens: 10 }, imageTokens: 2, first: true });
    expect(await count("SELECT count(*)::int AS n FROM look_usage_daily")).toBe(1);
    for (const c of [owner, hr, ada]) expect(await appQueryAs(c.user.profileId, "SELECT * FROM look_usage_daily")).toEqual([]);
    await expect(appQueryAs(owner.user.profileId, "INSERT INTO look_usage_daily(day, model) VALUES (current_date, 'x')")).rejects.toThrow();
  });

  it("an owner or HR cannot read a member's screen help columns", async () => {
    for (const c of [owner, hr, david]) {
      expect(await appQueryAs(c.user.profileId, "SELECT screen_help_never_look, screen_help_off_at FROM assistant_private WHERE membership_id = $1", [ada.membership.id])).toEqual([]);
    }
    expect(await appQueryAs(ada.user.profileId, "SELECT screen_help_never_look FROM assistant_private WHERE membership_id = $1", [ada.membership.id])).toHaveLength(1);
  });
});

describe("Settings › Brenda's log (contract D.8)", () => {
  it("the viewer's own rows read in their own words; everyone else's in the generic words", async () => {
    await adminQuery(`INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES
      ($1, $2, 'remind_me', 'Set a reminder', 'done', 'chat', '{"personalSummary": "Reminder set for Fri 17:00: call the bank"}'::jsonb)`, [owner.org.id, ada.membership.id]);
    const ownerView = await brendaOverview(owner);
    expect(ownerView.actions.find((x) => x.tool === "remind_me")?.summary).toBe("Set a reminder");
    const adaView = await brendaOverview(ada);
    expect(adaView.actions.find((x) => x.tool === "remind_me")?.summary).toBe("Reminder set for Fri 17:00: call the bank");
    expect(ownerView.actions[0]).not.toHaveProperty("personal_summary");
    expect(ownerView.actions[0]).not.toHaveProperty("mine");
  });
});
