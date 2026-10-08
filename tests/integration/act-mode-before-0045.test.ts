/**
 * Before migration 0045 (owner decision, 8 October 2026: act without asking): the code ships before the database update
 * (a deploy, the running dev server), so everyone's assistant asks exactly as before, the saves say they need the update,
 * Undo still works for everything that does not need 0045, and nothing that reads the mode throws. Then 0045 is applied
 * twice by hand: no error, and the switches default as specified. The test schema is built from every migration before
 * 0045.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { assistantProfiles, saveMyAssistant } from "@/server/services/assistant-profile";
import { actModeFor, saveActMode, saveWorkspaceActSetting, workspaceActSetting, workspaceActSettingFor } from "@/server/services/act-mode";
import { runBrendaTool, type Proposal } from "@/server/services/copilot";
import { undoAction, undoOffer } from "@/server/services/undo";
import { sendAssistantItem, unsendAssistantMessage } from "@/server/services/assistant-items";
import { desktopState } from "@/server/services/desktop";
import { listActivity } from "@/server/services/assistant-activity";
import { brendaOverview } from "@/server/services/brenda";
import { forget0045, schema0045Ready } from "@/server/lib/schema-0045";
import { withUser } from "@/server/db";
import { ASK_STATE } from "@/lib/act-mode";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, olu: OrgContext, ben: OrgContext;
const id = (c: OrgContext) => c.membership.id;
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const MIGRATION = join(process.cwd(), "db", "migrations", "0045_act_without_asking.sql");

/** As resetTestDatabase, but stopping before 0045. */
async function schemaBefore0045() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0045").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0045() {
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
  await schemaBefore0045();
  expect(await adminQuery("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'assistant_profiles'::regclass AND attname = 'act_mode') AS has")).toEqual([{ has: false }]);
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
});

describe("before 0045 everyone asks, as before", () => {
  it("every read of the mode is ASK_STATE, and none throws", async () => {
    expect(await actModeFor(olu)).toEqual(ASK_STATE);
    const profiles = await assistantProfiles(olu);
    expect(profiles.act).toEqual(ASK_STATE);
    expect(profiles.personal.name).toBe("Max");
    expect((await desktopState(olu)).assistant.act).toEqual(ASK_STATE);
    expect((await desktopState(olu)).assistant.act.ready).toBe(false);
    expect(await workspaceActSettingFor(owner)).toEqual({ ready: false, allowed: true });
    expect(await withUser(ben.user.profileId, (db) => workspaceActSetting(db, ben.org.id))).toEqual({ ready: false, allowed: true });
    // The Settings and Activity reads that now carry the marker still work.
    await expect(listActivity(olu)).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(brendaOverview(owner)).resolves.toMatchObject({ actions: expect.any(Array) });
  });

  it("the saves say they need the update", async () => {
    await expect(saveActMode(olu, "auto")).rejects.toMatchObject({ status: 503, code: "NOT_READY", message: "Acting without asking needs a database update first." });
    await expect(saveActMode(olu, "ask")).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    await expect(saveWorkspaceActSetting(owner, false)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
  });

  it("her chat prepares a Confirm, with no 'Still asking' line", async () => {
    const r = await runBrendaTool(olu, "send_message", { to: "Ben Okafor", body: "Before the update" }, "chat", { act: "read" });
    const c = confirmOf(r.proposals);
    expect(c).toBeTruthy();
    expect(c?.why).toBeUndefined();
    expect(r.actions).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM messages WHERE body = 'Before the update'")).toEqual([]);
  });

  it("Undo of an own to-do works; a message to an assistant can't be withdrawn yet (and stays undoable later)", async () => {
    const r = await runBrendaTool(olu, "create_todos", { items: [{ title: "Before 0045 to-do" }] }, "chat", { act: "read" });
    const token = r.actions[0]?.undo?.token;
    expect(token).toEqual(expect.any(String));
    expect(await undoAction(olu, token!)).toEqual({ undone: true, summary: "Removed the to-do" });
    expect(await adminQuery("SELECT archived_at IS NOT NULL AS archived FROM tasks WHERE title = 'Before 0045 to-do'")).toEqual([{ archived: true }]);

    const item = await sendAssistantItem(olu, { kind: "message", recipientMembershipId: id(ben), body: "Before the update" });
    await expect(unsendAssistantMessage(olu, item.id)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    const offer = undoOffer(olu, { kind: "assistant_message", itemId: item.id }, "Passed your message to Ben's Brenda");
    await expect(undoAction(olu, offer!.token)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    // Nothing was undone, so the claim was given back: the same answer, never "already undone".
    await expect(undoAction(olu, offer!.token)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    expect(await adminQuery("SELECT status FROM assistant_items WHERE id = $1", [item.id])).toEqual([{ status: "delivered" }]);
  });
});

describe("applying 0045", () => {
  it("runs twice without an error, and the switches default as specified", async () => {
    await apply0045();
    await apply0045();
    forget0045();
    expect(await withUser(olu.user.profileId, (db) => schema0045Ready(db))).toBe(true);
    expect(await adminQuery("SELECT DISTINCT act_mode FROM assistant_profiles")).toEqual([{ act_mode: "ask" }]);
    expect(await adminQuery("SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'assistant_profiles' AND column_name = 'act_mode'"))
      .toEqual([{ column_default: "'ask'::text", is_nullable: "NO" }]);
    expect(await adminQuery("SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'brenda_settings' AND column_name = 'allow_auto_act'"))
      .toEqual([{ column_default: "true", is_nullable: "NO" }]);
    // One check constraint each, not two.
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('assistant_profiles_act_mode_check', 'assistant_items_status_kind_check')")).toEqual([{ n: 2 }]);
    await expect(adminQuery("UPDATE assistant_profiles SET act_mode = 'always'")).rejects.toThrow(/assistant_profiles_act_mode_check/);

    expect(await actModeFor(olu)).toEqual({ ready: true, mode: "ask", allowed: true, effective: "ask", locked: null });
    expect(await workspaceActSettingFor(owner)).toEqual({ ready: true, allowed: true });
    expect(await saveActMode(olu, "auto")).toMatchObject({ mode: "auto", effective: "auto" });
    // The message passed before the update can be withdrawn now, by its sender (it is still under 10 minutes old).
    const [item] = await adminQuery<{ id: string }>("SELECT id FROM assistant_items WHERE kind = 'message' AND sender_membership_id = $1", [id(olu)]);
    expect(await unsendAssistantMessage(olu, item.id)).toMatchObject({ status: "withdrawn" });
  });
});
