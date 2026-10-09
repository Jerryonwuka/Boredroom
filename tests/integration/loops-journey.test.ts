/**
 * Phase 7b, the whole journey across every builder's part (owner decisions, 8 October 2026: "Brenda keeps the loops
 * closed", second part; integration). With tracking off nothing is noted; turned on, a promise in a channel is labelled
 * "Noted" for everyone who reads it (nobody else), the committer's own assistant brings it to them and Accept makes the
 * linked to-do; a direct thread is never read; an untracked conversation is not either. An open ask waits an hour, then
 * goes to the asked person, who takes it on or declines (the asker alone is told). Follow-through: the due reminder goes
 * to the committer alone and waits out their quiet hours; two working days overdue with no progress, the asker is told
 * privately and the lead's end-of-day report has it under Commitments; a gentle follow-up appears in the thread only
 * when that switch is on, inside working hours, once. The Commitments page shows the lead their team and a member only
 * their own. Loose ends: the three kinds are found in a direct thread and a channel, privately; Make it a to-do still
 * asks in "Act without asking"; Not a commitment is remembered; nothing already noted as a commitment comes back as a
 * loose end. Blocked on whom: the answer reaches the blocked person as the answerer's comment. (The re-plan a second
 * stall proposes is covered end to end in loops-e2e.test.ts.)
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor), Sam Sales (leads
 * Sales: Olu Adeyemi). Local test database only (TEST_DATABASE_URL on localhost). No model: the built-in rules.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { createChannel, openChannel, openDirect, sendMessage, thread } from "@/server/services/messaging";
import { createTask, updateTask } from "@/server/services/tasks";
import { saveQuietHours } from "@/server/services/routines";
import { actModeFor, saveActMode } from "@/server/services/act-mode";
import { runBrendaTool, confirmAction, type Proposal } from "@/server/services/copilot";
import { buildDailyReport, commitmentsMarkdown } from "@/server/services/daily-report";
import { scanWorkspaceCommitments } from "@/server/services/commitment-detect";
import { runCommitmentFollowThrough } from "@/server/services/commitment-followthrough";
import { scanLooseEnds } from "@/server/services/loose-end-detect";
import * as C from "@/server/services/commitments";
import * as LE from "@/server/services/loose-ends";
import * as B from "@/server/services/task-blocks";
import { addDays, localDate, localTimeOn, weekdayOf } from "@/server/lib/time";
import { whyStillAsking } from "@/lib/act-mode";
import { LOOP_WORDS } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const TZ = "Africa/Lagos";
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, sam: OrgContext;
let design: string;   // the Design team chat (David, Ada, Ben)
let launch: string;   // a channel Ada made with Ben and Olu
let direct: string;   // Ada and Ben's direct thread

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, conversationId: string, body: string, replyToId?: string) => (await sendMessage(c, { conversationId, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
/** The worker's look, a little after the messages (it leaves the last ten seconds for the next look). */
const scan = (seconds = 30) => scanWorkspaceCommitments(owner.org.id, { now: later(seconds), useModel: false });
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;
const notes = (type: string) => adminQuery<{ recipient_membership_id: string; title: string; body: string | null; resource_id: string | null }>(
  "SELECT recipient_membership_id, title, body, resource_id FROM notifications WHERE type = $1 ORDER BY created_at", [type]);
const commitmentOn = async (messageId: string) => (await adminQuery<{ id: string; kind: string; status: string; todo_task_id: string | null; committer_membership_id: string; asker_membership_id: string | null }>(
  "SELECT id, kind, status, todo_task_id, committer_membership_id, asker_membership_id FROM commitments WHERE source_message_id = $1", [messageId]))[0];
const labelOf = async (messageId: string) => (await adminQuery<{ state: string }>("SELECT state FROM message_labels WHERE message_id = $1", [messageId]))[0]?.state ?? null;
/** A weekday at a Lagos time, `days` or more days ahead (Saturday and Sunday skipped). */
function lagosWeekday(days: number, time: string): Date {
  let d = addDays(localDate(new Date(), TZ), days);
  while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
  return localTimeOn(d, time, TZ);
}
type Confirm = Extract<Proposal, { kind: "confirm" }>;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const sales = (await createTeam(owner, "Sales")).id;
  olu = await joinViaInvitation(mary, await createVerifiedUser("olu@company-a.test", "Olu Adeyemi"), "employee", sales, "EMP-010");
  sam = await joinViaInvitation(owner, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(sam), { isManager: true });
  design = await openChannel(david, a.teamId);
  launch = (await createChannel(ada, { title: "Launch", memberIds: [id(ben), id(olu)] })).id;
  direct = await openDirect(ada, id(ben));
});

// ---- Workspace commitments -----------------------------------------------------------------------------------------------

let deckMsg = "", deck = "";

describe("tracking off, then on", () => {
  it("off: nothing is read, noted or labelled", async () => {
    const before = await say(ben, design, "I'll send the deck Thursday");
    expect((await scan()).status).toBe("off");
    expect(await count("SELECT count(*)::int AS n FROM commitments")).toBe(0);
    expect((await thread(ada, design))!.messages.find((m) => m.id === before)!.commitment_label).toBeNull();
    expect((await thread(ada, design))!.commitments).toMatchObject({ ready: true, workspaceOn: false, tracked: false, applies: true });
  });

  it("on: a channel promise is noted, its label is seen by every reader and nobody else, and its committer is asked", async () => {
    await C.saveCommitmentSettings(owner, { track: true });
    deckMsg = await say(ben, design, "I'll send the final deck Thursday");
    const dm = await say(ben, direct, "I'll send the signed contract tomorrow");
    const r = await scan();
    expect(r).toMatchObject({ status: "done", engine: "builtin", created: 1 });
    const row = await commitmentOn(deckMsg);
    expect(row).toMatchObject({ kind: "promise", status: "proposed", committer_membership_id: id(ben) });
    deck = row.id;
    // Direct messages are never read for commitments; what was said before tracking was turned on is never read either.
    expect(await commitmentOn(dm)).toBeUndefined();
    expect(await count("SELECT count(*)::int AS n FROM commitments")).toBe(1);

    // The label: everyone in #Design (Ada, Ben, David) sees "Noted" on Ben's message; Olu, who is not in it, reads none.
    for (const c of [ada, ben, david]) {
      const t = (await thread(c, design))!;
      expect(t.messages.find((m) => m.id === deckMsg)!.commitment_label).toEqual({ state: "noted", text: LOOP_WORDS.label.noted, private: false });
      expect(t.commitments).toMatchObject({ ready: true, workspaceOn: true, here: true, tracked: true, applies: true });
    }
    expect(await appQueryAs(olu.user.profileId, "SELECT id FROM message_labels WHERE message_id = $1", [deckMsg])).toEqual([]);
    expect(await thread(olu, design).catch(() => null)).toBeNull();
    // A direct thread shows no disclosure and no switch.
    expect((await thread(ada, direct))!.commitments).toMatchObject({ applies: false, tracked: false });

    // Ben's own assistant brings it to him, and only him.
    const waiting = await C.waitingCommitments(ben);
    expect(waiting.map((w) => w.kind === "blocked_on" ? null : w.commitment.id)).toEqual([deck]);
    expect(waiting[0]).toMatchObject({ kind: "commitment", commitment: { title: "Send the final deck", canAccept: true, acceptMakesTodo: true } });
    expect((await notes("brenda.commitment")).map((n) => [n.recipient_membership_id, n.resource_id])).toEqual([[id(ben), deck]]);
    expect(await C.waitingCommitments(ada)).toEqual([]);
  });

  it("Accept makes Ben's own to-do, linked to the commitment and the message", async () => {
    const dueAt = localTimeOn(addDays(localDate(new Date(), TZ), 1), "15:00", TZ).toISOString();
    const { commitment } = await C.acceptCommitment(ben, deck, { dueAt });
    expect(commitment).toMatchObject({ status: "open", display: "open" });
    expect(commitment.todo).not.toBeNull();
    const row = await commitmentOn(deckMsg);
    expect(row.todo_task_id).toBe(commitment.todo!.id);
    const [task] = await adminQuery<{ assignee_membership_id: string; title: string; expected_output: string; due_at: string }>(
      "SELECT assignee_membership_id, title, expected_output, due_at FROM tasks WHERE id = $1", [row.todo_task_id]);
    expect(task.assignee_membership_id).toBe(id(ben));
    expect(task.title).toBe("Send the final deck");
    expect(new Date(task.due_at).toISOString()).toBe(dueAt);
    // The to-do says where it was said (its "expected output" holds the quick to-do's description).
    expect(task.expected_output).toContain(`/messages?c=${design}#m-${deckMsg}`);
    expect(await labelOf(deckMsg)).toBe("noted");
    expect(await C.waitingCommitments(ben)).toEqual([]);
  });

  it("a conversation switched off is not read; a direct thread cannot be switched on", async () => {
    await expect(C.setConversationTracking(ben, launch, false)).rejects.toMatchObject({ status: 403, message: LOOP_WORDS.conversationSwitch.forbidden });
    expect(await C.setConversationTracking(ada, launch, false)).toEqual({ trackCommitments: false });
    await expect(C.setConversationTracking(ada, direct, true)).rejects.toMatchObject({ status: 422, message: LOOP_WORDS.errors.direct });
    const off = await say(ben, launch, "I'll update the pricing page tomorrow");
    expect((await scan()).created).toBe(0);
    expect(await commitmentOn(off)).toBeUndefined();
    expect((await thread(olu, launch))!.commitments).toMatchObject({ workspaceOn: true, here: false, tracked: false });
  });
});

let budgetAsk = "", budget = "", loginAsk = "", login = "";

describe("an open ask nobody agreed to", () => {
  it("waits an hour, then the asked person's assistant brings it; Take it on makes the commitment", async () => {
    budgetAsk = await say(ada, design, "Ben, can you review the budget by Friday?");
    expect((await scan()).created).toBe(1);
    const row = await commitmentOn(budgetAsk);
    expect(row).toMatchObject({ kind: "open_ask", status: "asked", committer_membership_id: id(ben), asker_membership_id: id(ada) });
    budget = row.id;
    expect(await labelOf(budgetAsk)).toBeNull();
    expect(await C.waitingCommitments(ben)).toEqual([]);
    await C.sweepCommitments({ now: later(30 * 60) });
    expect(await C.waitingCommitments(ben)).toEqual([]);
    expect((await C.sweepCommitments({ now: later(61 * 60) })).asksDelivered).toBe(1);
    const waiting = await C.waitingCommitments(ben);
    expect(waiting).toMatchObject([{ kind: "open_ask", commitment: { id: budget } }]);
    expect((await notes("brenda.open_ask")).map((n) => [n.recipient_membership_id, n.resource_id])).toEqual([[id(ben), budget]]);
    const { commitment } = await C.acceptCommitment(ben, budget, {});
    expect(commitment.status).toBe("open");
    expect(commitment.todo).not.toBeNull();
    // Ada, who asked, is told it was taken on; nobody else.
    expect((await notes("brenda.commitment_accepted")).map((n) => n.recipient_membership_id)).toEqual([id(ada)]);
  });

  it("declined: only the asker is told, with the reason", async () => {
    const ask = await say(ada, design, "Ben, could you send the invoices by Monday?");
    await scan();
    const row = await commitmentOn(ask);
    expect(row.kind).toBe("open_ask");
    await C.sweepCommitments({ now: later(61 * 60) });
    const v = await C.declineCommitment(ben, row.id, "I don't have the invoices");
    expect(v.status).toBe("declined");
    const told = await notes("brenda.commitment_declined");
    expect(told.map((n) => n.recipient_membership_id)).toEqual([id(ada)]);
    expect(told[0].body).toBe("“I don't have the invoices”");
    // Nothing reaches a supervisor: David's team view never shows a declined one.
    expect((await C.listCommitments(david, { scope: "team" })).items.map((i) => i.id)).not.toContain(row.id);
  });
});

describe("following a commitment through", () => {
  it("the due reminder goes to the committer alone, and waits out their quiet hours", async () => {
    const day = addDays(localDate(new Date(), TZ), 1);
    expect((await runCommitmentFollowThrough({ now: localTimeOn(day, "12:00", TZ) })).reminded).toBe(0);
    await saveQuietHours(ben, { enabled: true, start: "12:00", end: "16:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: null });
    expect((await runCommitmentFollowThrough({ now: localTimeOn(day, "13:30", TZ) })).reminded).toBe(0);
    await saveQuietHours(ben, { enabled: false });
    expect((await runCommitmentFollowThrough({ now: localTimeOn(day, "13:35", TZ) })).reminded).toBe(1);
    expect((await notes("brenda.commitment_due")).map((n) => [n.recipient_membership_id, n.resource_id])).toEqual([[id(ben), deck]]);
    expect((await runCommitmentFollowThrough({ now: localTimeOn(day, "13:40", TZ) })).reminded).toBe(0);
    expect(await notes("brenda.commitment_due")).toHaveLength(1);
  });

  it("two working days overdue with no progress: the asker is told privately and the lead's report has it", async () => {
    loginAsk = await say(ada, design, "Ben, can you fix the login bug by Friday?");
    const ok = await say(ben, design, "On it", loginAsk);
    expect((await scan()).created).toBe(1);
    const row = await commitmentOn(loginAsk);
    expect(row).toMatchObject({ kind: "agreed_ask", status: "proposed" });
    login = row.id;
    expect(await labelOf(ok)).toBe("noted");
    await C.acceptCommitment(ben, login, { dueAt: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    expect((await runCommitmentFollowThrough()).stalledNoted).toBe(1);
    const told = await notes("brenda.commitment_stalled");
    expect(told.map((n) => [n.recipient_membership_id, n.resource_id])).toEqual([[id(ada), login]]);
    expect(told[0].title).toBe(LOOP_WORDS.notifications.stalled("Fix the login bug"));
    expect((await runCommitmentFollowThrough()).stalledNoted).toBe(0);

    const report = await buildDailyReport(david, { useAssistant: false });
    expect(report.commitments!.overdue!.map((d) => d.text).join("\n")).toContain("Fix the login bug");
    expect(report.commitments!.madeToday!.length).toBeGreaterThanOrEqual(3);
    const md = commitmentsMarkdown(david.org.slug, report.commitments!).join("\n");
    expect(md).toContain("## Commitments");
    expect(md).toContain("**Overdue**");
    expect(md).toContain(`[commitment](/app/company-a/commitments?c=${login})`);
  });

  it("a gentle follow-up appears in the thread only when that switch is on, inside working hours, once", async () => {
    const workday = lagosWeekday(3, "10:00");
    expect((await runCommitmentFollowThrough({ now: workday })).threadPosts).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE author_kind = 'workspace'")).toBe(0);
    await C.saveCommitmentSettings(owner, { threadFollowUps: true });
    expect((await runCommitmentFollowThrough({ now: lagosWeekday(3, "21:00") })).threadPosts).toBe(0);
    expect((await runCommitmentFollowThrough({ now: workday })).threadPosts).toBe(1);
    const posted = await adminQuery<{ id: string; body: string; reply_to_id: string; conversation_id: string; sender_membership_id: string }>(
      "SELECT id, body, reply_to_id, conversation_id, sender_membership_id FROM messages WHERE author_kind = 'workspace'");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ conversation_id: design, sender_membership_id: id(ben) });
    expect(posted[0].body.startsWith("A gentle nudge on this")).toBe(true);
    // Shown as the workspace's assistant to everyone, Ben included: never as his own message.
    const seen = (await thread(ben, design))!.messages.find((m) => m.id === posted[0].id)!;
    expect(seen).toMatchObject({ author_kind: "workspace", mine: false });
    expect((await runCommitmentFollowThrough({ now: workday })).threadPosts).toBe(0);
  });
});

describe("the Commitments page's audience", () => {
  it("the lead sees their team's open and done ones; a member only their own; another team's lead nothing", async () => {
    const team = await C.listCommitments(david, { scope: "team" });
    expect(team.scopes).toEqual(expect.arrayContaining(["mine", "team"]));
    expect(team.items.map((i) => i.id).sort()).toEqual([budget, deck, login].sort());
    expect(team.items.every((i) => i.viewer === "supervisor")).toBe(true);
    expect(team.items.find((i) => i.id === login)!.display).toBe("overdue");
    expect((await C.listCommitments(david, { scope: "team", status: "overdue" })).items.map((i) => i.id)).toEqual([login]);

    const mine = await C.listCommitments(ada, { scope: "mine" });
    expect(mine.scopes).toEqual(["mine"]);
    // Ada asked for the budget review and the login fix (and the invoices Ben declined); Ben's deck is not hers.
    expect(mine.items.map((i) => i.id)).not.toContain(deck);
    expect(mine.items.map((i) => i.id)).toEqual(expect.arrayContaining([budget, login]));
    expect(mine.items.every((i) => i.viewer === "asker")).toBe(true);
    await expect(C.listCommitments(ada, { scope: "team" })).rejects.toMatchObject({ status: 403 });
    await expect(C.listCommitments(ada, { scope: "all" })).rejects.toMatchObject({ status: 403 });

    expect((await C.listCommitments(sam, { scope: "team" })).items).toEqual([]);
    expect((await C.listCommitments(owner, { scope: "all" })).items.map((i) => i.id)).toEqual(expect.arrayContaining([budget, deck, login]));
    expect(await C.getCommitment(olu, deck)).toBeNull();
  });
});

// ---- Loose ends -------------------------------------------------------------------------------------------------------------

describe("loose ends, the person's own", () => {
  let promiseMsg = "", askedDm = "", askedChannel = "", iAsked = "", notAda = "";

  it("finds the three kinds in a direct thread and a channel, only what involves the person, and nothing already noted", async () => {
    promiseMsg = await say(ada, direct, "I'll send the slides tomorrow");
    askedDm = await say(ben, direct, "Can you check the budget sheet by Friday?");
    askedChannel = await say(olu, launch, "Ada, can you send the logo files tomorrow?");
    iAsked = await say(ada, launch, "Ben, could you update the pricing page by Monday?");
    notAda = await say(ben, launch, "Olu, can you share the report tomorrow?");
    const r = await scanLooseEnds(ada, { source: "on_demand" });
    expect(r).toMatchObject({ ready: true, engine: "builtin" });
    const rows = await adminQuery<{ id: string; message_id: string; kind: string; membership_id: string; counterpart_membership_id: string | null }>(
      "SELECT id, message_id, kind, membership_id, counterpart_membership_id FROM loose_ends WHERE membership_id = $1", [id(ada)]);
    const kindOf = (m: string) => rows.find((x) => x.message_id === m)?.kind;
    expect(kindOf(promiseMsg)).toBe("promise");
    expect(kindOf(askedDm)).toBe("asked_of_me");
    expect(kindOf(askedChannel)).toBe("asked_of_me");
    expect(kindOf(iAsked)).toBe("i_asked");
    expect(rows.find((x) => x.message_id === iAsked)!.counterpart_membership_id).toBe(id(ben));
    // In a channel, only what involves Ada; and her asks already noted as commitments are not suggested again.
    expect(kindOf(notAda)).toBeUndefined();
    for (const m of [budgetAsk, loginAsk]) expect(kindOf(m)).toBeUndefined();
    // On demand at most every two minutes.
    await expect(scanLooseEnds(ada, { source: "on_demand" })).rejects.toMatchObject({ status: 429, message: LOOP_WORDS.errors.scanCooldown });
  });

  it("private to the person: nobody else reads them, not the lead, the owner or HR", async () => {
    const mine = await LE.listLooseEnds(ada);
    expect(mine.counts.open).toBeGreaterThanOrEqual(4);
    for (const c of [ben, david, owner, mary]) {
      expect(await appQueryAs(c.user.profileId, "SELECT id FROM loose_ends WHERE membership_id = $1", [id(ada)])).toEqual([]);
    }
  });

  it("Ben's promise noted as a commitment never comes back as his loose end", async () => {
    await scanLooseEnds(ben, { source: "routine" });
    const benRows = await adminQuery<{ message_id: string }>("SELECT message_id FROM loose_ends WHERE membership_id = $1", [id(ben)]);
    expect(benRows.map((x) => x.message_id)).not.toContain(deckMsg);
    expect(benRows.map((x) => x.message_id)).not.toContain(loginAsk);
  });

  it("Make it a to-do still asks, even when Ada lets her assistant act without asking; her Confirm adds it", async () => {
    const le = (await LE.listLooseEnds(ada)).items.find((x) => x.message.id === askedChannel)!;
    await saveActMode(ada, "auto");
    const state = await actModeFor(ada);
    expect(state.effective).toBe("auto");
    const tasksBefore = await count("SELECT count(*)::int AS n FROM tasks");
    const r = await runBrendaTool(ada, "loose_end_action", { looseEndId: le.id, action: "todo", title: "Send the logo files" }, "chat",
      { act: { state, engine: "claude", earlierTaint: false, assistantName: "Brenda" } });
    expect(r.actions).toEqual([]);
    const card = r.proposals.find((p): p is Confirm => p.kind === "confirm")!;
    expect(card).toBeTruthy();
    expect(card.why).toBe(whyStillAsking("others_words_todo", { name: "Brenda" }));
    expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore);
    expect((await confirmAction(ada, card.token)).error).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM tasks")).toBe(tasksBefore + 1);
    expect((await adminQuery<{ status: string }>("SELECT status FROM loose_ends WHERE id = $1", [le.id]))[0].status).toBe("todo");
    await saveActMode(ada, "ask");
  });

  it("Not a commitment is remembered: a later look never suggests it again", async () => {
    const le = (await LE.listLooseEnds(ada)).items.find((x) => x.message.id === askedDm)!;
    expect((await LE.dismissLooseEnd(ada, le.id)).status).toBe("dismissed");
    expect(await LE.knownLooseEndMessages(ada, [askedDm])).toEqual(new Set([askedDm]));
    await scanLooseEnds(ada, { source: "routine" });
    expect(await count("SELECT count(*)::int AS n FROM loose_ends WHERE membership_id = $1 AND message_id = $2", [id(ada), askedDm])).toBe(1);
    expect((await LE.listLooseEnds(ada, { status: "open" })).items.map((x) => x.message.id)).not.toContain(askedDm);
  });
});

// ---- Blocked on whom ---------------------------------------------------------------------------------------------------------

describe("blocked on whom", () => {
  it("Ben names Ada and his question; her assistant brings it; her answer is her comment and unblocks the task", async () => {
    const t = await createTask(david, { projectId: a.projectId, title: "Landing copy", expectedOutput: "Copy for the landing page.", assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: 60, dueAt: null, captureRequirement: "none", addToMyDay: false });
    const v1 = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]))[0].version;
    await updateTask(ben, t.id, { expectedVersion: v1, status: "in_progress" });
    const v2 = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]))[0].version;
    await updateTask(ben, t.id, { expectedVersion: v2, status: "blocked", reason: "Waiting for the brand words" });
    const block = await B.setBlock(ben, t.id, { waitingOn: id(ada), question: "Can you send the brand words?" });
    expect(block).toMatchObject({ status: "open", viewer: "blocked", question: "Can you send the brand words?" });

    const inbox = await B.waitingBlocks(ada);
    expect(inbox).toMatchObject([{ kind: "blocked_on", block: { id: block.id, canAnswer: true, canNotMe: true } }]);
    expect((await notes("brenda.blocked_on")).map((n) => [n.recipient_membership_id, n.resource_id])).toEqual([[id(ada), block.id]]);
    expect(await B.waitingBlocks(ben)).toEqual([]);
    // David sees who his team is waiting on.
    const w = await B.waitingOnList(david, { scope: "team" });
    expect(w.items.map((x) => x.id)).toEqual([block.id]);
    expect(w.byPerson).toEqual([{ waitingOn: expect.objectContaining({ membershipId: id(ada) }), count: 1 }]);
    expect((await B.waitingOnList(sam, { scope: "team" })).items).toEqual([]);

    const answered = await B.answerBlock(ada, block.id, { answer: "Sent them to your inbox just now", unblock: true });
    expect(answered).toMatchObject({ status: "answered", unblocked: true });
    const [comment] = await adminQuery<{ author_membership_id: string; body: string }>("SELECT author_membership_id, body FROM task_comments WHERE task_id = $1", [t.id]);
    expect(comment.author_membership_id).toBe(id(ada));
    expect(comment.body).toContain("Sent them to your inbox just now");
    expect((await adminQuery<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [t.id]))[0].status).toBe("in_progress");
    expect((await notes("brenda.block_answered")).map((n) => n.recipient_membership_id)).toEqual([id(ben)]);
    expect(await B.waitingBlocks(ada)).toEqual([]);
  });
});
