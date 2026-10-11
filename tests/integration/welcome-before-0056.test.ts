/**
 * Before migration 0056 (owner request, 11 October 2026: the first-run welcome): the code ships before the database update
 * (a deploy, the running dev server on the real database), so every surface falls back as contract 8.3 says and nothing
 * throws: the state reads as not ready with "done" taken from the assistant's setup, the gate never fires, Next steps
 * never shows, progress writes answer 503, finishing marks the assistant's setup done, the page's facts still read, joins
 * still notify, and the fixtures mark nothing. Then 0056 is applied by hand twice: no error, every member from before it
 * is marked 'existing' (keeping a chosen look's time), one check constraint, the two self-join policies replaced, and once
 * the cache is forgotten everything reads as ready.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { joinWithCode, updateJoinCode } from "@/server/services/orgs";
import { assistantProfiles, saveMyAssistant } from "@/server/services/assistant-profile";
import { forget0056, schema0056Ready } from "@/server/lib/schema-0056";
import { withSystem } from "@/server/db";
import { finishWelcome, markWelcome, nextStepsFor, welcomeGatePath, welcomeReady, welcomeState, welcomeView } from "@/server/services/welcome";
import { WELCOME_NOT_READY, WELCOME_WORDS } from "@/lib/welcome";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ELEVENLABS_API_KEY;

const MIGRATION = join(process.cwd(), "db", "migrations", "0056_welcome.sql");
let a: CompanyFixture;
let ada: OrgContext;   // joined before 0056, nothing chosen
let max: OrgContext;   // joined before 0056, chose a look ("Max") through the old dialog
const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { status?: number; code?: string; message?: string }; } };

/** As resetTestDatabase, but stopping before 0056. */
async function schemaBefore0056() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0056").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
/** A member who joined after 0056 was applied (the last tests). */
let nu: Awaited<ReturnType<typeof joinViaInvitation>>;

async function apply0056() {
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
  await schemaBefore0056();
  forget0056();
  expect(await adminQuery(`SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'assistant_private'::regclass AND attname = 'welcome_done_at' AND NOT attisdropped) AS has`)).toEqual([{ has: false }]);
  a = await buildCompany("a");
  ada = await joinViaInvitation(a.hrCtx, await createVerifiedUser("ada.obi@company-a.test", "Ada Obi"), "employee", a.teamId, "EMP-101");
  max = await joinViaInvitation(a.hrCtx, await createVerifiedUser("max@company-a.test", "Mo Max"), "employee", a.teamId, "EMP-102");
  await saveMyAssistant(max, { name: "Max", colour: "teal", visor: "band", eyes: "round" });
});

describe("before 0056 every surface falls back, and nothing throws", () => {
  it("is not ready", async () => {
    expect(await welcomeReady()).toBe(false);
    expect(await withSystem((db) => schema0056Ready(db))).toBe(false);
  });

  it("reads the state as not ready, done when the assistant's setup is done", async () => {
    expect(await welcomeState(ada)).toEqual({ ...WELCOME_NOT_READY, done: false });
    expect(await welcomeState(max)).toEqual({ ...WELCOME_NOT_READY, done: true });
  });

  it("never gates, and never shows Next steps", async () => {
    expect(await welcomeGatePath(ada)).toBeNull();
    expect(await welcomeGatePath(a.ownerCtx)).toBeNull();
    expect(await nextStepsFor(ada)).toBeNull();
    expect(await nextStepsFor(max)).toBeNull();
  });

  it("refuses progress with a plain 503", async () => {
    expect(await rejects(markWelcome(ada, { seen: true }))).toMatchObject({ status: 503, code: "NOT_READY", message: WELCOME_WORDS.errors.notReady });
    expect(await rejects(markWelcome(ada, { nextStepsHidden: true }))).toMatchObject({ status: 503 });
  });

  it("still reads everything the page shows", async () => {
    const v = await welcomeView(ada, { replay: true });
    expect(v.state).toEqual({ ...WELCOME_NOT_READY, done: false });
    expect(v.replay).toBe(false);
    expect(v.leadFirstName).toBe("David");
    expect(v.notice).toMatchObject({ standard: true, outdated: false });
    expect((await welcomeView(a.ownerCtx, { replay: false })).team?.invitations).toBeGreaterThan(0);
  });

  it("finishing marks the assistant's setup done, so the old dialog never follows", async () => {
    expect((await assistantProfiles(ada)).setupDone).toBe(false);
    expect(await finishWelcome(ada, { outcome: "skipped", skipped: ["you"] })).toEqual({ ...WELCOME_NOT_READY, done: true });
    expect((await assistantProfiles(ada)).setupDone).toBe(true);
    expect(await welcomeState(ada)).toEqual({ ...WELCOME_NOT_READY, done: true });
    // The look is kept as it was.
    expect((await assistantProfiles(max)).personal.name).toBe("Max");
    expect(await finishWelcome(max, { outcome: "done" })).toEqual({ ...WELCOME_NOT_READY, done: true });
    expect((await assistantProfiles(max)).personal).toEqual({ name: "Max", colour: "teal", visor: "band", eyes: "round" });
    expect(await adminQuery(`SELECT count(*)::int AS n FROM platform_events WHERE type = 'WELCOME_FINISHED'`)).toEqual([{ n: 0 }]);
  });

  it("still joins by code and notifies, with the old policies", async () => {
    const code = await updateJoinCode(a.ownerCtx, { enabled: true, role: "manager", teamId: a.teamId, rotate: true });
    const lead = await createVerifiedUser("lead@company-a.test", "Lara Lead");
    const joined = await joinWithCode(lead.profileId, code.join_code!);
    expect(await adminQuery(`SELECT is_manager FROM team_members WHERE membership_id = $1`, [joined.membershipId])).toEqual([{ is_manager: true }]);
    expect((await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE type = 'member.joined' AND resource_id = $1`, [joined.membershipId]))[0].n).toBeGreaterThan(0);
    await updateJoinCode(a.ownerCtx, { enabled: false });
  });

  it("the fixtures marked nothing (there is nothing to mark)", async () => {
    expect(await adminQuery(`SELECT count(*)::int AS n FROM assistant_private`)).toEqual([{ n: 0 }]);
  });
});

describe("applying 0056", () => {
  it("runs twice without error and marks every member from before it as done", async () => {
    // A row that exists before 0056 (quiet hours) keeps its values.
    await adminQuery(`INSERT INTO assistant_private(membership_id, organisation_id, timezone) VALUES ($1, $2, 'Europe/London')`, [a.employee2Ctx.membership.id, a.ownerCtx.org.id]);
    await apply0056();
    await apply0056();
    const members = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM memberships`);
    const marked = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM assistant_private WHERE welcome_outcome = 'existing' AND welcome_done_at IS NOT NULL`);
    expect(marked[0].n).toBe(members[0].n);
    expect(await adminQuery(`SELECT timezone, welcome_outcome, welcome_shown, welcome_skipped FROM assistant_private WHERE membership_id = $1`, [a.employee2Ctx.membership.id]))
      .toEqual([{ timezone: "Europe/London", welcome_outcome: "existing", welcome_shown: 0, welcome_skipped: [] }]);
    // Someone who chose a look through the old dialog is done from that time.
    expect(await adminQuery(`SELECT q.welcome_done_at = p.setup_done_at AS same FROM assistant_private q JOIN assistant_profiles p USING (membership_id) WHERE membership_id = $1`, [max.membership.id]))
      .toEqual([{ same: true }]);
  });

  it("adds one check constraint and replaces the two self-join policies", async () => {
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'assistant_private'::regclass AND conname = 'assistant_private_welcome_check'`)).toEqual([{ n: 1 }]);
    const policies = await adminQuery<{ policyname: string; with_check: string }>(
      `SELECT policyname, with_check FROM pg_policies WHERE tablename = 'team_members' AND policyname IN ('team_members_join_code', 'team_members_self_join') ORDER BY policyname`);
    expect(policies.map((p) => p.policyname)).toEqual(["team_members_join_code", "team_members_self_join"]);
    expect(policies[0].with_check).toMatch(/join_code_role = 'manager'/);
    expect(policies[1].with_check).toMatch(/i\.role = 'manager'/);
    for (const bad of ["UPDATE assistant_private SET welcome_step = 'nope' WHERE membership_id = $1", "UPDATE assistant_private SET welcome_outcome = NULL WHERE membership_id = $1",
      "UPDATE assistant_private SET welcome_skipped = '{you,brenda}' WHERE membership_id = $1", "UPDATE assistant_private SET welcome_shown = 100 WHERE membership_id = $1"]) {
      await expect(adminQuery(bad, [a.employee2Ctx.membership.id]), bad).rejects.toThrow(/assistant_private_welcome_check/);
    }
  });

  it("reads as ready once the cache forgets, and everyone from before is done", async () => {
    forget0056();
    expect(await welcomeReady()).toBe(true);
    expect(await welcomeState(ada)).toMatchObject({ ready: true, done: true, outcome: "existing" });
    expect(await welcomeGatePath(ada)).toBeNull();
    expect(await nextStepsFor(ada)).toBeNull();
    // A member who joins now is new.
    nu = await joinViaInvitation(a.hrCtx, await createVerifiedUser("new@company-a.test", "Nia New"), "employee", null, "EMP-199");
    expect(await welcomeState(nu)).toMatchObject({ ready: true, done: false, shown: 0 });
    expect(await welcomeGatePath(nu)).toBe("/app/company-a/welcome?auto=1");
    expect((await markWelcome(nu, { seen: true })).shown).toBe(1);
  });

  it("run again by hand, never marks anyone who joined since, or anyone part-way through, as done (review, 11 October 2026)", async () => {
    await markWelcome(nu, { step: "assistant" });
    const later = await joinViaInvitation(a.hrCtx, await createVerifiedUser("later@company-a.test", "Lara Later"), "employee", null, "EMP-198");
    await apply0056();
    forget0056();
    expect(await welcomeState(nu)).toMatchObject({ ready: true, done: false, outcome: null, step: "assistant", shown: 1 });
    expect(await welcomeState(later)).toMatchObject({ ready: true, done: false, outcome: null });
    expect(await welcomeState(ada)).toMatchObject({ done: true, outcome: "existing" });
  });
});
