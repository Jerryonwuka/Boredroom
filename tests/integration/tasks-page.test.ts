/**
 * Tasks page: team leads create and assign; staff see what is assigned to them; scope follows role.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { quickTodo, assignableMembers } from "@/server/services/tasks";
import { tasksView, notificationsView } from "@/server/services/views";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
});

describe("tasks page", () => {
  it("a team lead creates a task with a priority and hands it to Ada; Ada sees it under her tasks and is notified", async () => {
    const t = await quickTodo(a.managerCtx, { title: "Update the pricing table", description: "Use the new tiers from finance.", assigneeMembershipId: a.employeeCtx.membership.id, priority: "high", dueAt: new Date(Date.now() + 86400000).toISOString() });
    const mine = await tasksView(a.employeeCtx);
    expect(mine.scope).toBe("mine");
    expect(mine.people).toEqual([]);
    const row = mine.tasks.find((x) => x.id === t.id)!;
    expect(row).toMatchObject({ title: "Update the pricing table", priority: "high", created_by_name: "David Manager", assignee_name: "Ada Employee", status: "todo" });
    // Everything assigned to Ada, nothing assigned to anyone else.
    expect(mine.tasks.every((x) => x.assignee_membership_id === a.employeeCtx.membership.id)).toBe(true);
    expect(mine.tasks.map((x) => x.title)).not.toContain("Pricing page copy");
    expect((await notificationsView(a.employeeCtx)).some((n) => n.type === "task.assigned" && n.title.includes("Update the pricing table"))).toBe(true);
  });

  it("the lead sees every task on their team, can narrow to one person, and the counts follow the filter", async () => {
    const lead = await tasksView(a.managerCtx);
    expect(lead.scope).toBe("lead");
    expect(lead.people.map((p) => [p.display_name, p.group])).toEqual([["Ada Employee", "team"], ["Ben Employee", "team"], ["David Manager", "team"], ["Mary HR", "organisation"], ["Olu Owner", "organisation"]]);
    expect(lead.tasks.map((x) => x.title).sort()).toEqual(["Client kickoff meeting", "Homepage design", "Pricing page copy", "Update the pricing table"]);
    expect(lead.tasks.every((x) => x.team_name === "Design")).toBe(true);
    // Priority orders the open list (both high), then the sooner due date.
    expect(lead.tasks[0].title).toBe("Update the pricing table"); // high, due tomorrow
    expect(lead.tasks[1].title).toBe("Homepage design"); // high, due in three days
    const ben = await tasksView(a.managerCtx, { who: a.employee2Ctx.membership.id });
    expect(ben.who).toBe(a.employee2Ctx.membership.id);
    expect(ben.tasks.map((x) => x.title)).toEqual(["Pricing page copy"]);
    expect(ben.counts).toEqual({ open: 1, check: 0, done: 0 });
    // An unknown id is ignored rather than leaking.
    const outside = await tasksView(a.managerCtx, { who: "00000000-0000-4000-8000-000000000000" });
    expect(outside.who).toBeNull();
    expect(outside.tasks.length).toBe(4);
  });

  it("organisation accounts see everything read-only; staff only ever see their own", async () => {
    const owner = await tasksView(a.ownerCtx, { status: "all" });
    expect(owner.scope).toBe("org");
    expect(owner.people.map((p) => p.display_name)).toEqual(["Ada Employee", "Ben Employee", "David Manager", "Mary HR", "Olu Owner"]);
    expect(owner.tasks.length).toBe(4);
    const ben = await tasksView(a.employee2Ctx, { status: "all" });
    expect(ben.scope).toBe("mine");
    expect(ben.tasks.map((x) => x.title)).toEqual(["Pricing page copy"]);
    // The who filter does nothing for staff.
    const sneaky = await tasksView(a.employee2Ctx, { who: a.employeeCtx.membership.id });
    expect(sneaky.tasks.map((x) => x.title)).toEqual(["Pricing page copy"]);
  });

  it("status tabs split to-do, sent for check and done", async () => {
    const empty = await tasksView(a.employeeCtx, { status: "done" });
    expect(empty.tasks).toEqual([]);
    const check = await tasksView(a.employeeCtx, { status: "check" });
    expect(check.tasks).toEqual([]);
    const open = await tasksView(a.employeeCtx, { status: "open" });
    expect(open.counts.open).toBe(open.tasks.length);
    expect(open.counts.open).toBe(3);
  });
});

describe("handing tasks upwards", () => {
  it("a team lead can assign a task to the owner, HR or another lead; the owner sees it, marks it done, and it goes back to the lead for a check", async () => {
    const { assignableMembers, completeTask, createTask } = await import("@/server/services/tasks");
    const people = await assignableMembers(a.managerCtx);
    expect(people.map((p) => [p.display_name, p.group])).toEqual([["Ada Employee", "team"], ["Ben Employee", "team"], ["Mary HR", "organisation"], ["Olu Owner", "organisation"]]);
    expect(people.find((p) => p.display_name === "Olu Owner")?.team_name).toBe("Organisation owner");
    const t = await quickTodo(a.managerCtx, { title: "Approve the Q4 design budget", assigneeMembershipId: a.ownerCtx.membership.id, priority: "urgent" });
    // The owner sees it on their Tasks page, assigned to themself, with the lead as checker.
    const owner = await tasksView(a.ownerCtx);
    const row = owner.tasks.find((x) => x.id === t.id)!;
    expect(row).toMatchObject({ assignee_membership_id: a.ownerCtx.membership.id, reviewer_membership_id: a.managerCtx.membership.id, created_by_name: "David Manager", priority: "urgent" });
    expect((await notificationsView(a.ownerCtx)).some((n) => n.type === "task.assigned" && n.title.includes("Approve the Q4 design budget"))).toBe(true);
    // The lead's own list shows what they handed up, and the person filter can narrow to the owner.
    const lead = await tasksView(a.managerCtx);
    expect(lead.tasks.map((x) => x.title)).toContain("Approve the Q4 design budget");
    expect(lead.people.map((p) => p.display_name)).toEqual(["Ada Employee", "Ben Employee", "David Manager", "Mary HR", "Olu Owner"]);
    const onlyOwner = await tasksView(a.managerCtx, { who: a.ownerCtx.membership.id });
    expect(onlyOwner.tasks.map((x) => x.title)).toEqual(["Approve the Q4 design budget"]);
    // Owner marks it done without a timer: it goes to David for a check.
    const done = await completeTask(a.ownerCtx, t.id, { note: "" });
    expect(done.completed).toBe(false);
    expect((await tasksView(a.managerCtx, { status: "check" })).tasks.map((x) => x.title)).toEqual(["Approve the Q4 design budget"]);
    // HR and another lead can be assignees too; the owner still cannot give themself a task.
    await quickTodo(a.managerCtx, { title: "Send the contract to legal", assigneeMembershipId: a.hrCtx.membership.id });
    expect((await tasksView(a.hrCtx)).tasks.map((x) => x.title)).toContain("Send the contract to legal");
    await expect(createTask(a.ownerCtx, { projectId: a.projectId, title: "Owner task", expectedOutput: "x", assigneeMembershipId: a.ownerCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false })).rejects.toMatchObject({ status: 422 });
    // Staff still cannot hand tasks to anyone.
    await expect(quickTodo(a.employeeCtx, { title: "Not allowed", assigneeMembershipId: a.ownerCtx.membership.id })).rejects.toMatchObject({ status: 403 });
  });
});

describe("who can hand tasks to whom", () => {
  it("a team lead who leads no team yet, or a lead handing to another team's member, is not blocked by the project check", async () => {
    const { createVerifiedUser, joinViaInvitation } = await import("@/server/services/fixtures");
    const { createTeam, setTeamMember } = await import("@/server/services/orgs");
    // Fabro is a team lead by role but is only a member (not the lead) of a second team.
    const marketing = await createTeam(a.ownerCtx, "Marketing");
    const fabro = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("fabro@company-a.test", "Fabro Fashion"), "manager", marketing.id, "MGR-002");
    const people = await assignableMembers(fabro);
    expect(people.every((p) => p.group === "organisation")).toBe(true);
    expect(people.map((p) => p.display_name)).toContain("Ada Employee");
    const t = await quickTodo(fabro, { title: "New videos", assigneeMembershipId: a.employeeCtx.membership.id });
    expect((await tasksView(a.employeeCtx)).tasks.map((x) => x.id)).toContain(t.id);
    expect((await tasksView(fabro)).tasks.map((x) => x.id)).toContain(t.id); // scope is lead by role, and hand-outs are listed
    // Once Fabro leads Marketing, hand-outs to Ada (Design) still work and land in a project Fabro leads.
    await setTeamMember(a.ownerCtx, marketing.id, fabro.membership.id, { isManager: true });
    const t2 = await quickTodo(fabro, { title: "Shoot the launch video", assigneeMembershipId: a.employeeCtx.membership.id });
    const row = (await adminQuery<{ project_id: string }>(`SELECT project_id FROM tasks WHERE id = $1`, [t2.id]))[0];
    const lead = await adminQuery(`SELECT 1 FROM project_members WHERE project_id = $1 AND membership_id = $2 AND access_role = 'lead'`, [row.project_id, fabro.membership.id]);
    expect(lead.length).toBe(1);
  });

  it("the owner adds a task for a staff member from the Tasks page; it is filed under the member's team project", async () => {
    const people = await assignableMembers(a.ownerCtx);
    expect(people.map((p) => [p.display_name, p.group])).toContainEqual(["Ada Employee", "team"]);
    expect(people.map((p) => [p.display_name, p.group])).toContainEqual(["Mary HR", "organisation"]);
    const t = await quickTodo(a.ownerCtx, { title: "Prepare the board pack", assigneeMembershipId: a.employee2Ctx.membership.id });
    const row = (await adminQuery<{ project_id: string; reviewer_membership_id: string }>(`SELECT project_id, reviewer_membership_id FROM tasks WHERE id = $1`, [t.id]))[0];
    const teamProject = (await adminQuery<{ project_id: string }>(`SELECT project_id FROM teams WHERE id = $1`, [a.teamId]))[0].project_id;
    expect(row.project_id).toBe(teamProject);
    expect(row.reviewer_membership_id).toBe(a.ownerCtx.membership.id);
    expect((await tasksView(a.employee2Ctx)).tasks.map((x) => x.title)).toContain("Prepare the board pack");
    // Still no tasks for themselves.
    await expect(quickTodo(a.ownerCtx, { title: "Mine" })).rejects.toMatchObject({ status: 403 });
  });
});
