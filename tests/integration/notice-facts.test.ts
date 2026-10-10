/**
 * The notch's notification facts, end to end (owner decision, 9 October 2026: notch notifications, "A plus the grafts",
 * contract B and G). Real service calls make a direct message, a mention, a comment, a task assignment and a
 * reassignment, a reminder, a request between assistants and its outcome, a review requested and approved, a commitment
 * due, a follow-up answer and the team report; `desktopState` gives each notification the facts its card needs, read as
 * the person: who sent it (with their own assistant's face), the words on one line, the numbers. A withdrawn message keeps
 * its sender and loses its words; a channel the person left gives nothing of it (the plain card); another person's
 * notification never reaches the state and its facts are never read; at most 20 come; a kind that fails leaves its facts
 * null and the rest of the state as it was. The schema is built from every migration before 0052: the team report's card
 * reads the snapshot (`source: "snapshot"`); then 0052 is applied twice by hand (no error) and the report written again
 * carries its own counts and names (`source: "facts"`).
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Obi, Ben Okafor). Ada's
 * assistant is Nova (purple), Ben's is Max (blue), David's is King Jay (yellow). Local test database only
 * (TEST_DATABASE_URL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { createChannel, openChannel, openDirect, sendMessage, thread, updateChannel, withdrawMessage, type SendInput } from "@/server/services/messaging";
import { addComment, createTask, updateTask } from "@/server/services/tasks";
import { brendaTick, createReminder, setBrendaSettings } from "@/server/services/brenda";
import { acceptItem, planRequest, sendAssistantItem, type RequestInput } from "@/server/services/assistant-items";
import { reviewSubmission, submitTask } from "@/server/services/evidence";
import * as C from "@/server/services/commitments";
import { scanWorkspaceCommitments } from "@/server/services/commitment-detect";
import { runCommitmentFollowThrough } from "@/server/services/commitment-followthrough";
import { createFollowUps, processFollowUp, replyToFollowUp } from "@/server/services/follow-ups";
import { runDailyReportJob, snapshotOf } from "@/server/services/daily-report";
import * as R from "@/server/services/routines";
import { runTemplate } from "@/server/services/routine-templates";
import { desktopState } from "@/server/services/desktop";
import { NOTICE_RESOLVERS, forgetNoticeFacts, snapshotCounts, storedReportFacts, type DesktopNotification } from "@/server/services/notice-facts";
import { forget0052, schema0052Ready } from "@/server/lib/schema-0052";
import { withUser } from "@/server/db";
import { addDays, localDate, localTimeOn, todayLocal } from "@/server/lib/time";
import type { RoutineInput } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const TZ = "Africa/Lagos";
const MIGRATION = join(process.cwd(), "db", "migrations", "0052_report_facts.sql");
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let homepage = "";
const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const state = (c: OrgContext) => desktopState(c, { opener: false });
const ofType = (list: DesktopNotification[], type: string, pick: (n: DesktopNotification) => boolean = () => true) => {
  const found = list.filter((n) => n.type === type && pick(n));
  expect(found, `one unread ${type}`).toHaveLength(1);
  return found[0];
};
const factsOf = async (c: OrgContext, type: string, pick?: (n: DesktopNotification) => boolean) => ofType((await state(c)).notifications, type, pick).facts;
const face = (name: string, colour: string, visor: string, eyes: string) => ({ name, colour, visor, eyes, face: expect.objectContaining({ mid: expect.stringMatching(/^#[0-9a-f]{6}$/i) }) });
const NOVA = face("Nova", "purple", "screen", "square"), MAX = face("Max", "blue", "band", "pill"), KING_JAY = face("King Jay", "yellow", "band", "round");

/** As resetTestDatabase, but stopping before 0052. */
async function schemaBefore0052() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0052").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0052() {
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
  await schemaBefore0052();
  forget0052();
  expect(await adminQuery("SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'brenda_report_log'::regclass AND attname = 'facts'")).toEqual([{ n: 0 }]);
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  homepage = a.taskIds.homepage;
  await saveMyAssistant(ada, { name: "Nova", colour: "purple", visor: "screen", eyes: "square" });
  await saveMyAssistant(ben, { name: "Max", colour: "blue", visor: "band", eyes: "pill" });
  await saveMyAssistant(david, { name: "King Jay", colour: "yellow", visor: "band", eyes: "round" });
});

describe("messages", () => {
  let direct = "";

  it("a direct message: who sent it, with their own assistant's face, and its words on one line; the key stays on the server", async () => {
    direct = await openDirect(ada, id(ben));
    await sendMessage(ada, { conversationId: direct, body: "Can we push standup to 10:30?\nThe Aba call ran over." });
    const n = ofType((await state(ben)).notifications, "message.direct");
    expect(n.facts).toEqual({
      v: 1, kind: "message", from: { membershipId: id(ada), name: "Ada Obi", assistant: NOVA },
      preview: "Can we push standup to 10:30? The Aba call ran over.", where: null, direct: true, task: null,
    });
    expect(Object.keys(n).sort()).toEqual(["body", "created_at", "facts", "href", "id", "resource_id", "title", "type"]);
  });

  it("a withdrawn message keeps who sent it, never its words", async () => {
    const m = await sendMessage(ada, { conversationId: direct, body: "Wrong chat, ignore this one" });
    await withdrawMessage(ada, m.id);
    const f = await factsOf(ben, "message.direct", (n) => n.body === "Wrong chat, ignore this one");
    expect(f).toMatchObject({ kind: "message", from: { membershipId: id(ada), name: "Ada Obi" }, preview: null, direct: true });
  });

  it("a mention in a channel: who, where and the words; once the person has left the channel, nothing of it", async () => {
    const launch = (await createChannel(ada, { title: "Launch", memberIds: [id(ben), id(david)] })).id;
    const mentions = [{ kind: "person", membershipId: id(ben), label: "@Ben Okafor" }] as SendInput["mentions"];
    await sendMessage(ada, { conversationId: launch, body: "@Ben Okafor can you check the hero copy before 3?", mentions }, { startMention: false });
    expect(await factsOf(ben, "message.mention")).toEqual({
      v: 1, kind: "mention", from: { membershipId: id(ada), name: "Ada Obi", assistant: NOVA }, preview: "@Ben Okafor can you check the hero copy before 3?", where: "#Launch",
    });
    await updateChannel(ada, launch, { memberIds: [id(david)] });
    expect(await thread(ben, launch).catch(() => null)).toBeNull();
    expect(await factsOf(ben, "message.mention")).toBeNull();
  });

  it("a comment on a task: who and the words, and the task", async () => {
    await addComment(david, homepage, "Can you use the new logo on this?");
    expect(await factsOf(ada, "task.comment")).toEqual({
      v: 1, kind: "comment", from: { membershipId: id(david), name: "David Lead", assistant: KING_JAY }, preview: "Can you use the new logo on this?", task: "Homepage design",
    });
  });
});

describe("tasks and reminders", () => {
  it("a task assigned: the task as the person sees it, who gave it, and Start timer for their own", async () => {
    const f = await factsOf(ada, "task.assigned", (n) => n.resource_id === homepage);
    expect(f).toEqual({
      v: 1, kind: "assignment",
      task: { id: homepage, title: "Homepage design", project: "Website relaunch", dueAt: expect.any(String), estimateMinutes: 240, priority: "high", status: "todo" },
      by: { membershipId: id(david), name: "David Lead", assistant: KING_JAY }, canStart: true,
    });
  });

  it("a reassignment names nobody", async () => {
    const t = await createTask(david, { projectId: a.projectId, title: "Hero illustrations", expectedOutput: "Three hero illustrations.", assigneeMembershipId: id(ada), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false });
    const [{ version }] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]);
    await updateTask(david, t.id, { expectedVersion: version, assigneeMembershipId: id(ben) });
    expect(await factsOf(ben, "task.assigned", (n) => n.resource_id === t.id)).toMatchObject({ kind: "assignment", task: { title: "Hero illustrations", priority: "normal" }, by: null, canStart: true });
  });

  it("a reminder: its words, its time, when it was set, its task", async () => {
    const r = await createReminder(ada, { body: "Call the printer\nabout the proofs", remindAt: later(60).toISOString(), taskId: homepage });
    await brendaTick(later(120));
    expect(await factsOf(ada, "brenda.reminder")).toEqual({ v: 1, kind: "reminder", text: "Call the printer about the proofs", at: r.remind_at, setAt: expect.any(String), taskTitle: "Homepage design", taskId: homepage });
  });

  it("a review requested, then approved: who, their note, the revision, and how early it was done", async () => {
    const sub = await submitTask(ada, homepage, { note: "Final layout in Figma", links: [], fileIds: [] });
    expect(await factsOf(david, "review.requested")).toEqual({
      v: 1, kind: "review", decision: "requested", task: { id: homepage, title: "Homepage design" },
      by: { membershipId: id(ada), name: "Ada Obi", assistant: NOVA }, revision: 1, daysEarly: null, note: "Final layout in Figma",
    });
    await reviewSubmission(david, sub.submissionId, { decision: "approved", note: "" });
    expect(await factsOf(ada, "review.approved")).toEqual({
      v: 1, kind: "review", decision: "approved", task: { id: homepage, title: "Homepage design" },
      by: { membershipId: id(david), name: "David Lead", assistant: KING_JAY }, revision: 1, daysEarly: 3, note: null,
    });
    // The assignment's card follows the task: in review and then done, so no Start timer.
    expect(await factsOf(ada, "task.assigned", (n) => n.resource_id === homepage)).toMatchObject({ task: { status: "completed" }, canStart: false });
  });
});

describe("between assistants", () => {
  let itemId = "";

  it("a request: who asks, the change, their note; nothing changes until it is accepted", async () => {
    const request: RequestInput = { kind: "add_todo", title: "Review pricing" };
    const plan = await planRequest(ben, { to: ada.user.displayName, request, note: "Before Friday, please" });
    if (!plan.ok) throw new Error(plan.error);
    itemId = (await sendAssistantItem(ben, { kind: "request", recipientMembershipId: plan.recipient.membershipId, payload: plan.payload, note: plan.note })).id;
    expect(await factsOf(ada, "assistant.request")).toEqual({
      v: 1, kind: "request", from: { membershipId: id(ben), name: "Ben Okafor", assistant: MAX }, status: "delivered", expiresAt: expect.any(String),
      note: "Before Friday, please", result: null,
      request: { kind: "add_todo", title: "Review pricing", taskTitle: null, fromStatus: null, toStatus: null, dueAt: null, at: null, text: null },
    });
  });

  it("its outcome, to the sender: who answered and what was done", async () => {
    await acceptItem(ada, itemId);
    expect((await state(ada)).notifications.some((n) => n.type === "assistant.request")).toBe(false);
    expect(await factsOf(ben, "assistant.outcome")).toMatchObject({
      kind: "request", from: { membershipId: id(ada), name: "Ada Obi", assistant: NOVA }, status: "done", result: "to-do added", note: null,
      request: { kind: "add_todo", title: "Review pricing" },
    });
  });
});

describe("commitments and follow-ups", () => {
  it("a commitment due: the thing itself, when, and that it is not late yet", async () => {
    await C.saveCommitmentSettings(owner, { track: true });
    const design = await openChannel(david, a.teamId);
    const msg = (await sendMessage(ben, { conversationId: design, body: "I'll send the final deck Thursday" }, { startMention: false })).id;
    expect((await scanWorkspaceCommitments(org(), { now: later(30), useModel: false })).created).toBe(1);
    const [{ id: cid }] = await adminQuery<{ id: string }>("SELECT id FROM commitments WHERE source_message_id = $1", [msg]);
    const day = addDays(localDate(new Date(), TZ), 1);
    const dueAt = localTimeOn(day, "15:00", TZ).toISOString();
    await C.acceptCommitment(ben, cid, { dueAt });
    expect((await runCommitmentFollowThrough({ now: localTimeOn(day, "13:35", TZ) })).reminded).toBe(1);
    expect(await factsOf(ben, "brenda.commitment_due")).toEqual({
      v: 1, kind: "commitment", title: "Send the final deck", dueAt, dueLabel: expect.any(String), status: "open", overdue: false,
      asker: null, committer: { membershipId: id(ben), name: "Ben Okafor", assistant: MAX }, canMarkDone: expect.any(Boolean), href: expect.stringContaining(cid),
    });
    // The getter kinds are kept a short while (review, 9 October 2026: rebuilt on every poll they cost a few transactions
    // each): a change shows once that time is up, here at once after forgetting.
    await adminQuery("UPDATE commitments SET title = 'Send the final deck, v2' WHERE id = $1", [cid]);
    expect(await factsOf(ben, "brenda.commitment_due")).toMatchObject({ title: "Send the final deck" });
    forgetNoticeFacts();
    expect(await factsOf(ben, "brenda.commitment_due")).toMatchObject({ title: "Send the final deck, v2" });
  });

  it("a group's answers: how many answered, replied, did not reply", async () => {
    const r = await createFollowUps(david, { subjectMembershipIds: [id(ada), id(ben)], taskId: null, question: "What are you on today?" });
    expect(r.created).toHaveLength(2);
    for (const { id: fid } of r.created) {
      if ((await processFollowUp(fid, { useModel: false })) !== "asking") continue;
      const [{ subject }] = await adminQuery<{ subject: string }>("SELECT subject_membership_id AS subject FROM follow_ups WHERE id = $1", [fid]);
      await replyToFollowUp(subject === id(ada) ? ada : ben, fid, { choice: "on_track" }, { start: false });
      await processFollowUp(fid, { useModel: false });
    }
    const f = await factsOf(david, "brenda.followup_batch");
    expect(f).toMatchObject({ v: 1, kind: "batch", counts: { total: 2, noReply: 0, declined: 0, failed: 0 } });
    if (f?.kind === "batch") expect(f.counts.answered + f.counts.replied).toBe(2);
  });

  it("a follow-up answer: the person asked about, the result, their time and open work as the asker may see them", async () => {
    const r = await createFollowUps(david, { subjectMembershipIds: [id(ben)], taskId: null, question: "What is Ben working on?" });
    const fid = r.created[0].id;
    let status = await processFollowUp(fid, { useModel: false });
    let replied = false;
    if (status === "asking") {
      await replyToFollowUp(ben, fid, { choice: "on_track", note: "Hero copy" }, { start: false });
      status = await processFollowUp(fid, { useModel: false });
      replied = true;
    }
    expect(status).toBe("answered");
    // The question as the follow-up keeps it (the service words it to the person: "What are you working on?").
    const [{ question }] = await adminQuery<{ question: string }>("SELECT question FROM follow_ups WHERE id = $1", [fid]);
    const f = await factsOf(david, "brenda.followup_answer");
    expect(f).toMatchObject({
      v: 1, kind: "answer", subject: { membershipId: id(ben), name: "Ben Okafor", assistant: MAX }, question, task: null, status: "answered",
      time: { todaySeconds: expect.any(Number), weekSeconds: expect.any(Number) }, openTasks: expect.any(Number), engine: "template", href: expect.stringContaining(fid),
    });
    if (replied) expect(f).toMatchObject({ result: { key: "on_track", label: "On track" } });
    else expect(f).toMatchObject({ result: { key: expect.stringMatching(/^(on_track|not_started)$/) } });
  });
});

describe("the team report", () => {
  const today = () => todayLocal(TZ);
  const logRow = async () => (await adminQuery<{ snapshot: unknown; facts?: unknown; doc_id: string }>("SELECT * FROM brenda_report_log WHERE membership_id = $1 AND local_date = $2::date", [id(david), today()]))[0];

  it("before 0052: the card's counts come from the snapshot (finished, overdue, blocked; no hours, no names)", async () => {
    // Something for the report to say: an overdue task, and Ben clocked in 40 minutes late.
    const late = await createTask(david, { projectId: a.projectId, title: "Old copy", expectedOutput: "Copy.", assigneeMembershipId: id(ada), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: later(3600).toISOString(), addToMyDay: false });
    await adminQuery("UPDATE tasks SET due_at = now() - interval '2 days' WHERE id = $1", [late.id]);
    await adminQuery(
      `INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, clock_in_at, late_seconds)
       VALUES ($1, $2, $3::date, $4, '09:00', '17:00', now(), 2400)`, [org(), id(ben), today(), TZ]);
    await setBrendaSettings(owner, { dailyReportEnabled: true, dailyReportTime: "00:01" });
    expect((await runDailyReportJob({ organisationId: org(), membershipId: id(david), localDate: today() }, { useAssistant: false })).status).toBe("sent");
    const row = await logRow();
    expect(row).not.toHaveProperty("facts");
    const counts = snapshotCounts(snapshotOf(row.snapshot)!);
    expect(counts.overdue).toBeGreaterThanOrEqual(1);
    const n = ofType((await state(david)).notifications, "brenda.daily_report");
    expect(n.resource_id).toBe(row.doc_id);
    expect(n.facts).toEqual({ v: 1, kind: "report", localDate: today(), source: "snapshot", trackedSeconds: null, ...counts, missing: null, late: null });
  });

  it("0052 applies twice by hand; the report written again carries its own counts and names", async () => {
    await apply0052();
    await apply0052();
    forget0052();
    expect(await withUser(david.user.profileId, (db) => schema0052Ready(db))).toBe(true);
    await adminQuery("UPDATE brenda_report_log SET sent_at = NULL WHERE membership_id = $1 AND local_date = $2::date", [id(david), today()]);
    expect((await runDailyReportJob({ organisationId: org(), membershipId: id(david), localDate: today() }, { useAssistant: false })).status).toBe("sent");
    const stored = storedReportFacts((await logRow()).facts);
    expect(stored).not.toBeNull();
    expect(stored!.late).toEqual([{ membershipId: id(ben), name: "Ben Okafor", minutes: 40 }]);
    const f = await factsOf(david, "brenda.daily_report");
    expect(f).toEqual({
      v: 1, kind: "report", localDate: today(), source: "facts", trackedSeconds: stored!.trackedSeconds, finished: stored!.finished, overdue: stored!.overdue, blocked: stored!.blocked,
      missing: { count: stored!.missingCount, people: stored!.missing.map((p) => ({ membershipId: p.membershipId, name: p.name, assistant: expect.objectContaining({ name: expect.any(String) }) })) },
      late: { count: 1, people: [{ membershipId: id(ben), name: "Ben Okafor", assistant: MAX, minutes: 40 }] },
    });
    expect(stored!.overdue).toBeGreaterThanOrEqual(1);
  });
});

describe("routines", () => {
  it("a routine delivered: its name, its lead and its sections' counts", async () => {
    const input: RoutineInput = { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" };
    const v = await R.createRoutine(david, input);
    const p = await R.previewRoutine(david, v.id);
    await R.enableRoutine(david, v.id, { consentHash: p.consent.hash });
    const now = new Date();
    const [row] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [v.id, now.toISOString()]);
    const c = await R.claimRun({ routineId: v.id, dueAt: row.next_run_at, now });
    if ("skip" in c) throw new Error(`skipped: ${c.skip}`);
    const result = await runTemplate(c.ctx, c.routine, { mode: "run", runId: c.runId, now, since: c.previousRunAt });
    expect((await R.completeRun(c.runId, result, { now })).delivery).toBe("delivered");
    const o = result.output;
    expect(await factsOf(david, "brenda.routine")).toEqual({
      v: 1, kind: "routine", name: v.name, lead: o.lead,
      sections: o.sections.slice(0, 4).map((x) => ({ id: x.id, label: x.label, count: x.items.length + x.more })),
    });
  });
});

describe("whose, how many, and when something fails", () => {
  it("another person's notifications never reach the state, and their facts are never read", async () => {
    const original = NOTICE_RESOLVERS.message;
    const seen: string[] = [];
    NOTICE_RESOLVERS.message = async (c, rows) => { seen.push(...rows.map((r) => r.id)); return original(c, rows); };
    try {
      const s = await state(ada);
      const mine = new Set((await adminQuery<{ id: string }>("SELECT id FROM notifications WHERE recipient_membership_id = $1", [id(ada)])).map((r) => r.id));
      const bens = (await adminQuery<{ id: string }>("SELECT id FROM notifications WHERE recipient_membership_id = $1", [id(ben)])).map((r) => r.id);
      expect(bens.length).toBeGreaterThan(0);
      expect(s.notifications.every((n) => mine.has(n.id))).toBe(true);
      expect(s.notifications.some((n) => bens.includes(n.id))).toBe(false);
      expect(seen.every((x) => mine.has(x))).toBe(true);
      // Ben's direct messages are his: read for him, never for Ada.
      await state(ben);
      expect(seen.some((x) => bens.includes(x))).toBe(true);
    } finally {
      NOTICE_RESOLVERS.message = original;
    }
  });

  it("at most 20, newest first", async () => {
    await adminQuery(
      `INSERT INTO notifications(organisation_id, recipient_membership_id, type, title, deduplication_key, created_at)
       SELECT $1, $2, 'brenda.nudge', 'Nudge ' || g, 'test.nudge:' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 25) g`, [org(), id(mary)]);
    const s = await state(mary);
    expect(s.notifications).toHaveLength(20);
    // The count past the 20 (review, 9 October 2026), so the notch's bar and summary say how many in all.
    const [{ n }] = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND read_at IS NULL", [id(mary)]);
    expect(n).toBeGreaterThanOrEqual(25);
    expect(s.notificationsUnread).toBe(n);
    expect(s.notifications[0].title).toBe("Nudge 1");
    expect(s.notifications.every((n) => n.facts === null)).toBe(true);
  });

  it("a kind that fails leaves its facts null and the rest of the state as it was", async () => {
    const before = await state(ada);
    const original = NOTICE_RESOLVERS.reminder;
    NOTICE_RESOLVERS.reminder = async () => { throw new Error("boom"); };
    try {
      const s = await state(ada);
      expect(ofType(s.notifications, "brenda.reminder").facts).toBeNull();
      expect(ofType(s.notifications, "task.comment").facts).toMatchObject({ kind: "comment" });
      expect(s.notifications.map((n) => n.id)).toEqual(before.notifications.map((n) => n.id));
      expect(s.briefing).toEqual(before.briefing);
      expect(s.assistant).toEqual(before.assistant);
    } finally {
      NOTICE_RESOLVERS.reminder = original;
    }
    expect(ofType((await state(ada)).notifications, "brenda.reminder").facts).toMatchObject({ kind: "reminder" });
  });
});
