/**
 * The stalled re-plan (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). When a
 * chase finds a task stalled a second time, the lead is offered a new due date; nothing changes until they confirm, and
 * then only through their own permission to change the task. Only the lead reads their proposals; a newer one, or any
 * change to the task since, makes an older one stale.
 *
 * Company A: Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor). Ada holds "Homepage design". Local test
 * database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { createFollowUps } from "@/server/services/follow-ups";
import { updateTask } from "@/server/services/tasks";
import * as RP from "@/server/services/replans";
import { LOOP_WORDS } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let homepage: string;

const id = (c: OrgContext) => c.membership.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const dueOf = async (t: string) => (await adminQuery<{ due_at: string | null; version: number }>("SELECT due_at, version FROM tasks WHERE id = $1", [t]))[0];
/** A follow-up David's chase made about the task (as the chase does: a phase 4 follow-up as David). */
async function chaseFollowUp(): Promise<string> {
  const r = await createFollowUps(david, { subjectMembershipIds: [id(ada)], taskId: homepage, question: "Where is it?" }, { reuse: false });
  return r.created[0].id;
}
const propose = (followUpId: string | null, days = 3) => RP.proposeReplan({
  organisationId: owner.org.id, taskId: homepage, leadMembershipId: id(david), followUpId, proposedDueAt: new Date(Date.now() + days * 86_400_000),
});

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  homepage = a.taskIds.homepage;
});

describe("a re-plan suggested to the lead", () => {
  let first: string;
  let fu1: string;

  it("is made by the worker, read by the lead alone, and changes nothing yet", async () => {
    fu1 = await chaseFollowUp();
    const before = await dueOf(homepage);
    first = (await propose(fu1))!;
    expect(first).toBeTruthy();
    expect(await dueOf(homepage)).toEqual(before);
    // Once per follow-up.
    expect(await propose(fu1)).toBeNull();
    const v = await RP.replanForFollowUp(david, fu1);
    expect(v).toMatchObject({ id: first, status: "proposed", taskId: homepage, taskTitle: "Homepage design", taskHref: `/app/company-a/tasks/${homepage}`, previousDueAt: before.due_at, followUpId: fu1, canConfirm: true });
    expect(v!.proposedLabel).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
    expect((await RP.listOpenReplans(david)).map((r) => r.id)).toEqual([first]);
    for (const c of [ada, ben, owner]) {
      expect(await RP.replanForFollowUp(c, fu1)).toBeNull();
      expect(await RP.listOpenReplans(c)).toEqual([]);
    }
    for (const who of [a.employee, a.owner, a.hr]) expect(await appQueryAs(who.profileId, "SELECT id FROM replan_proposals")).toEqual([]);
  });

  it("anyone else: 404, and the lead's answer refused for everyone else in the database too", async () => {
    await expect(RP.confirmReplan(ada, first, {})).rejects.toMatchObject({ status: 404 });
    await expect(RP.confirmReplan(owner, first, {})).rejects.toMatchObject({ status: 404 });
    await expect(RP.dismissReplan(ben, first)).rejects.toMatchObject({ status: 404 });
    await expect(RP.confirmReplan(impersonated(david), first, {})).rejects.toMatchObject({ status: 403 });
    expect(await appQueryAs(a.owner.profileId, "SELECT app_replan_decide($1, 'confirm', now()) AS r", [first])).toEqual([{ r: "not_found" }]);
    expect(await appQueryAs(a.manager.profileId, "SELECT app_replan_decide($1, 'confirm', NULL) AS r", [first])).toEqual([{ r: "no_date" }]);
    expect(await appQueryAs(a.manager.profileId, "SELECT app_replan_decide($1, 'maybe', NULL) AS r", [first])).toEqual([{ r: "bad_decision" }]);
  });

  it("a newer suggestion makes the older one stale", async () => {
    const fu2 = await chaseFollowUp();
    const second = (await propose(fu2, 5))!;
    expect(second).toBeTruthy();
    expect((await RP.replanForFollowUp(david, fu1))!.status).toBe("stale");
    await expect(RP.confirmReplan(david, first, {})).rejects.toMatchObject({ status: 409, message: LOOP_WORDS.replan.stale });
    expect((await RP.listOpenReplans(david)).map((r) => r.id)).toEqual([second]);
  });

  it("the lead confirms: the due date moves through their own change of the task", async () => {
    const [open] = await RP.listOpenReplans(david);
    const before = await dueOf(homepage);
    const v = await RP.confirmReplan(david, open.id, {});
    expect(v).toMatchObject({ status: "confirmed", confirmedDueAt: open.proposedDueAt, canConfirm: false });
    const after = await dueOf(homepage);
    expect(after.due_at).toBe(open.proposedDueAt);
    expect(after.version).toBe(before.version + 1);
    expect(await adminQuery("SELECT action, actor_membership_id FROM audit_events WHERE subject_id = $1 AND action IN ('task.updated', 'replan.confirmed') ORDER BY occurred_at DESC LIMIT 2", [homepage]))
      .toEqual(expect.arrayContaining([{ action: "task.updated", actor_membership_id: id(david) }, { action: "replan.confirmed", actor_membership_id: id(david) }]));
    await expect(RP.confirmReplan(david, open.id, {})).rejects.toMatchObject({ status: 409 });
  });

  // Ada has had her two follow-ups about this task today (phase 4's pair cap): the rest carry no follow-up.
  it("a date of the lead's own, and Not now", async () => {
    const p = (await propose(null, 4))!;
    const mine = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const v = await RP.confirmReplan(david, p, { dueAt: mine });
    expect(v.confirmedDueAt).toBe(mine);
    expect((await dueOf(homepage)).due_at).toBe(mine);
    const q = (await propose(null, 6))!;
    expect(await RP.dismissReplan(david, q)).toMatchObject({ status: "dismissed", canConfirm: false });
    expect((await dueOf(homepage)).due_at).toBe(mine);
  });

  it("the task changed since: stale; finished or archived: no suggestion at all", async () => {
    const p = (await propose(null, 2))!;
    const t = await dueOf(homepage);
    await updateTask(david, homepage, { expectedVersion: t.version, dueAt: new Date(Date.now() + 20 * 86_400_000).toISOString() });
    expect((await RP.listOpenReplans(david)).map((r) => r.id)).not.toContain(p);
    expect(await adminQuery("SELECT status FROM replan_proposals WHERE id = $1", [p])).toEqual([{ status: "stale" }]);
    await adminQuery("UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = $1", [homepage]);
    expect(await propose(null)).toBeNull();
    await adminQuery("UPDATE tasks SET status = 'in_progress', completed_at = NULL, archived_at = now() WHERE id = $1", [homepage]);
    expect(await propose(null)).toBeNull();
  });
});
