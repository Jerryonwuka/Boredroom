/**
 * Before migration 0048 (owner decisions, 8 October 2026: phase 7b): the code ships before the database update (a
 * deploy, the running dev server), so loose ends, commitments, blocked on whom and the re-plan are absent and say so,
 * nothing that reads them throws, and what needs no new schema works as before (a thread, Mark blocked, the notch, the
 * daily report, routines). Every surface of the contract's A.2 table answers as stated. Then 0048 is applied twice by
 * hand: no error, and the switches default as specified. The test schema is built from every migration before 0048.
 *
 * Local test database only (TEST_DATABASE_URL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { openChannel, openDirect, sendMessage, thread } from "@/server/services/messaging";
import { updateTask } from "@/server/services/tasks";
import { desktopState } from "@/server/services/desktop";
import { withUser, withWorker } from "@/server/db";
import { forget0048, schema0048Ready } from "@/server/lib/schema-0048";
import * as C from "@/server/services/commitments";
import * as LE from "@/server/services/loose-ends";
import * as B from "@/server/services/task-blocks";
import * as RP from "@/server/services/replans";
import { LOOPS_NOT_READY, LOOPS_NOT_READY_SHORT } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string, someMessage: string;
const id = (c: OrgContext) => c.membership.id;
const MIGRATION = join(process.cwd(), "db", "migrations", "0048_loops_closed.sql");
const SOME_ID = "11111111-1111-4111-8111-111111111111";
const notReady = { status: 503, code: "NOT_READY", message: LOOPS_NOT_READY_SHORT };

/** As resetTestDatabase, but stopping before 0048. */
async function schemaBefore0048() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0048").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0048() {
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
  await schemaBefore0048();
  forget0048();
  expect(await adminQuery("SELECT to_regclass('public.commitments') IS NULL AS missing")).toEqual([{ missing: true }]);
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(ada, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
  someMessage = (await sendMessage(ben, { conversationId: design, body: "I'll send the deck Thursday" }, { startMention: false })).id;
});

describe("before 0048 loose ends, commitments and blocks are absent and say so", () => {
  it("the readiness check says not yet", async () => {
    expect(await withUser(ada.user.profileId, (db) => schema0048Ready(db))).toBe(false);
    expect(await C.commitmentsReady(ada)).toBe(false);
  });

  it("every change answers 503 NOT_READY", async () => {
    await expect(C.saveCommitmentSettings(owner, { track: true })).rejects.toMatchObject(notReady);
    await expect(C.setConversationTracking(david, design, false)).rejects.toMatchObject(notReady);
    await expect(C.acceptCommitment(ben, SOME_ID, {})).rejects.toMatchObject(notReady);
    await expect(C.declineCommitment(ben, SOME_ID, "No")).rejects.toMatchObject(notReady);
    await expect(C.dismissCommitment(ben, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(C.markCommitmentDone(ben, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(C.markCommitmentSeen(ben, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(LE.looseEndToTodo(ada, SOME_ID, { title: "Send the deck" })).rejects.toMatchObject(notReady);
    await expect(LE.looseEndRemind(ada, SOME_ID, { at: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toMatchObject(notReady);
    await expect(LE.looseEndHandOver(ada, SOME_ID, { to: id(ben), title: "Send the deck" })).rejects.toMatchObject(notReady);
    await expect(LE.looseEndFollowUpLater(ada, SOME_ID, { at: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toMatchObject(notReady);
    await expect(LE.dismissLooseEnd(ada, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(ben), question: "Copy?" })).rejects.toMatchObject(notReady);
    await expect(B.cancelBlock(ada, a.taskIds.homepage)).rejects.toMatchObject(notReady);
    await expect(B.answerBlock(ben, SOME_ID, { answer: "Here", unblock: false })).rejects.toMatchObject(notReady);
    await expect(B.notMeBlock(ben, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(B.markBlockSeen(ben, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(RP.confirmReplan(david, SOME_ID, {})).rejects.toMatchObject(notReady);
    await expect(RP.dismissReplan(david, SOME_ID)).rejects.toMatchObject(notReady);
  });

  it("the reads say ready: false, empty, and never throw", async () => {
    expect(await withUser(ada.user.profileId, (db) => C.commitmentSettings(db, ada.org.id))).toEqual({ ready: false, track: false, threadFollowUps: false, since: null });
    expect(await C.listCommitments(ada, { scope: "mine" })).toEqual({ ready: false, scopes: ["mine"], items: [], nextBefore: null, counts: null, people: [] });
    expect(await C.getCommitment(ada, SOME_ID)).toBeNull();
    expect(await C.waitingCommitments(ada)).toEqual([]);
    expect(await C.commitmentsForReport(david, "2026-10-08")).toBeNull();
    expect(await C.loopsForDesktop(ada)).toEqual({ ready: false, commitments: [], blocks: [], looseEnds: { open: 0, href: "/app/company-a/home/loose-ends" } });
    expect(await LE.listLooseEnds(ada)).toEqual({ ready: false, items: [], counts: { open: 0 }, lastScanAt: null });
    expect(await LE.getLooseEnd(ada, SOME_ID)).toBeNull();
    expect(await LE.knownLooseEndMessages(ada, [someMessage])).toEqual(new Set());
    expect(await LE.insertLooseEnds(ada, [{ messageId: someMessage, conversationId: design, contextMessageId: null, kind: "promise", counterpartMembershipId: null, title: "Send the deck", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9 }], { source: "on_demand" })).toEqual([]);
    expect(await B.waitingBlocks(ben)).toEqual([]);
    expect(await B.waitingOnList(ada)).toEqual({ ready: false, scope: "mine", items: [], byPerson: [] });
    expect(await B.blockFor(ada, a.taskIds.homepage)).toEqual({ ready: false, block: null, last: null, people: [] });
    expect(await B.getBlock(ada, SOME_ID)).toBeNull();
    expect(await RP.listOpenReplans(david)).toEqual([]);
    expect(await RP.replanForFollowUp(david, SOME_ID)).toBeNull();
    expect(await withUser(ada.user.profileId, (db) => C.labelsIn(db, design, [someMessage]))).toEqual(new Map());
  });

  it("a thread: no labels, no tracking, no switch; Messages work as before", async () => {
    const t = await thread(ada, design);
    expect(t!.commitments).toEqual({ ready: false, workspaceOn: false, here: false, tracked: false, canChange: false, applies: false, workspaceAssistantName: "Brenda" });
    expect(t!.messages.find((m) => m.id === someMessage)).toMatchObject({ author_kind: "person", commitment_label: null, body: "I'll send the deck Thursday" });
    const dm = await openDirect(ada, id(ben));
    expect((await thread(ada, dm))!.commitments.applies).toBe(false);
  });

  it("Mark blocked works as before (no settle is called), and the notch is whole", async () => {
    const t = a.taskIds.homepage;
    let v = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t]))[0].version;
    await updateTask(ada, t, { expectedVersion: v, status: "in_progress" });
    v = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t]))[0].version;
    await updateTask(ada, t, { expectedVersion: v, status: "blocked", reason: "Waiting for the copy" });
    v = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t]))[0].version;
    await updateTask(ada, t, { expectedVersion: v, status: "in_progress" });
    expect(await adminQuery("SELECT status FROM tasks WHERE id = $1", [t])).toEqual([{ status: "in_progress" }]);
    const s = await desktopState(ada);
    expect(s.loops).toEqual({ ready: false, commitments: [], blocks: [], looseEnds: { open: 0, href: "/app/company-a/home/loose-ends" } });
    expect(s.assistant.personal.name).toBe("Max");
  });

  it("the worker's side returns at once and writes nothing", async () => {
    expect(await C.sweepCommitments()).toEqual({ expired: 0, done: 0, cancelled: 0, interrupted: 0, asksDelivered: 0 });
    expect(await C.commitmentsDue()).toBe(false);
    expect(await C.insertDetectedCommitments(owner.org.id, [{ conversationId: design, sourceMessageId: someMessage, agreementMessageId: null, kind: "promise", committerMembershipId: id(ben), askerMembershipId: null, title: "Send the deck", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() }]))
      .toEqual({ created: [], skipped: 1 });
    expect(await C.markAgreed(SOME_ID, SOME_ID)).toBe(false);
    expect(await B.settleBlocks()).toEqual({ cleared: 0 });
    expect(await LE.runDueLooseEndFollowUps()).toEqual({ asked: 0, failed: 0 });
    expect(await LE.looseEndsDue()).toBe(false);
    expect(await RP.proposeReplan({ organisationId: owner.org.id, taskId: a.taskIds.homepage, leadMembershipId: id(david), followUpId: null, proposedDueAt: new Date() })).toBeNull();
  });
});

describe("before 0048, the rest of the phase (brain's surfaces) says so too", () => {
  it("her loop tools answer LOOPS_NOT_READY", async () => {
    const { runBrendaTool } = await import("@/server/services/copilot");
    const tools: [string, Record<string, unknown>][] = [
      ["loose_ends", { scan: true }], ["commitments", {}], ["waiting_on", {}],
      ["loose_end_action", { looseEndId: SOME_ID, action: "dismiss" }],
      ["respond_to_commitment", { commitmentId: SOME_ID, action: "accept" }],
      ["set_blocked_on", { taskId: a.taskIds.homepage, waitingOn: "Ben Okafor", question: "Can you send the copy?" }],
      ["respond_to_block", { blockId: SOME_ID, action: "not_me" }],
    ];
    for (const [name, input] of tools) {
      const r = await runBrendaTool(ada, name, input, "chat", { act: "read" });
      expect({ name, out: r.out }).toEqual({ name, out: { error: LOOPS_NOT_READY } });
      expect(r.proposals).toEqual([]);
    }
  });

  it("the loose-ends scan, the workspace scan and the follow-through do nothing", async () => {
    const { scanLooseEnds } = await import("@/server/services/loose-end-detect");
    expect(await scanLooseEnds(ada, { source: "on_demand", useModel: false })).toMatchObject({ ready: false, found: [] });
    const { scanWorkspaceCommitments, trackedOrgsDue } = await import("@/server/services/commitment-detect");
    expect(await trackedOrgsDue()).toEqual([]);
    expect(await scanWorkspaceCommitments(owner.org.id)).toMatchObject({ status: "not_ready", created: 0 });
    const { runCommitmentFollowThrough } = await import("@/server/services/commitment-followthrough");
    expect(await runCommitmentFollowThrough()).toEqual({ reminded: 0, stalledNoted: 0, threadPosts: 0 });
    const { scheduleCommitmentScans, scheduleCommitmentSweep, scheduleLooseEndSweep } = await import("../../worker/schedule");
    expect(await scheduleCommitmentScans(new Date())).toEqual({ queued: 0 });
    expect(await scheduleCommitmentSweep(new Date())).toMatchObject({ queued: false });
    expect(await scheduleLooseEndSweep(new Date())).toMatchObject({ queued: false });
    expect(await adminQuery("SELECT count(*)::int AS n FROM jobs WHERE type IN ('commitments.scan', 'commitments.sweep', 'loose_ends.sweep')")).toEqual([{ n: 0 }]);
  });

  it("routines: the Loose ends template is unavailable; the daily report has no Commitments section", async () => {
    const R = await import("@/server/services/routines");
    expect((await R.listRoutines(ada)).unavailable).toEqual(["loose_ends"]);
    await expect(R.createRoutine(ada, { template: "loose_ends", cadence: { kind: "daily" }, time: "17:30" } as Parameters<typeof R.createRoutine>[1])).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    const { buildDailyReport } = await import("@/server/services/daily-report");
    const report = await buildDailyReport(david, { useAssistant: false });
    expect(report.commitments ?? null).toBeNull();
  });
});

describe("then 0048, applied twice by hand", () => {
  it("applies without error, one of each object, the defaults as specified, and the phase working", async () => {
    await apply0048();
    await apply0048();
    forget0048();
    expect(await withWorker((db) => schema0048Ready(db))).toBe(true);
    const objects = await adminQuery<{ n: number }>(
      `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('commitments_guard', 'commitments_updated', 'commitments_notify', 'message_labels_updated', 'message_labels_notify',
                 'loose_ends_updated', 'loose_ends_guard', 'task_blocks_updated', 'task_blocks_notify', 'task_blocks_guard', 'replan_proposals_updated'))::int AS n`);
    expect(objects).toEqual([{ n: 11 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('ai_usage_purpose_check', 'routines_template_check', 'messages_author_kind_check')")).toEqual([{ n: 3 }]);
    expect(await adminQuery(`SELECT column_default FROM information_schema.columns WHERE table_name = 'brenda_settings' AND column_name IN ('track_commitments', 'commitment_thread_followups') ORDER BY column_name`))
      .toEqual([{ column_default: "false" }, { column_default: "false" }]);
    expect(await adminQuery(`SELECT column_default FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'track_commitments'`)).toEqual([{ column_default: "true" }]);
    expect(await adminQuery("SELECT DISTINCT track_commitments FROM conversations")).toEqual([{ track_commitments: true }]);
    expect(await withUser(ada.user.profileId, (db) => C.commitmentSettings(db, ada.org.id))).toEqual({ ready: true, track: false, threadFollowUps: false, since: null });
    // The replaced objects keep their old meaning plus the change.
    await expect(adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, NULL, 'mention', 'm')", [owner.org.id])).resolves.toBeDefined();
    await expect(adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, NULL, 'commitments', 'm')", [owner.org.id])).resolves.toBeDefined();
    await expect(adminQuery("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, NULL, 'nonsense', 'm')", [owner.org.id])).rejects.toThrow(/ai_usage_purpose_check/);
    // The phase works: the switch on, a promise noted, the thread labelled.
    await C.saveCommitmentSettings(owner, { track: true });
    const r = await C.insertDetectedCommitments(owner.org.id, [{ conversationId: design, sourceMessageId: someMessage, agreementMessageId: null, kind: "promise", committerMembershipId: id(ben), askerMembershipId: null, title: "Send the deck", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() }]);
    expect(r.created).toHaveLength(1);
    const t = await thread(ada, design);
    expect(t!.commitments).toMatchObject({ ready: true, applies: true, tracked: true });
    expect(t!.messages.find((m) => m.id === someMessage)!.commitment_label).toEqual({ state: "noted", text: "Noted" });
  });
});
