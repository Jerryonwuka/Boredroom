/**
 * Before migration 0050 (owner decisions, 8–9 October 2026: phase 7c): the code ships before the database update (a
 * deploy, the running dev server), so standups, the abilities lists and preferences are absent and say so, nothing that
 * reads them throws, every ability built so far stays on, and the private decline labels are already enforced in the
 * label query (0048's policy still lets every reader of the conversation read a decline). Every row of the contract's
 * A.3 table is checked. Then 0050 is applied twice by hand: no error, one of each object, the defaults as specified, and
 * the phase working. The test schema is built from every migration before 0050.
 *
 * Local test database only (TEST_DATABASE_URL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant, assistantProfiles } from "@/server/services/assistant-profile";
import { openChannel, sendMessage, thread } from "@/server/services/messaging";
import { desktopState } from "@/server/services/desktop";
import { withUser, withWorker } from "@/server/db";
import { forget0050, schema0050Ready } from "@/server/lib/schema-0050";
import * as S from "@/server/services/standup";
import * as A from "@/server/services/abilities";
import * as P from "@/server/services/preferences";
import * as C from "@/server/services/commitments";
import * as R from "@/server/services/routines";
import * as LE from "@/server/services/loose-ends";
import { openerOn } from "@/server/services/opener";
import { STANDUP_NOT_READY, STANDUP_NOT_READY_SHORT } from "@/lib/standup";
import { ABILITIES_NOT_READY_SHORT, ABILITY_KEYS } from "@/lib/abilities";
import { PREFERENCES_NOT_READY, PREFERENCES_NOT_READY_SHORT } from "@/lib/preferences";
import type { DetectedCommitment } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext;
let design: string, declinedOk: string;
const id = (c: OrgContext) => c.membership.id;
const MIGRATION = join(process.cwd(), "db", "migrations", "0050_standup_abilities_preferences.sql");
const SOME_ID = "11111111-1111-4111-8111-111111111111";
const standupNotReady = { status: 503, code: "NOT_READY", message: STANDUP_NOT_READY_SHORT };

/** As resetTestDatabase, but stopping before 0050. */
async function schemaBefore0050() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0050").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0050() {
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
  await schemaBefore0050();
  forget0050();
  expect(await adminQuery("SELECT to_regclass('public.team_standups') IS NULL AS missing")).toEqual([{ missing: true }]);
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = a.teamId;
  olu = await joinViaInvitation(a.hrCtx, await createVerifiedUser("olu@company-a.test", "Olu Ade"), "employee", design, "EMP-003");
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  // A declined agreed ask in a tracked #Design (Ada asked Ben; Ben declined): 0048's policy lets every reader read it.
  await C.saveCommitmentSettings(owner, { track: true });
  const conv = await openChannel(david, design);
  const ask = (await sendMessage(ada, { conversationId: conv, body: "Ben, can you share the fonts?" }, { startMention: false })).id;
  declinedOk = (await sendMessage(ben, { conversationId: conv, body: "On it", replyToId: ask }, { startMention: false })).id;
  const det: DetectedCommitment = { conversationId: conv, sourceMessageId: ask, agreementMessageId: declinedOk, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Share the fonts", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() };
  const cid = (await C.insertDetectedCommitments(owner.org.id, [det])).created[0];
  await C.declineCommitment(ben, cid, "Not mine");
  design = conv; // from here on, the channel
});

describe("before 0050, standups are absent and say so", () => {
  it("the readiness check says not yet", async () => {
    expect(await withUser(ada.user.profileId, (db) => schema0050Ready(db))).toBe(false);
  });

  it("team settings read off, ready false; a change answers 503", async () => {
    expect(await S.standupSettings(david, a.teamId)).toMatchObject({ ready: false, enabled: false, time: "09:30", cutoff: "12:00", days: [1, 2, 3, 4, 5], canEdit: true, offered: true, leads: ["David Lead"], noLead: false });
    await expect(S.saveStandupSettings(david, a.teamId, { enabled: true })).rejects.toMatchObject(standupNotReady);
  });

  it("the reads are empty and never throw; every change answers 503", async () => {
    expect(await S.standupToday(ada)).toEqual({ ready: false, off: false, entries: [], rollups: [] });
    expect(await S.standupForDesktop(ada)).toEqual({ ready: false, entries: [], rollups: [] });
    expect(await S.getStandupEntry(ada, SOME_ID)).toBeNull();
    expect(await S.standupForReport(david, "2026-10-09")).toBeNull();
    await expect(S.getStandupRollup(david, SOME_ID)).rejects.toMatchObject(standupNotReady);
    await expect(S.editStandup(ada, SOME_ID, { today: "x" })).rejects.toMatchObject(standupNotReady);
    await expect(S.postStandup(ada, SOME_ID)).rejects.toMatchObject(standupNotReady);
    await expect(S.skipStandup(ada, SOME_ID)).rejects.toMatchObject(standupNotReady);
    await expect(S.unskipStandup(ada, SOME_ID)).rejects.toMatchObject(standupNotReady);
    await expect(S.markStandupSeen(ada, SOME_ID)).rejects.toMatchObject(standupNotReady);
    await expect(S.markRollupSeen(david, SOME_ID)).rejects.toMatchObject(standupNotReady);
    expect((await desktopState(ada)).standup).toEqual({ ready: false, entries: [], rollups: [] });
  });

  it("the worker's side returns at once and writes nothing", async () => {
    expect(await S.openStandupDay(a.teamId, "2026-10-09", new Date())).toEqual({ status: "off", entryIds: [], rollupId: null });
    expect(await S.claimStandupDraft(SOME_ID)).toEqual({ skip: "not_ready" });
    expect(await S.rollupInput(SOME_ID)).toEqual({ skip: "not_ready" });
    expect(await S.saveStandupDraft(SOME_ID, { draft: { v: 1, sinceLabel: "Yesterday", dateLabel: "x", engine: "template", sections: { yesterday: [], today: [], blocked: [] } }, texts: { yesterday: "", today: "", blocked: "" }, blockers: [], engine: "template", usedModel: false })).toEqual({ delivery: "none" });
    await S.failStandupDraft(SOME_ID, "x");
    await S.cancelStandupDay(a.teamId, "2026-10-09");
    expect(await S.sendRollup(SOME_ID, {} as never)).toEqual({ notified: 0, held: 0 });
    expect(await S.sweepStandups()).toEqual({ opened: 0, toDraft: [], rollupsDue: [], released: 0, lateNoted: 0, missed: 0, cancelled: 0 });
    expect(await S.standupDaysDue()).toEqual([]);
    expect(await S.standupRollupsDue()).toEqual([]);
    expect(await S.standupSweepDue()).toBe(false);
  });
});

describe("before 0050, abilities read on and cannot change", () => {
  it("every ability on (today's behaviour), ready false; the existing switches as they are", async () => {
    expect(await A.abilitiesFor(olu)).toEqual({ ready: false, workspaceOff: [], personalOff: [] });
    expect(await withUser(olu.user.profileId, (db) => A.abilitiesIn(db, olu.org.id, id(olu)))).toEqual({ ready: false, workspaceOff: [], personalOff: [] });
    const v = await A.abilitiesView(olu);
    expect(v.ready).toBe(false);
    expect(v.cards.map((c) => c.key)).toEqual([...ABILITY_KEYS]);
    for (const c of v.cards.filter((x) => x.workspace.kind === "switch")) expect(c.workspace).toEqual({ kind: "switch", offered: true });
    expect(v.cards.find((c) => c.key === "commitments")).toMatchObject({ state: "On", effective: true });
    expect(v.cards.find((c) => c.key === "standup")).toMatchObject({ state: "Needs a database update", effective: false });
    await A.requireAbility(olu, "catch_up");
  });

  it("both switches answer 503", async () => {
    await expect(A.savePersonalAbility(olu, { key: "catch_up", on: false })).rejects.toMatchObject({ status: 503, code: "NOT_READY", message: ABILITIES_NOT_READY_SHORT });
    await expect(A.saveWorkspaceAbility(owner, { key: "catch_up", offered: false })).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
  });

  it("nothing is ever off: the opener, voice, loose ends, routines, mentions", async () => {
    expect(await openerOn(olu)).toBe(true);
    const p = await assistantProfiles(olu);
    expect(p.voice).toBeUndefined();
    expect((await desktopState(olu)).assistant).toMatchObject({ voice: true });
    expect((await desktopState(olu)).abilities).toEqual({ off: [] });
    expect((await LE.listLooseEnds(olu)).off).toBeNull();
    const list = await R.listRoutines(olu);
    expect(list).toMatchObject({ ready: true, off: null, unavailableBecause: {} });
    expect(list.unavailable).toEqual([]);
    expect((await thread(olu, design))!.ownAssistantOff).toBe(false);
  });
});

describe("before 0050, preferences are absent and say so", () => {
  it("the list is empty, ready false; every change answers 503; nothing reaches the model", async () => {
    expect(await P.listPreferences(ada)).toEqual({ ready: false, hidden: false, items: [], max: 16 });
    await expect(P.addPreference(ada, "Keep replies short.")).rejects.toMatchObject({ status: 503, code: "NOT_READY", message: PREFERENCES_NOT_READY_SHORT });
    await expect(P.updatePreference(ada, SOME_ID, "x")).rejects.toMatchObject({ status: 503 });
    await expect(P.deletePreference(ada, SOME_ID)).rejects.toMatchObject({ status: 503 });
    expect(await P.preferencesForModel(ada)).toEqual([]);
    expect(await withWorker((db) => P.preferencesForWorker(db, id(ada)))).toEqual([]);
  });
});

describe("before 0050, the decline is already private in the label query", () => {
  it("0048's policy lets David read the row, the label query does not; Ada and Ben still read Declined", async () => {
    expect(await appQueryAs(a.manager.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [declinedOk])).toEqual([{ state: "declined" }]);
    expect((await thread(david, design))!.messages.find((m) => m.id === declinedOk)!.commitment_label).toBeNull();
    expect((await thread(olu, design))!.messages.find((m) => m.id === declinedOk)!.commitment_label).toBeNull();
    expect((await thread(ada, design))!.messages.find((m) => m.id === declinedOk)!.commitment_label).toEqual({ state: "declined", text: "Declined", private: true, other: "Ben" });
    expect((await thread(ben, design))!.messages.find((m) => m.id === declinedOk)!.commitment_label).toEqual({ state: "declined", text: "Declined", private: true, other: "Ada" });
  });
});

describe("before 0050, the rest of the phase (brain's surfaces) says so too", () => {
  it("her standup and preference tools answer the not-ready words", async () => {
    const { runBrendaTool } = await import("@/server/services/copilot");
    const tools: [string, Record<string, unknown>, string][] = [
      ["standup", {}, STANDUP_NOT_READY],
      ["standup_action", { entryId: SOME_ID, action: "skip" }, STANDUP_NOT_READY],
      ["remember_preference", { text: "Keep replies short" }, PREFERENCES_NOT_READY],
      ["forget_preference", { words: "short" }, PREFERENCES_NOT_READY],
    ];
    for (const [name, input, words] of tools) {
      const r = await runBrendaTool(ada, name, input, "chat", { act: "read", userWords: ["Remember that I like replies short", "Keep replies short"] });
      expect({ name, out: r.out }).toEqual({ name, out: { error: words } });
      expect(r.proposals).toEqual([]);
    }
  });

  it("the scheduler and the handlers return at once; the report has no Standup section", async () => {
    const { scheduleStandups } = await import("../../worker/schedule");
    expect(await scheduleStandups(new Date())).toEqual({ opens: 0, rollups: 0, sweep: false });
    const { handlers } = await import("../../worker/handlers");
    for (const t of ["standup.open", "standup.draft", "standup.rollup", "standup.sweep"]) {
      await handlers[t]({ teamId: a.teamId, localDate: "2026-10-09", entryId: SOME_ID, rollupId: SOME_ID }, { jobId: SOME_ID, attempt: 1 });
    }
    expect(await adminQuery("SELECT count(*)::int AS n FROM jobs WHERE type LIKE 'standup.%'")).toEqual([{ n: 0 }]);
    const { buildDailyReport } = await import("@/server/services/daily-report");
    const report = await buildDailyReport(david, { useAssistant: false });
    expect(report.standup ?? null).toBeNull();
  });
});

describe("then 0050, applied twice by hand", () => {
  it("applies without error, one of each object, the defaults as specified, and the phase working", async () => {
    await apply0050();
    await apply0050();
    forget0050();
    expect(await withWorker((db) => schema0050Ready(db))).toBe(true);
    const tables = await adminQuery<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind = 'r' AND c.relname IN ('team_standups', 'standup_rollups', 'standup_rollup_recipients', 'standup_entries', 'assistant_preferences') ORDER BY 1`);
    expect(tables.map((r) => r.t)).toEqual(["assistant_preferences", "standup_entries", "standup_rollup_recipients", "standup_rollups", "team_standups"]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('team_standups_updated', 'team_standups_guard', 'standup_rollups_updated', 'standup_rollups_notify',
      'standup_entries_updated', 'standup_entries_guard', 'standup_entries_notify', 'assistant_preferences_updated', 'assistant_preferences_guard')`)).toEqual([{ n: 9 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'team_standups_notify'")).toEqual([{ n: 0 }]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('app_standup_can_manage', 'app_standup_rollup_seen', 'app_standup_edit', 'app_standup_skip',
      'app_standup_unskip', 'app_standup_seen', 'app_standup_post_check', 'app_standup_mark_posted', 'app_label_party', 'team_standups_guard', 'standup_entries_guard', 'assistant_preferences_guard')`)).toEqual([{ n: 12 }]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_policy WHERE polname = 'message_labels_select'`)).toEqual([{ n: 1 }]);
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('ai_usage_purpose_check', 'assistant_mention_private_note_check',
      'brenda_settings_abilities_off_check', 'assistant_private_abilities_off_check')`)).toEqual([{ n: 4 }]);
    expect(await adminQuery(`SELECT table_name, column_default FROM information_schema.columns WHERE column_name = 'abilities_off' ORDER BY table_name`))
      .toEqual([{ table_name: "assistant_private", column_default: "'{}'::text[]" }, { table_name: "brenda_settings", column_default: "'{}'::text[]" }]);
    expect(await adminQuery(`SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'team_standups' AND column_name IN ('enabled', 'post_time', 'cutoff_time', 'days') ORDER BY column_name`))
      .toEqual([
        { column_name: "cutoff_time", column_default: "'12:00:00'::time without time zone" },
        { column_name: "days", column_default: "'{1,2,3,4,5}'::smallint[]" },
        { column_name: "enabled", column_default: "false" },
        { column_name: "post_time", column_default: "'09:30:00'::time without time zone" },
      ]);
    expect(await adminQuery("SELECT DISTINCT abilities_off FROM brenda_settings")).toEqual([{ abilities_off: [] }]);
    // The replaced objects keep their old meaning plus the change.
    for (const purpose of ["mention", "commitments", "loose_ends", "standup"]) {
      await expect(adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, NULL, $2, 'm')", [owner.org.id, purpose])).resolves.toBeDefined();
    }
    await expect(adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, NULL, 'nonsense', 'm')", [owner.org.id])).rejects.toThrow(/ai_usage_purpose_check/);
    expect(await appQueryAs(a.employee.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [declinedOk])).toEqual([{ state: "declined" }]);
    expect(await appQueryAs(a.manager.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [declinedOk])).toEqual([]);
    // The phase works: abilities and preferences save, a team's standup switches on.
    expect((await A.abilitiesFor(olu)).ready).toBe(true);
    await A.savePersonalAbility(olu, { key: "catch_up", on: false });
    expect((await A.abilitiesFor(olu)).personalOff).toEqual(["catch_up"]);
    expect((await P.addPreference(ada, "Keep replies short.")).body).toBe("Keep replies short.");
    expect(await S.saveStandupSettings(david, a.teamId, { enabled: true })).toMatchObject({ ready: true, enabled: true });
  });
});
