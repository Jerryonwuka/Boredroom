import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { startSession, pauseSession, resumeSession, stopSession, switchSession, heartbeat, currentSession, interruptStaleSessions, getSession } from "@/server/services/sessions";
import { beforeEach } from "vitest";
import { createTask, updateTask } from "@/server/services/tasks";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
});

async function stopAny(ctx: CompanyFixture["employeeCtx"]) {
  const cur = await currentSession(ctx);
  if (cur.session) await stopSession(ctx, cur.session.id, { expectedVersion: cur.session.version, note: "", outcome: "continue_later" });
}
beforeEach(async () => { await stopAny(a.employeeCtx); });

describe("A04 concurrent start", () => {
  it("allows exactly one open session when two starts race", async () => {
    const results = await Promise.allSettled([
      startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" }),
      startSession(a.employeeCtx, { taskId: a.taskIds.meeting, captureMode: "none" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "SESSION_OPEN" });
    expect(failed[0].reason.details.sessionId).toBeDefined();
    const open = await adminQuery("SELECT count(*)::int AS n FROM work_sessions WHERE user_id = $1 AND state <> 'stopped'", [a.employee.profileId]);
    expect(open[0].n).toBe(1);
    await stopAny(a.employeeCtx);
  });

  it("blocks starting in another workspace while a session is open elsewhere (global slot)", async () => {
    // Give Ada a membership in company B by inviting her there.
    const b = await buildCompany("b");
    const { joinViaInvitation } = await import("@/server/services/fixtures");
    const adaInB = await joinViaInvitation(b.hrCtx, a.employee, "employee", b.teamId);
    const tB = await createTask(b.managerCtx, { projectId: b.projectId, title: "B task", expectedOutput: "x", assigneeMembershipId: adaInB.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const sA = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    await expect(startSession(adaInB, { taskId: tB.id, captureMode: "none" })).rejects.toMatchObject({ code: "SESSION_OPEN", details: { elsewhere: true } });
    const cur = await currentSession(adaInB);
    expect(cur.session).toBeNull();
    expect(cur.elsewhere?.organisationSlug).toBe("company-a");
    await stopSession(a.employeeCtx, sA.id, { expectedVersion: sA.version, note: "", outcome: "continue_later" });
  });
});

describe("A05 idempotent retries and A06 pause maths", () => {
  it("retry of stop after timeout returns the committed result without duplicate intervals", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    const stopped = await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "done for now", outcome: "continue_later" });
    expect(stopped.state).toBe("stopped");
    const again = await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "done for now", outcome: "continue_later" });
    expect(again.version).toBe(stopped.version);
    const n = await adminQuery("SELECT count(*)::int AS n FROM session_intervals WHERE session_id = $1", [s.id]);
    expect(n[0].n).toBe(1);
    await expect(stopSession(a.employeeCtx, s.id, { expectedVersion: s.version - 1, note: "", outcome: "continue_later" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("work 10, pause 5, resume 10 = 20 minutes confirmed, breaks excluded", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    const paused = await pauseSession(a.employeeCtx, s.id, s.version);
    const resumed = await resumeSession(a.employeeCtx, s.id, paused.version);
    const stopped = await stopSession(a.employeeCtx, s.id, { expectedVersion: resumed.version, note: "", outcome: "continue_later" });
    expect(stopped.state).toBe("stopped");
    // Rewrite the two intervals to a distant window: [t0, t0+10m) and [t0+15m, t0+25m).
    const t0 = new Date(Date.now() - 30 * 86400000);
    const ids = await adminQuery<{ id: string }>("SELECT id FROM session_intervals WHERE session_id = $1 ORDER BY started_at", [s.id]);
    expect(ids).toHaveLength(2);
    await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE session_intervals SET started_at = $2, ended_at = $3 WHERE id = $1", [ids[0].id, t0.toISOString(), new Date(t0.getTime() + 10 * 60000).toISOString()]);
    await adminQuery("UPDATE session_intervals SET started_at = $2, ended_at = $3 WHERE id = $1", [ids[1].id, new Date(t0.getTime() + 15 * 60000).toISOString(), new Date(t0.getTime() + 25 * 60000).toISOString()]);
    await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
    const view = await getSession(a.employeeCtx, s.id);
    expect(view.confirmedSeconds).toBe(20 * 60);
    expect(view.uncertainSeconds).toBe(0);
  });
});

describe("A07 refresh restores the same session", () => {
  it("currentSession returns the open session with server-computed elapsed time", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    const cur = await currentSession(a.employeeCtx);
    expect(cur.session?.id).toBe(s.id);
    expect(cur.session?.openIntervalStartedAt).toBeTruthy();
    expect(typeof cur.session?.serverNow).toBe("string");
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  });
});

describe("A08 heartbeat loss", () => {
  it("interrupts at the last heartbeat and marks the gap uncertain on reconnect", async () => {
    // Ben has no earlier intervals in this file, so his timeline can be rewritten freely.
    const ctx = a.employee2Ctx;
    const s = await startSession(ctx, { taskId: a.taskIds.second, captureMode: "none" });
    await heartbeat(ctx, s.id);
    const lastHb = new Date(Date.now() - 5 * 60000).toISOString();
    await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE session_intervals SET started_at = now() - interval '10 minutes' WHERE session_id = $1", [s.id]);
    await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE work_sessions SET started_at = now() - interval '10 minutes', last_heartbeat_at = $2 WHERE id = $1", [s.id, lastHb]);
    const n = await interruptStaleSessions();
    expect(n).toBe(1);
    const cur = await currentSession(ctx);
    expect(cur.session?.state).toBe("interrupted");
    const closed = await adminQuery<{ ended_at: string }>("SELECT ended_at FROM session_intervals WHERE session_id = $1", [s.id]);
    expect(new Date(closed[0].ended_at).getTime()).toBe(new Date(lastHb).getTime());
    // Resume: gap since last heartbeat is recorded as uncertain, not credited.
    const resumed = await resumeSession(ctx, s.id, cur.session!.version);
    expect(resumed.state).toBe("running");
    expect(resumed.uncertainSeconds).toBeGreaterThanOrEqual(295);
    expect(resumed.confirmedSeconds).toBeLessThan(5 * 60 + 5);
    const statuses = await adminQuery<{ confirmation_status: string; source: string }>("SELECT confirmation_status, source FROM session_intervals WHERE session_id = $1 ORDER BY started_at", [s.id]);
    expect(statuses.map((r) => r.confirmation_status)).toEqual(["confirmed", "uncertain", "confirmed"]);
    expect(statuses[1].source).toBe("recovery");
    await stopSession(ctx, s.id, { expectedVersion: resumed.version, note: "", outcome: "continue_later" });
  });
});

describe("switch and task rules", () => {
  it("switch closes the previous session and opens the next atomically; retry is idempotent", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    const next = await switchSession(a.employeeCtx, s.id, { expectedVersion: s.version, nextTaskId: a.taskIds.meeting, captureMode: "none", note: "" });
    expect(next.taskId).toBe(a.taskIds.meeting);
    const prev = await adminQuery<{ state: string }>("SELECT state FROM work_sessions WHERE id = $1", [s.id]);
    expect(prev[0].state).toBe("stopped");
    const retry = await switchSession(a.employeeCtx, s.id, { expectedVersion: s.version, nextTaskId: a.taskIds.meeting, captureMode: "none", note: "" });
    expect(retry.id).toBe(next.id);
    const open = await adminQuery("SELECT count(*)::int AS n FROM work_sessions WHERE user_id = $1 AND state <> 'stopped'", [a.employee.profileId]);
    expect(open[0].n).toBe(1);
    await stopSession(a.employeeCtx, next.id, { expectedVersion: next.version, note: "", outcome: "continue_later" });
  });

  it("archived tasks cannot start sessions and reassignment is blocked while a session is open", async () => {
    const t = await createTask(a.managerCtx, { projectId: a.projectId, title: "Temp", expectedOutput: "x", assigneeMembershipId: a.employeeCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const s = await startSession(a.employeeCtx, { taskId: t.id, captureMode: "none" });
    const cur = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]);
    await expect(updateTask(a.managerCtx, t.id, { expectedVersion: cur[0].version, assigneeMembershipId: a.employee2Ctx.membership.id })).rejects.toMatchObject({ code: "SESSION_OPEN" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    const v = await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [t.id]);
    await updateTask(a.managerCtx, t.id, { expectedVersion: v[0].version, archive: true });
    await expect(startSession(a.employeeCtx, { taskId: t.id, captureMode: "none" })).rejects.toMatchObject({ code: "TASK_ARCHIVED" });
  });

  it("only the assignee can start; stop with blocked outcome marks the task blocked and notifies the manager", async () => {
    await expect(startSession(a.employee2Ctx, { taskId: a.taskIds.homepage, captureMode: "none" })).rejects.toMatchObject({ status: 403 });
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "Waiting on brand assets", outcome: "blocked" });
    const t = await adminQuery<{ status: string; blocked_reason: string }>("SELECT status, blocked_reason FROM tasks WHERE id = $1", [a.taskIds.homepage]);
    expect(t[0].status).toBe("blocked");
    const notif = await adminQuery("SELECT 1 FROM notifications WHERE recipient_membership_id = $1 AND type = 'task.blocked'", [a.managerCtx.membership.id]);
    expect(notif.length).toBeGreaterThan(0);
  });
});
