/**
 * Phase 7c fix review (9 October 2026): the security and correctness findings on the async standup, private decline
 * labels, the chat log, taint and Loose ends, each held to its fixed behaviour. Migration 0051 is applied (the test
 * database runs every migration).
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Obi, Ben Okafor, Olu Ade),
 * Kemi Sales (leads Sales; Ada is on Sales too). Ops (no lead, the owner switched standup on): Ben and Olu. Each block
 * works on its own day so nothing one does is seen by another. Drafts with the template (no model). Local test database
 * only (TEST_DATABASE_URL on localhost).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { createProject, createTask, quickTodo, updateTask } from "@/server/services/tasks";
import { setBlock } from "@/server/services/task-blocks";
import { savePersonalAbility } from "@/server/services/abilities";
import { openChannel, sendMessage, thread } from "@/server/services/messaging";
import * as C from "@/server/services/commitments";
import * as LE from "@/server/services/loose-ends";
import * as S from "@/server/services/standup";
import { composeRollup, composeStandup } from "@/server/services/standup-compose";
import { runBrendaTool } from "@/server/services/copilot";
import { addDays, localDate, localParts } from "@/server/lib/time";
import type { DetectedCommitment, MessageLabel } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const LAGOS = "Africa/Lagos";
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, kemi: OrgContext;
let design: string, sales: string, ops: string, channel: string, today: string;
const id = (c: OrgContext) => c.membership.id;
/** Noon on a local day in Lagos (UTC+1, no clock change). */
const noonOf = (date: string) => new Date(`${date}T11:00:00.000Z`);
const entryIn = async (rollupId: string | null, c: OrgContext) =>
  (await adminQuery<{ id: string }>("SELECT id FROM standup_entries WHERE rollup_id = $1 AND membership_id = $2", [rollupId, id(c)]))[0]?.id;
const entryRow = async (entryId: string) =>
  (await adminQuery<{ status: string; reason: string | null; attempts: number }>("SELECT status, reason, attempts FROM standup_entries WHERE id = $1", [entryId]))[0];
const notice = async (membershipId: string, key: string) =>
  (await adminQuery<{ read_at: string | null }>("SELECT read_at FROM notifications WHERE recipient_membership_id = $1 AND deduplication_key = $2", [membershipId, key]))[0];

async function draft(entryId: string, now = new Date()) {
  const c = await S.claimStandupDraft(entryId, now);
  if ("skip" in c) throw new Error(`not claimed: ${c.skip}`);
  await S.saveStandupDraft(entryId, await composeStandup(c, { model: null }), now);
}
async function blockedTask(c: OrgContext, taskId: string, reason: string) {
  let [r] = await adminQuery<{ status: string; version: number }>("SELECT status, version FROM tasks WHERE id = $1", [taskId]);
  if (r.status !== "in_progress") { await updateTask(c, taskId, { expectedVersion: r.version, status: "in_progress" }); [r] = await adminQuery("SELECT status, version FROM tasks WHERE id = $1", [taskId]); }
  await updateTask(c, taskId, { expectedVersion: r.version, status: "blocked", reason });
}
/** A day's rollup sent as the worker does at the cutoff (its `now` just past the cutoff). */
async function sendAtCutoff(rollupId: string) {
  const [r] = await adminQuery<{ cutoff_at: string }>("SELECT cutoff_at FROM standup_rollups WHERE id = $1", [rollupId]);
  const at = new Date(Date.parse(r.cutoff_at) + 1_000);
  const input = await S.rollupInput(rollupId, at);
  if ("skip" in input) throw new Error(`rollup not due: ${input.skip}`);
  await S.sendRollup(rollupId, composeRollup(input), at);
  return input;
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = a.teamId;
  const join = async (email: string, name: string, role: "employee" | "manager", team: string | null, code: string) =>
    joinViaInvitation(mary, await createVerifiedUser(email, name), role, team, code);
  olu = await join("olu@company-a.test", "Olu Ade", "employee", design, "EMP-003");
  sales = (await createTeam(owner, "Sales")).id;
  kemi = await join("kemi@company-a.test", "Kemi Sales", "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(kemi), { isManager: true });
  await setTeamMember(owner, sales, id(ada), { isManager: false });
  ops = (await createTeam(owner, "Ops")).id;
  await setTeamMember(owner, ops, id(ben), { isManager: false });
  await setTeamMember(owner, ops, id(olu), { isManager: false });
  channel = await openChannel(david, design);
  today = localDate(new Date(), LAGOS);
  // The fixture's tasks are on "Website relaunch" (not Design's working project): Olu, who joined Design since, is put
  // on it so every reader of #Design sees them.
  await adminQuery("INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'contributor') ON CONFLICT DO NOTHING",
    [owner.org.id, a.projectId, id(olu)]);
  // Every day, all day, so any test day can be opened at its noon.
  await S.saveStandupSettings(david, design, { enabled: true, time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
  await S.saveStandupSettings(owner, ops, { enabled: true, time: "00:00", cutoff: "23:59", days: [0, 1, 2, 3, 4, 5, 6] });
});

describe("a draft carries only what the team channel's readers can already see (security review P7)", () => {
  it("Kemi gives Ada a Sales-only task: it is not in Ada's Design draft, so Post never sends it to #Design", async () => {
    const proj = await createProject(kemi, { name: "Sales restructure", description: "Confidential", requiresDueDate: false, requiresEstimate: false, memberIds: [id(ada)] });
    const t = await createTask(kemi, { projectId: proj.id, title: "Shortlist for Sales redundancies", expectedOutput: "A list.", assigneeMembershipId: id(ada), reviewerMembershipId: null, category: "work", priority: "normal", estimateMinutes: 60, dueAt: null, addToMyDay: false });
    const [m] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]);
    await updateTask(ada, t.id, { expectedVersion: m.version, status: "in_progress" });
    expect(await appQueryAs(a.employee2.profileId, "SELECT id FROM tasks WHERE id = $1", [t.id])).toHaveLength(0);
    // Design's own work still counts.
    const [h] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]);
    await updateTask(ada, a.taskIds.homepage, { expectedVersion: h.version, status: "in_progress" });

    // Her own task on Design's working project counts (contract B.3); one of her own elsewhere does not.
    const [w] = await adminQuery<{ project_id: string }>("SELECT project_id FROM teams WHERE id = $1", [design]);
    const own = (await quickTodo(ada, { title: "Moodboard for the relaunch", projectId: w.project_id })).id;
    const [o] = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [own]);
    await updateTask(ada, own, { expectedVersion: o.version, status: "in_progress" });

    const day = addDays(today, 2);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, ada);
    await draft(e);
    const v = await S.getStandupEntry(ada, e);
    expect(JSON.stringify(v)).not.toContain("Sales redundancies");
    expect(v?.texts?.today).toContain("Homepage design");
    expect(v?.texts?.today).toContain("Moodboard for the relaunch");
    await S.postStandup(ada, e);
    expect((await thread(ben, channel))!.messages.some((x) => x.body.includes("Sales redundancies"))).toBe(false);
    // Posting read her "ready" notice.
    expect((await notice(id(ada), `standup.draft:${e}`))?.read_at).toBeTruthy();
  });
});

describe("the rollup is built from the posted words (security review P1), and opening it reads its notice", () => {
  it("Ben edits Ada's name out of his Blocked line and posts: the lead's rollup names nobody he is blocked on", async () => {
    await blockedTask(ben, a.taskIds.second, "Waiting for the brand fonts");
    await setBlock(ben, a.taskIds.second, { waitingOn: id(ada), question: "Can you send the brand fonts?" });
    const day = addDays(today, 1);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, ben);
    await draft(e);
    const before = await S.getStandupEntry(ben, e);
    expect(before?.texts?.blocked).toContain("waiting on Ada Obi");
    const line = before!.texts!.blocked.split("\n")[0].replace(/waiting on Ada Obi.*$/, "waiting on the client");
    await S.editStandup(ben, e, { blocked: line });
    await S.postStandup(ben, e);
    await sendAtCutoff(opened.rollupId!);
    const v = await S.getStandupRollup(david, opened.rollupId!);
    expect(v.content?.blockers).toHaveLength(1);
    expect(v.content?.blockers[0]).toMatchObject({ name: "Ben Okafor", taskId: a.taskIds.second, onName: null, onMembershipId: null });
    // David opens it: its notification is read.
    const key = `standup.rollup:${opened.rollupId}:${id(david)}`;
    expect((await notice(id(david), key))?.read_at).toBeNull();
    await S.markRollupSeen(david, opened.rollupId!);
    expect((await notice(id(david), key))?.read_at).toBeTruthy();
  });

  it("a posted line that still names the person keeps who it is blocked on", async () => {
    const day = addDays(today, 6);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, ben);
    await draft(e);
    await S.postStandup(ben, e);
    await sendAtCutoff(opened.rollupId!);
    const v = await S.getStandupRollup(david, opened.rollupId!);
    expect(v.content?.blockers[0]).toMatchObject({ name: "Ben Okafor", onName: "Ada Obi", onMembershipId: id(ada) });
  });
});

describe("a skip in the chat reads like silence to owners and HR (security P2, correctness review)", () => {
  it("Olu skips through her chat: nothing in Brenda's log says so, for the owner or HR", async () => {
    const day = addDays(today, 3);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, olu);
    await draft(e);
    const r = await runBrendaTool(olu, "standup_action", { entryId: e, action: "skip" }, "chat");
    expect(r.out).toMatchObject({ done: true });
    expect((await entryRow(e)).status).toBe("skipped");
    await new Promise((res) => setTimeout(res, 300));
    for (const who of [a.owner, a.hr]) {
      const rows = await appQueryAs(who.profileId, "SELECT summary FROM brenda_actions WHERE membership_id = $1", [id(olu)]);
      expect(JSON.stringify(rows)).not.toMatch(/Skipped|skip/i);
    }
    // Skipping read her "ready" notice too.
    expect((await notice(id(olu), `standup.draft:${e}`))?.read_at).toBeTruthy();
  });
});

describe("after the standup read, an edit or a skip asks first (security review P4)", () => {
  it("other people's words in the draft: the edit is a Confirm card and the draft is unchanged", async () => {
    const day = addDays(today, 3);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, ada);
    await draft(e);
    const before = (await S.getStandupEntry(ada, e))!.texts!.blocked;
    // The standup read (today's drafts) sets othersWords; this draft is another day's, so the turn is given it as the read would.
    const r = await runBrendaTool(ada, "standup_action", { entryId: e, action: "edit", blocked: "Blocked by David, who never answers" }, "chat", { othersWords: true });
    expect(r.proposals.length).toBe(1);
    expect((await S.getStandupEntry(ada, e))!.texts!.blocked).toBe(before);
    const skip = await runBrendaTool(ada, "standup_action", { entryId: e, action: "skip" }, "chat", { othersWords: true });
    expect(skip.proposals.length).toBe(1);
    expect((await entryRow(e)).status).toBe("ready");
  });
});

describe("standup switched off for yourself after the day opened (security review P3)", () => {
  it("David's open draft is called off at once, never drafted or announced; the claim refuses one that slipped through", async () => {
    const day = addDays(today, 3);
    const rollup = (await adminQuery<{ id: string }>("SELECT id FROM standup_rollups WHERE team_id = $1 AND local_date = $2", [design, day]))[0].id;
    const e = await entryIn(rollup, david);
    expect((await entryRow(e)).status).toBe("drafting");
    await savePersonalAbility(david, { key: "standup", on: false });
    try {
      expect(await entryRow(e)).toMatchObject({ status: "cancelled", reason: "off" });
      // One the switch did not reach (written back by hand): the claim calls it off instead of drafting it.
      await adminQuery("ALTER TABLE standup_entries DISABLE TRIGGER USER");
      await adminQuery("UPDATE standup_entries SET status = 'drafting', reason = NULL WHERE id = $1", [e]);
      await adminQuery("ALTER TABLE standup_entries ENABLE TRIGGER USER");
      expect(await S.claimStandupDraft(e, noonOf(day))).toEqual({ skip: "gone" });
      expect(await entryRow(e)).toMatchObject({ status: "cancelled", reason: "off" });
      expect(await notice(id(david), `standup.draft:${e}`)).toBeUndefined();
    } finally {
      await savePersonalAbility(david, { key: "standup", on: true });
    }
  });
});

describe("an authorised day off (correctness review)", () => {
  it("Ben off on the day gets no draft and is not counted in the rollup", async () => {
    const day = addDays(today, 4);
    await adminQuery("INSERT INTO workday_exemptions(organisation_id, membership_id, local_date, reason, created_by) VALUES ($1, $2, $3, 'Annual leave', $4)",
      [owner.org.id, id(ben), day, id(owner)]);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    expect(await entryIn(opened.rollupId, ben)).toBeUndefined();
    expect(await entryIn(opened.rollupId, ada)).toBeTruthy();
    const input = await sendAtCutoff(opened.rollupId!);
    expect(input.members.map((m) => m.membershipId)).not.toContain(id(ben));
    const v = await S.getStandupRollup(david, opened.rollupId!);
    expect(v.content?.noUpdate.map((p) => p.name)).not.toContain("Ben Okafor");
  });
});

describe("a draft out of attempts (correctness review)", () => {
  it("is failed with one notice at the claim; skipped and undone, it gets one more attempt and is drafted", async () => {
    const day = addDays(today, 5);
    const opened = await S.openStandupDay(design, day, noonOf(day));
    const e = await entryIn(opened.rollupId, olu);
    await adminQuery("UPDATE standup_entries SET attempts = 3 WHERE id = $1", [e]);
    expect(await S.claimStandupDraft(e, new Date())).toEqual({ skip: "done" });
    expect((await entryRow(e)).status).toBe("failed");
    expect(await notice(id(olu), `standup.failed:${e}`)).toBeTruthy();
    await S.skipStandup(olu, e);
    await S.unskipStandup(olu, e);
    expect(await entryRow(e)).toMatchObject({ status: "drafting", attempts: 2 });
    await draft(e);
    expect((await entryRow(e)).status).toBe("ready");
  });
});

describe("the sweep's 'left the team' (correctness review)", () => {
  it("cancels only open days: Olu's skip of a past day stays a skip when she leaves Ops", async () => {
    const yesterday = addDays(today, -1);
    const past = await S.openStandupDay(ops, yesterday, noonOf(yesterday));
    const old = await entryIn(past.rollupId, olu);
    await adminQuery("UPDATE standup_entries SET status = 'skipped', skipped_at = now() WHERE id = $1", [old]);
    await sendAtCutoff(past.rollupId!);
    const now = new Date();
    const open = await S.openStandupDay(ops, today, now);
    const current = await entryIn(open.rollupId, olu);
    expect(current).toBeTruthy();
    await setTeamMember(owner, ops, id(olu), { isManager: false, remove: true });
    await S.sweepStandups(now);
    expect((await entryRow(old)).status).toBe("skipped");
    expect(await entryRow(current)).toMatchObject({ status: "cancelled", reason: "left_team" });
  });
});

describe("a new rollup time moves today's open rollup (correctness review)", () => {
  // Today's day runs 00:00–23:59; the new times must still be ahead.
  const lateInDay = localParts(new Date(), LAGOS).hour >= 22;
  it.skipIf(lateInDay)("23:30 moves today's cutoff; back to 23:59 moves it back", async () => {
    const opened = await S.openStandupDay(design, today, new Date());
    const cutoff = async () => (await adminQuery<{ t: string }>("SELECT to_char(cutoff_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS t FROM standup_rollups WHERE id = $1", [opened.rollupId]))[0].t;
    expect(await cutoff()).toBe("23:59");
    await S.saveStandupSettings(david, design, { cutoff: "23:30" });
    expect(await cutoff()).toBe("23:30");
    await S.saveStandupSettings(david, design, { cutoff: "23:59" });
    expect(await cutoff()).toBe("23:59");
  });
});

describe("private decline labels follow the label's own commitment (security P5, correctness review)", () => {
  const det = (p: Pick<DetectedCommitment, "sourceMessageId" | "kind" | "committerMembershipId"> & Partial<DetectedCommitment>): DetectedCommitment => ({
    conversationId: channel, agreementMessageId: null, askerMembershipId: null, title: "Something", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(), ...p,
  });
  const insert = async (d: DetectedCommitment) => (await C.insertDetectedCommitments(owner.org.id, [d])).created[0];
  const labelOn = async (c: OrgContext, messageId: string): Promise<MessageLabel | null> => (await thread(c, channel))!.messages.find((x) => x.id === messageId)!.commitment_label;

  it("two private states on one message: only the parties of the commitment the label shows read it, in the thread and by SELECT", async () => {
    await C.saveCommitmentSettings(owner, { track: true });
    const ask = (await sendMessage(david, { conversationId: channel, body: "Ada, can you review the copy?", replyToId: null }, { startMention: false })).id;
    const m = (await sendMessage(ada, { conversationId: channel, body: "Sure, and Olu I'll send you the slides Friday", replyToId: ask }, { startMention: false })).id;
    const x = await insert(det({ sourceMessageId: ask, agreementMessageId: m, kind: "agreed_ask", committerMembershipId: id(ada), askerMembershipId: id(david), title: "Review the copy" }));
    const y = await insert(det({ sourceMessageId: m, kind: "promise", committerMembershipId: id(ada), askerMembershipId: id(olu), title: "Send Olu the slides" }));
    await C.declineCommitment(ada, x, "No time");
    await C.dismissCommitment(ada, y);
    const [row] = await adminQuery<{ commitment_id: string }>("SELECT commitment_id FROM message_labels WHERE message_id = $1", [m]);
    expect([x, y]).toContain(row.commitment_id);
    const party = row.commitment_id === x ? { reads: david, readsUser: a.manager.profileId, not: olu } : { reads: olu, readsUser: null, not: david };
    expect(await labelOn(ada, m)).toBeTruthy();
    expect(await labelOn(party.reads, m)).toBeTruthy();
    expect(await labelOn(party.not, m)).toBeNull();
    expect(await labelOn(ben, m)).toBeNull();
    const notUser = party.not === david ? a.manager.profileId : null;
    if (notUser) expect(await appQueryAs(notUser, "SELECT state FROM message_labels WHERE message_id = $1", [m])).toHaveLength(0);
    if (party.readsUser) expect(await appQueryAs(party.readsUser, "SELECT state FROM message_labels WHERE message_id = $1", [m])).toHaveLength(1);
    expect(await appQueryAs(a.employee2.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [m])).toHaveLength(0);
    await C.saveCommitmentSettings(owner, { track: false });
  });
});

describe("Loose ends switched off with a follow-up scheduled (security review P8)", () => {
  it("the worker asks nobody and puts it back on the list with why", async () => {
    const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const msg = (await sendMessage(david, { conversationId: channel, body: "Ben, could you send the logo files?", replyToId: null }, { startMention: false })).id;
    const [v0] = await LE.insertLooseEnds(david, [{ messageId: msg, conversationId: channel, kind: "i_asked", title: "Send the logo files", contextMessageId: null, counterpartMembershipId: id(ben), dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.8 }], { source: "routine" });
    await LE.looseEndFollowUpLater(david, v0.id, { at: soon(30).toISOString() });
    await savePersonalAbility(david, { key: "loose_ends", on: false });
    try {
      const count = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups WHERE requester_membership_id = $1", [id(david)]))[0].n;
      const before = await count();
      const r = await LE.runDueLooseEndFollowUps({ now: soon(31) });
      expect(r.asked).toBe(0);
      expect(await count()).toBe(before);
      const [row] = await adminQuery<{ status: string; follow_up_error: string | null }>("SELECT status, follow_up_error FROM loose_ends WHERE id = $1", [v0.id]);
      expect(row.status).toBe("open");
      expect(row.follow_up_error).toMatch(/Loose ends/);
    } finally {
      await savePersonalAbility(david, { key: "loose_ends", on: true });
    }
  });
});

describe("before today's post time, the Standup page says when it comes (visual review)", () => {
  const p = localParts(new Date(), LAGOS);
  const pad = (n: number) => String(n).padStart(2, "0");
  it.skipIf(p.hour >= 21)("Ben reads that drafts arrive at the post time; Kemi, who leads Research, that her rollup follows", async () => {
    const research = (await createTeam(owner, "Research")).id;
    await setTeamMember(owner, research, id(kemi), { isManager: true });
    await setTeamMember(owner, research, id(ben), { isManager: false });
    const time = `${pad(p.hour + 1)}:${pad(p.minute)}`, cutoff = `${pad(p.hour + 2)}:${pad(p.minute)}`;
    await S.saveStandupSettings(kemi, research, { enabled: true, time, cutoff, days: [0, 1, 2, 3, 4, 5, 6] });
    const forBen = (await S.standupToday(ben)).upcoming ?? [];
    expect(forBen).toEqual([expect.objectContaining({ teamId: research, teamName: "Research", time, cutoff, drafts: true, lead: false })]);
    const forKemi = (await S.standupToday(kemi)).upcoming ?? [];
    expect(forKemi).toEqual([expect.objectContaining({ teamId: research, drafts: true, lead: true })]);
    // Opened: nothing is "coming" any more.
    await S.openStandupDay(research, today, new Date(Date.now() + 3_600_000));
    expect((await S.standupToday(ben)).upcoming ?? []).toEqual([]);
  });
});
