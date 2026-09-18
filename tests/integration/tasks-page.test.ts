/**
 * Tasks page: team leads create and assign; staff see what is assigned to them; scope follows role.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { quickTodo } from "@/server/services/tasks";
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
    expect(lead.people.map((p) => p.display_name)).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    expect(lead.tasks.map((x) => x.title).sort()).toEqual(["Client kickoff meeting", "Homepage design", "Pricing page copy", "Update the pricing table"]);
    expect(lead.tasks.every((x) => x.team_name === "Design")).toBe(true);
    // Priority orders the open list (both high), then the sooner due date.
    expect(lead.tasks[0].title).toBe("Update the pricing table"); // high, due tomorrow
    expect(lead.tasks[1].title).toBe("Homepage design"); // high, due in three days
    const ben = await tasksView(a.managerCtx, { who: a.employee2Ctx.membership.id });
    expect(ben.who).toBe(a.employee2Ctx.membership.id);
    expect(ben.tasks.map((x) => x.title)).toEqual(["Pricing page copy"]);
    expect(ben.counts).toEqual({ open: 1, check: 0, done: 0 });
    // An id outside the lead's teams is ignored rather than leaking.
    const outside = await tasksView(a.managerCtx, { who: a.ownerCtx.membership.id });
    expect(outside.who).toBeNull();
    expect(outside.tasks.length).toBe(4);
  });

  it("organisation accounts see everything read-only; staff only ever see their own", async () => {
    const owner = await tasksView(a.ownerCtx, { status: "all" });
    expect(owner.scope).toBe("org");
    expect(owner.people.map((p) => p.display_name)).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
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
