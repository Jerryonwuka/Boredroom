/**
 * Round 3: team leads hand out to-dos, "Done" from My Day, past tasks, and screen recording that staff can start.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, contextFor, type CompanyFixture } from "@/server/services/fixtures";
import { quickTodo, completeTask, clearPastTasks, assignableMembers } from "@/server/services/tasks";
import { myDay, notificationsView, reviewQueue } from "@/server/services/views";
import { startSession, stopSession, currentSession } from "@/server/services/sessions";
import { reviewSubmission } from "@/server/services/evidence";
import { publishPolicy, acknowledgePolicy } from "@/server/services/orgs";
import { planFromText } from "@/server/services/assistant";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
});

describe("team leads hand out to-dos from their own list", () => {
  it("lead adds a to-do with description and deadline for a team member; the member is notified and sees it under 'From your team lead'", async () => {
    const people = await assignableMembers(a.managerCtx);
    expect(people.map((p) => p.display_name).sort()).toEqual(["Ada Employee", "Ben Employee"]);
    expect(await assignableMembers(a.employeeCtx)).toEqual([]);
    const due = new Date(Date.now() + 2 * 86400000).toISOString();
    const t = await quickTodo(a.managerCtx, { title: "Redo the homepage banner", description: "Use the new brand colours; export at 2x.", dueAt: due, assigneeMembershipId: a.employeeCtx.membership.id });
    const row = (await adminQuery<{ assignee_membership_id: string; reviewer_membership_id: string; expected_output: string; due_at: string; created_by: string }>("SELECT assignee_membership_id, reviewer_membership_id, expected_output, due_at, created_by FROM tasks WHERE id = $1", [t.id]))[0];
    expect(row.assignee_membership_id).toBe(a.employeeCtx.membership.id);
    expect(row.reviewer_membership_id).toBe(a.managerCtx.membership.id);
    expect(row.expected_output).toBe("Use the new brand colours; export at 2x.");
    expect(new Date(row.due_at).toISOString()).toBe(due);
    const notes = await notificationsView(a.employeeCtx);
    expect(notes.some((n) => n.type === "task.assigned" && n.title.includes("Redo the homepage banner"))).toBe(true);
    const day = await myDay(a.employeeCtx);
    expect(day.fromLeads.map((x) => x.id)).toContain(t.id);
    expect(day.ownTodos.map((x) => x.id)).not.toContain(t.id);
    // Staff cannot hand to-dos to others.
    await expect(quickTodo(a.employeeCtx, { title: "Not allowed", assigneeMembershipId: a.employee2Ctx.membership.id })).rejects.toMatchObject({ status: 403 });
  });
});

describe("Done from My Day", () => {
  it("completes an own to-do immediately, removes it from the plan, and lists it under done/past; clearing hides it", async () => {
    const todo = await quickTodo(a.employeeCtx, { title: "Export final logo files" });
    let day = await myDay(a.employeeCtx);
    expect(day.planned.map((t) => t.id)).toContain(todo.id);
    const r = await completeTask(a.employeeCtx, todo.id, { note: "" });
    expect(r.completed).toBe(true);
    day = await myDay(a.employeeCtx);
    expect(day.planned.map((t) => t.id)).not.toContain(todo.id); // no more Start button
    expect(day.ownTodos.map((t) => t.id)).not.toContain(todo.id);
    expect(day.doneToday.map((t) => t.id)).toContain(todo.id);
    // Only the assignee can mark it done.
    const other = await quickTodo(a.employee2Ctx, { title: "Ben's own thing" });
    await expect(completeTask(a.employeeCtx, other.id, { note: "" })).rejects.toMatchObject({ status: 403 });
    // Backdate completion so it counts as a past task, then clear.
    await adminQuery("UPDATE tasks SET completed_at = now() - interval '2 days' WHERE id = $1", [todo.id]);
    day = await myDay(a.employeeCtx);
    expect(day.pastTasks.map((t) => t.id)).toContain(todo.id);
    expect(day.doneToday.map((t) => t.id)).not.toContain(todo.id);
    const cleared = await clearPastTasks(a.employeeCtx);
    expect(cleared.cleared).toBeGreaterThanOrEqual(1);
    day = await myDay(a.employeeCtx);
    expect(day.pastTasks.map((t) => t.id)).not.toContain(todo.id);
    // Nothing was deleted: the organisation still sees the completed task.
    expect(await adminQuery("SELECT 1 FROM tasks WHERE id = $1 AND status = 'completed'", [todo.id])).toHaveLength(1);
  });

  it("sends a lead-assigned task for the lead's check; it becomes completed when approved", async () => {
    const day = await myDay(a.employeeCtx);
    const fromLead = day.fromLeads.find((t) => t.title === "Redo the homepage banner")!;
    const r = await completeTask(a.employeeCtx, fromLead.id, { note: "Banner exported and uploaded to the shared drive." });
    expect(r.completed).toBe(false);
    const after = await myDay(a.employeeCtx);
    expect(after.fromLeads.find((t) => t.id === fromLead.id)?.status).toBe("in_review");
    const q = await reviewQueue(a.managerCtx);
    const sub = q.submissions.find((s) => s.task_id === fromLead.id)!;
    expect(sub.note).toContain("Banner exported");
    await reviewSubmission(a.managerCtx, sub.submission_id, { decision: "approved", note: "" });
    expect((await adminQuery<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [fromLead.id]))[0].status).toBe("completed");
    expect((await myDay(a.employeeCtx)).doneToday.map((t) => t.id)).toContain(fromLead.id);
  });

  it("stopping a session with outcome 'completed' finishes an own to-do in the same step", async () => {
    const todo = await quickTodo(a.employeeCtx, { title: "Write the release notes" });
    const s = await startSession(a.employeeCtx, { taskId: todo.id, captureMode: "none" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "All sections written.", outcome: "completed" });
    const row = (await adminQuery<{ status: string; completed_at: string | null }>("SELECT status, completed_at FROM tasks WHERE id = $1", [todo.id]))[0];
    expect(row.status).toBe("completed");
    expect(row.completed_at).not.toBeNull();
    expect((await currentSession(a.employeeCtx)).session).toBeNull();
    await expect(startSession(a.employeeCtx, { taskId: todo.id, captureMode: "none" })).rejects.toMatchObject({ code: "TASK_COMPLETED" });
  });
});

describe("screen recording staff can start", () => {
  it("with recording 'optional' every session of an acknowledged member may record without any prompt at Start", async () => {
    let s = await startSession(a.employee2Ctx, { taskId: a.taskIds.second, captureMode: "none" });
    expect(s.captureMode).toBe("none"); // policy still 'disabled'
    await stopSession(a.employee2Ctx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });

    await publishPolicy(a.ownerCtx, { recordingMode: "optional", retentionDays: 7, noticeText: "You may record your screen while a timer runs. Video only, started by you.", reminderMinutesBeforeEnd: 30 });
    a.employee2Ctx = await contextFor(a.employee2, a.slug);
    // Not yet acknowledged: the session runs, but cannot record.
    s = await startSession(a.employee2Ctx, { taskId: a.taskIds.second, captureMode: "none" });
    expect(s.captureMode).toBe("none");
    await stopSession(a.employee2Ctx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    await acknowledgePolicy(a.employee2Ctx);
    s = await startSession(a.employee2Ctx, { taskId: a.taskIds.second, captureMode: "none" });
    expect(s.captureMode).toBe("optional"); // "Record screen" is available in the timer
    await stopSession(a.employee2Ctx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  });
});

describe("the to-do assistant", () => {
  it("proposes to-dos for staff (self only) and hands out to team members for leads, without creating anything", async () => {
    const before = (await adminQuery<{ n: string }>("SELECT count(*) AS n FROM tasks"))[0].n;
    const mine = await planFromText(a.employeeCtx, { text: "Finish the pricing page copy by Friday, then send the draft to the client." });
    expect(mine.items.map((i) => i.title)).toEqual(["Finish the pricing page copy", "Send the draft to the client"]);
    expect(mine.items[0].dueAt).not.toBeNull();
    expect(mine.items.every((i) => i.assigneeMembershipId === null)).toBe(true);
    const lead = await planFromText(a.managerCtx, { text: "Ask Ada to redo the homepage banner by Monday. Ben should fix the checkout bug today. I will prepare the sprint review." });
    expect(lead.items[0]).toMatchObject({ title: "Redo the homepage banner", assigneeMembershipId: a.employeeCtx.membership.id });
    expect(lead.items[1]).toMatchObject({ title: "Fix the checkout bug", assigneeMembershipId: a.employee2Ctx.membership.id });
    expect(lead.items[2]).toMatchObject({ title: "Prepare the sprint review", assigneeMembershipId: null });
    expect(["claude", "builtin"]).toContain(lead.engine);
    expect((await adminQuery<{ n: string }>("SELECT count(*) AS n FROM tasks"))[0].n).toBe(before);
  });
});
