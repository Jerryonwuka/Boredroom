/**
 * Blocked on whom (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). The person
 * a blocked task is assigned to names who it waits on and the question; that person's assistant brings it to them; their
 * answer is posted on the task as THEIR comment (even when they cannot open the task) and "This unblocks it" moves the
 * task back to In progress as their action; "Not me" tells the blocked person; a block that is no longer true clears
 * itself; leads see who is waiting on whom.
 *
 * Company A: Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor), Sam Sales (leads Sales: Olu Adeyemi).
 * Ada holds "Homepage design" (David checks it; Ada and Ben are on its project). Local test database only
 * (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { updateTask } from "@/server/services/tasks";
import * as B from "@/server/services/task-blocks";
import { LOOP_WORDS } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, sam: OrgContext;
let oluUser: FixtureUser;
let homepage: string;

const id = (c: OrgContext) => c.membership.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const taskRow = async (t: string) => (await adminQuery<{ status: string; version: number; blocked_reason: string | null }>("SELECT status, version, blocked_reason FROM tasks WHERE id = $1", [t]))[0];
const notifications = (membershipId: string, type: string) => adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null }>(
  "SELECT title, body, href, resource_id FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [membershipId, type]);
/** Ada marks the task blocked (moving it to In progress first when needed). */
async function blocked(t: string, reason = "Waiting for the copy") {
  let r = await taskRow(t);
  if (r.status === "blocked") return;
  if (r.status !== "in_progress") { await updateTask(ada, t, { expectedVersion: r.version, status: "in_progress" }); r = await taskRow(t); }
  await updateTask(ada, t, { expectedVersion: r.version, status: "blocked", reason });
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const sales = (await createTeam(owner, "Sales")).id;
  oluUser = await createVerifiedUser("olu@company-a.test", "Olu Adeyemi");
  olu = await joinViaInvitation(mary, oluUser, "employee", sales, "EMP-010");
  sam = await joinViaInvitation(owner, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(sam), { isManager: true });
  homepage = a.taskIds.homepage;
});

describe("naming who it waits on", () => {
  it("only the person a blocked task is assigned to", async () => {
    await expect(B.setBlock(ada, homepage, { waitingOn: id(ben), question: "Can you send the copy?" })).rejects.toMatchObject({ status: 409, code: "NOT_BLOCKED", message: LOOP_WORDS.errors.notBlocked });
    await blocked(homepage);
    await expect(B.setBlock(ben, homepage, { waitingOn: id(david), question: "Anything" })).rejects.toMatchObject({ status: 403, message: LOOP_WORDS.errors.notHolder });
    await expect(B.setBlock(david, homepage, { waitingOn: id(ben), question: "Anything" })).rejects.toMatchObject({ status: 403 });
    await expect(B.setBlock(ada, homepage, { waitingOn: id(ada), question: "Me?" })).rejects.toMatchObject({ status: 422, message: LOOP_WORDS.errors.self });
    await expect(B.setBlock(ada, homepage, { waitingOn: "11111111-1111-4111-8111-111111111111", question: "Who?" })).rejects.toMatchObject({ status: 422 });
    await expect(B.setBlock(ada, homepage, { waitingOn: id(ben), question: "   " })).rejects.toMatchObject({ status: 422, message: LOOP_WORDS.errors.emptyQuestion });
    // Past the service, the database says the same: Ben cannot name anyone on Ada's task.
    await expect(appQueryAs(a.employee2.profileId,
      `INSERT INTO task_blocks(organisation_id, task_id, blocked_membership_id, waiting_on_membership_id, task_title, question) VALUES ($1, $2, $3, $4, 'Homepage design', 'x')`,
      [owner.org.id, homepage, id(ada), id(david)])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(a.employee2.profileId,
      `INSERT INTO task_blocks(organisation_id, task_id, blocked_membership_id, waiting_on_membership_id, task_title, question) VALUES ($1, $2, $3, $4, 'Homepage design', 'x')`,
      [owner.org.id, homepage, id(ben), id(david)])).rejects.toThrow(/row-level security/);
  });

  it("Ada names Ben: Ben's assistant brings it to him", async () => {
    const v = await B.setBlock(ada, homepage, { waitingOn: id(ben), question: "Can you send the copy?" });
    expect(v).toMatchObject({
      status: "open", viewer: "blocked", taskId: homepage, taskTitle: "Homepage design", taskHref: `/app/company-a/tasks/${homepage}`,
      blocked: { membershipId: id(ada), firstName: "Ada" }, waitingOn: { membershipId: id(ben), firstName: "Ben" },
      question: "Can you send the copy?", answer: null, canCancel: true, canAnswer: false, badge: { label: "Waiting on Ben", tone: "warning" },
      href: `/app/company-a/home/assistants?f=${v.id}`,
    });
    expect(await notifications(id(ben), "brenda.blocked_on")).toEqual([{ title: "Ada is blocked on you", body: "“Can you send the copy?”", href: `/app/company-a/home/assistants?f=${v.id}`, resource_id: v.id }]);
    const w = await B.waitingBlocks(ben);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "blocked_on", block: { id: v.id, viewer: "waiting_on", canAnswer: true, canNotMe: true, canCancel: false, badge: { label: "Needs your answer", tone: "warning" } } });
    const f = await B.blockFor(ada, homepage);
    expect(f).toMatchObject({ ready: true, block: { id: v.id }, last: null });
    expect(f.people.map((p) => p.name)).toEqual(["Ben Okafor", "David Lead", "Grace Owner", "Mary HR", "Olu Adeyemi", "Sam Sales"]);
    // David leads Ada: he reads it; Sam and Olu do not.
    expect((await B.getBlock(david, v.id))?.viewer).toBe("supervisor");
    expect(await B.getBlock(sam, v.id)).toBeNull();
    expect(await B.getBlock(olu, v.id)).toBeNull();
    await B.markBlockSeen(ben, v.id);
    await expect(B.markBlockSeen(ada, v.id)).rejects.toMatchObject({ status: 404 });
    expect(await adminQuery("SELECT seen_at IS NOT NULL AS seen FROM task_blocks WHERE id = $1", [v.id])).toEqual([{ seen: true }]);
  });

  it("Ben answers and it unblocks it: his comment, the task back in progress as his move, Ada told", async () => {
    const [{ id: blockId }] = await adminQuery<{ id: string }>("SELECT id FROM task_blocks WHERE task_id = $1 AND status = 'open'", [homepage]);
    await expect(B.answerBlock(impersonated(ben), blockId, { answer: "Sent", unblock: true })).rejects.toMatchObject({ status: 403 });
    await expect(B.answerBlock(ada, blockId, { answer: "Sent", unblock: true })).rejects.toMatchObject({ status: 404 });
    await expect(B.answerBlock(ben, blockId, { answer: "x".repeat(1001), unblock: true })).rejects.toMatchObject({ status: 422 });
    const v = await B.answerBlock(ben, blockId, { answer: "Sent it to your inbox just now.", unblock: true });
    expect(v).toMatchObject({ status: "answered", answer: "Sent it to your inbox just now.", unblocked: true, viewer: "waiting_on", badge: { label: "Answered", tone: "success" } });
    expect(await adminQuery("SELECT author_membership_id, body FROM task_comments WHERE id = (SELECT comment_id FROM task_blocks WHERE id = $1)", [blockId]))
      .toEqual([{ author_membership_id: id(ben), body: "Answer to Ada's question: Sent it to your inbox just now." }]);
    expect(await taskRow(homepage)).toMatchObject({ status: "in_progress", blocked_reason: null });
    expect(await adminQuery("SELECT actor_membership_id, from_status, to_status, reason FROM task_status_history WHERE task_id = $1 ORDER BY occurred_at DESC LIMIT 1", [homepage]))
      .toEqual([{ actor_membership_id: id(ben), from_status: "blocked", to_status: "in_progress", reason: "Unblocked by Ben's answer" }]);
    expect(await notifications(id(ada), "brenda.block_answered")).toEqual([expect.objectContaining({ title: "Ben answered: “Sent it to your inbox just now.”", body: "“Homepage design” is back in progress." })]);
    await expect(B.answerBlock(ben, blockId, { answer: "Again", unblock: false })).rejects.toMatchObject({ status: 409, code: "ITEM_CLOSED" });
    expect((await B.blockFor(ada, homepage))).toMatchObject({ block: null, last: { id: blockId, status: "answered" } });
    expect(await B.waitingBlocks(ben)).toEqual([]);
  });

  it("someone who cannot open the task still answers: they see the question and the title Ada sent", async () => {
    await blocked(homepage, "Need the Q4 numbers");
    const v = await B.setBlock(ada, homepage, { waitingOn: id(olu), question: "What are the Q4 numbers?" });
    expect(await adminQuery("SELECT 1 FROM tasks WHERE id = $1", [homepage])).toHaveLength(1);
    const seen = await B.getBlock(olu, v.id);
    expect(seen).toMatchObject({ viewer: "waiting_on", taskTitle: "Homepage design", taskHref: null, canAnswer: true });
    const done = await B.answerBlock(olu, v.id, { answer: "Revenue 1.2m\nCosts 0.8m", unblock: false });
    expect(done).toMatchObject({ status: "answered", unblocked: false });
    expect(await adminQuery("SELECT author_membership_id, body FROM task_comments WHERE id = (SELECT comment_id FROM task_blocks WHERE id = $1)", [v.id]))
      .toEqual([{ author_membership_id: id(olu), body: "Answer to Ada's question: Revenue 1.2m\nCosts 0.8m" }]);
    expect((await taskRow(homepage)).status).toBe("blocked");
    expect((await notifications(id(ada), "brenda.block_answered")).at(-1)).toMatchObject({ body: "“Homepage design” is still blocked." });
  });

  it("not me: closed, and Ada is told to name someone else", async () => {
    const v = await B.setBlock(ada, homepage, { waitingOn: id(ben), question: "Do you have the logo?" });
    // Worded for who reads it: Ben said it, so his card reads "Not mine"; Ada's reads "Not theirs".
    expect(await B.notMeBlock(ben, v.id)).toMatchObject({ status: "not_me", badge: { label: "Not mine", tone: "neutral" } });
    expect((await B.getBlock(ada, v.id))!.badge).toEqual({ label: "Not theirs", tone: "neutral" });
    expect(await notifications(id(ada), "brenda.block_not_me")).toEqual([expect.objectContaining({ title: "Ben says it isn't theirs", body: LOOP_WORDS.notifications.blockNotMeBody })]);
    await expect(B.notMeBlock(ben, v.id)).rejects.toMatchObject({ status: 409 });
    expect((await B.blockFor(ada, homepage)).last).toMatchObject({ id: v.id, status: "not_me" });
  });

  it("one open block a task: naming someone else replaces it; Stop waiting withdraws it", async () => {
    const first = await B.setBlock(ada, homepage, { waitingOn: id(ben), question: "Logo?" });
    const second = await B.setBlock(ada, homepage, { waitingOn: id(david), question: "Logo, please?" });
    expect(await adminQuery("SELECT id, status FROM task_blocks WHERE id = ANY($1::uuid[]) ORDER BY created_at", [[first.id, second.id]]))
      .toEqual([{ id: first.id, status: "cancelled" }, { id: second.id, status: "open" }]);
    expect(await B.cancelBlock(ben, homepage)).toEqual({ cancelled: false });
    expect(await B.cancelBlock(ada, homepage)).toEqual({ cancelled: true });
    expect(await B.cancelBlock(ada, homepage)).toEqual({ cancelled: false });
    expect((await B.getBlock(ada, second.id))!.badge).toEqual({ label: "Withdrawn", tone: "neutral" });
  });

  it("leaving Blocked clears it, in the same change; the worker clears any other that is no longer true", async () => {
    // David, not Ben: Ada has named Ben three times today already, the per-pair limit.
    const v = await B.setBlock(ada, homepage, { waitingOn: id(david), question: "Copy?" });
    const r = await taskRow(homepage);
    await updateTask(ada, homepage, { expectedVersion: r.version, status: "in_progress" });
    expect(await adminQuery("SELECT status, closed_at IS NOT NULL AS closed FROM task_blocks WHERE id = $1", [v.id])).toEqual([{ status: "cleared", closed: true }]);
    expect((await B.getBlock(ada, v.id))!.badge).toEqual({ label: "Unblocked", tone: "neutral" });
    // Moved behind the services' back: the sweep clears it.
    await blocked(homepage);
    const w = await B.setBlock(ada, homepage, { waitingOn: id(david), question: "Copy, again?" });
    await adminQuery("UPDATE tasks SET status = 'in_progress' WHERE id = $1", [homepage]);
    expect(await B.settleBlocks()).toEqual({ cleared: 1 });
    expect(await B.settleBlocks()).toEqual({ cleared: 0 });
    expect(await adminQuery("SELECT status FROM task_blocks WHERE id = $1", [w.id])).toEqual([{ status: "cleared" }]);
    // Anyone may call the settle: it only ever clears.
    expect(await appQueryAs(a.employee2.profileId, "SELECT app_task_block_settle($1) AS n", [homepage])).toEqual([{ n: 0 }]);
  });
});

describe("who is waiting on whom", () => {
  it("mine for everyone, team for leads, everyone's for the owner and HR", async () => {
    await blocked(homepage);
    const v = await B.setBlock(ada, homepage, { waitingOn: id(olu), question: "Can you confirm the budget?" });
    const mine = await B.waitingOnList(ada);
    expect(mine).toMatchObject({ ready: true, scope: "mine" });
    expect(mine.items.map((i) => i.id)).toEqual([v.id]);
    expect(mine.byPerson).toEqual([{ waitingOn: expect.objectContaining({ membershipId: id(olu), name: "Olu Adeyemi" }), count: 1 }]);
    expect((await B.waitingOnList(olu)).items.map((i) => i.id)).toEqual([v.id]);
    expect((await B.waitingOnList(david, { scope: "team" })).items.map((i) => i.id)).toEqual([v.id]);
    expect((await B.waitingOnList(sam, { scope: "team" })).items).toEqual([]);
    expect((await B.waitingOnList(owner, { scope: "all" })).items.map((i) => i.id)).toEqual([v.id]);
    expect((await B.waitingOnList(mary, { scope: "all" })).items.map((i) => i.id)).toEqual([v.id]);
    await expect(B.waitingOnList(ben, { scope: "team" })).rejects.toMatchObject({ status: 403 });
    await expect(B.waitingOnList(david, { scope: "all" })).rejects.toMatchObject({ status: 403 });
    expect((await B.waitingOnList(ben)).items).toEqual([]);
    // Only open ones.
    expect((await B.waitingOnList(owner, { scope: "all" })).items.every((i) => i.status === "open")).toBe(true);
    // Audit rows hold ids only.
    const audit = await adminQuery<{ metadata: Record<string, unknown> }>("SELECT metadata FROM audit_events WHERE action LIKE 'task_block.%'");
    expect(audit.length).toBeGreaterThan(0);
    for (const r of audit) expect(JSON.stringify(r.metadata)).not.toMatch(/budget|copy|logo|Q4/i);
  });
});
