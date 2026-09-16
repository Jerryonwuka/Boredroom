import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { startSession, pauseSession, stopSession } from "@/server/services/sessions";
import { workroomView, workroomPerson, workroomStatus } from "@/server/services/views";
import { quickTodo, completeTask } from "@/server/services/tasks";

let a: CompanyFixture;
beforeAll(async () => { await resetTestDatabase(); a = await buildCompany("a"); });

describe("Workroom", () => {
  it("shows who is at work, what they are on, and honest derived statuses; leads see their team, staff nothing", async () => {
    // Nobody has started: everyone is "not started today".
    let room = await workroomView(a.ownerCtx);
    expect(room.rows.map((r) => r.display_name).sort()).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    expect(room.rows.every((r) => workroomStatus(r, room.staleAfterSeconds, Date.now()) === "not_started")).toBe(true);

    // Ada starts the homepage task: active, on that task, clocked in.
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    room = await workroomView(a.ownerCtx);
    const ada = room.rows.find((r) => r.display_name === "Ada Employee")!;
    expect(workroomStatus(ada, room.staleAfterSeconds, new Date(room.serverNow).getTime())).toBe("active");
    expect(ada.task_title).toBe("Homepage design");
    expect(ada.first_start_today).not.toBeNull();
    expect(ada.recording_live).toBe(false);
    expect(room.rows[0].display_name).toBe("Ada Employee"); // running people sort first

    // Paused → paused; stopped → off the clock (still clocked in today).
    const p = await pauseSession(a.employeeCtx, s.id, s.version);
    room = await workroomView(a.ownerCtx);
    expect(workroomStatus(room.rows.find((r) => r.display_name === "Ada Employee")!, room.staleAfterSeconds, Date.now())).toBe("paused");
    await stopSession(a.employeeCtx, s.id, { expectedVersion: p.version, note: "Drafted the hero", outcome: "continue_later" });
    room = await workroomView(a.ownerCtx);
    const after = room.rows.find((r) => r.display_name === "Ada Employee")!;
    expect(workroomStatus(after, room.staleAfterSeconds, Date.now())).toBe("clocked_out");
    expect(after.tasks_today).toBe(1);

    // The person view lists the task with time today, the session with its note, and counts sent-for-check work.
    const todo = await quickTodo(a.employeeCtx, { title: "Export final logo files" });
    await completeTask(a.employeeCtx, todo.id, { note: "" });
    const day = await workroomPerson(a.ownerCtx, a.employeeCtx.membership.id);
    expect(day).not.toBeNull();
    expect(day!.tasks.map((t) => t.title).sort()).toEqual(["Export final logo files", "Homepage design"]);
    expect(day!.tasks.find((t) => t.title === "Homepage design")!.sessions_today).toBe(1);
    expect(day!.tasks.find((t) => t.title === "Export final logo files")!.status).toBe("in_review");
    expect(day!.sessions[0].stop_note).toBe("Drafted the hero");
    expect(day!.person.sent_for_check_today).toBe(1);

    // Scope: the team lead sees their team; a team filter works; staff cannot use the room at all (page-level), and
    // the view returns nothing for a member outside the caller's scope.
    const lead = await workroomView(a.managerCtx, { teamId: a.teamId });
    expect(lead.rows.map((r) => r.display_name).sort()).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    expect(await workroomPerson(a.employeeCtx, a.employee2Ctx.membership.id)).toBeNull();
  });
});
