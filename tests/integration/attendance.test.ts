/**
 * Clocking: everyone clocks in and out; lateness follows the organisation schedule; supervisors see the board.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { clockIn, clockOut, myClock, attendanceBoard, attendanceMonth, monthRange, daysOf, instantOf } from "@/server/services/attendance";
import { updateSchedule } from "@/server/services/orgs";
import { startSession, stopSession } from "@/server/services/sessions";
import { todayLocal } from "@/server/lib/time";

let a: CompanyFixture;
let b: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
});

describe("clocking in and out", () => {
  it("a clock-in after the start time (plus grace) is late by the difference; before it is on time", async () => {
    // Make "now" late: the day starts at 00:01 with no grace. Any clock-in today after that is late.
    await updateSchedule(a.ownerCtx, { workingDays: [0, 1, 2, 3, 4, 5, 6], startLocal: "00:01", endLocal: "23:59", graceMinutes: 0 });
    const r = await clockIn(a.employeeCtx);
    expect(r.already).toBe(false);
    expect(r.record.late_seconds).toBeGreaterThan(0);
    const expectedLate = Math.round((Date.now() - instantOf(r.record.local_date, "00:01", "Africa/Lagos").getTime()) / 1000);
    expect(Math.abs(r.record.late_seconds - expectedLate)).toBeLessThan(5);
    // A second press is harmless.
    expect((await clockIn(a.employeeCtx)).already).toBe(true);
    // A day that starts at 23:59 with the largest grace: Ben clocks in "early".
    await updateSchedule(a.ownerCtx, { workingDays: [0, 1, 2, 3, 4, 5, 6], startLocal: "23:58", endLocal: "23:59", graceMinutes: 0 });
    const ben = await clockIn(a.employee2Ctx);
    expect(ben.record.late_seconds).toBe(0);
    const mine = await myClock(a.employee2Ctx);
    expect(mine.status).toBe("in");
    expect(mine.record?.id).toBe(ben.record.id);
    expect(mine.today).toBe(todayLocal("Africa/Lagos"));
  });

  it("clocking out is refused while a timer runs, then records the time and how early it was", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" });
    await expect(clockOut(a.employeeCtx)).rejects.toMatchObject({ code: "SESSION_OPEN" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    const out = await clockOut(a.employeeCtx);
    expect(out.record.clock_out_at).not.toBeNull();
    // Ada's record kept the schedule in force when she clocked in (ends 23:59), so leaving now is early.
    expect(out.record.left_early_seconds).toBeGreaterThan(0);
    expect((await clockOut(a.employeeCtx)).already).toBe(true);
    expect((await myClock(a.employeeCtx)).status).toBe("out");
    // Nobody can clock out without clocking in.
    await expect(clockOut(a.managerCtx)).rejects.toMatchObject({ code: "NOT_CLOCKED_IN" });
  });

  it("team leads, the owner and HR clock in too", async () => {
    for (const c of [a.managerCtx, a.ownerCtx, a.hrCtx]) expect((await clockIn(c)).record.membership_id).toBe(c.membership.id);
  });
});

describe("the attendance board", () => {
  it("organisation accounts see everyone split into clocked in, not clocked in and clocked out, with late flags", async () => {
    const board = await attendanceBoard(a.ownerCtx);
    const by = Object.fromEntries(board.people.map((p) => [p.display_name, p]));
    expect(by["Ada Employee"].status).toBe("out");
    expect(by["Ada Employee"].late_seconds).toBeGreaterThan(0);
    expect(by["Ben Employee"].status).toBe("in");
    expect(by["Ben Employee"].late_seconds).toBe(0);
    expect(by["David Manager"].status).toBe("in");
    expect(by["Olu Owner"].status).toBe("in");
    expect(board.counts).toMatchObject({ out: 1, not_in: 0 });
    expect(board.counts.in).toBe(4);
    expect(board.counts.late).toBeGreaterThanOrEqual(1);
    // Yesterday: nobody had clocked in.
    const yesterday = await attendanceBoard(a.ownerCtx, { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
    expect(yesterday.counts.not_in).toBe(yesterday.people.length);
  });

  it("a team lead sees their team (and themself) only; staff have no board; other organisations see nothing", async () => {
    const lead = await attendanceBoard(a.managerCtx);
    expect(lead.people.map((p) => p.display_name).sort()).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    await expect(attendanceBoard(a.employeeCtx)).rejects.toMatchObject({ status: 403 });
    // Row-level security: Ben cannot read Ada's record directly; Company B cannot read any of Company A's.
    const adaRow = (await adminQuery<{ id: string }>(`SELECT id FROM attendance_days WHERE membership_id = $1`, [a.employeeCtx.membership.id]))[0];
    expect(await appQueryAs(a.employee2.profileId, `SELECT id FROM attendance_days WHERE id = $1`, [adaRow.id])).toEqual([]);
    expect(await appQueryAs(a.manager.profileId, `SELECT id FROM attendance_days WHERE id = $1`, [adaRow.id])).toHaveLength(1);
    expect(await appQueryAs(b.owner.profileId, `SELECT id FROM attendance_days WHERE organisation_id = $1`, [a.ownerCtx.org.id])).toEqual([]);
    // And nobody can clock someone else in.
    await expect(appQueryAs(a.manager.profileId, `INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end) VALUES ($1, $2, '2001-01-01', 'Africa/Lagos', '09:00', '17:00')`, [a.ownerCtx.org.id, a.employeeCtx.membership.id])).rejects.toThrow();
  });
});

describe("browsing past days and months", () => {
  it("the month view has a cell per day, counts present, late and missed days, and never shows other organisations", async () => {
    const today = todayLocal("Africa/Lagos");
    const month = today.slice(0, 7);
    const range = monthRange(month);
    expect(daysOf(range.from, range.to).length).toBeGreaterThanOrEqual(28);
    // Backdate a record for Ada: on time three days ago, and one for Ben: late two days ago (working-day status does not matter for "present").
    const threeAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const twoAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    await adminQuery(`INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, clock_in_at, clock_out_at, late_seconds)
      VALUES ($1, $2, $3, 'Africa/Lagos', '09:00', '17:00', ($3::date::timestamp AT TIME ZONE 'Africa/Lagos') + interval '8 hours 50 minutes', ($3::date::timestamp AT TIME ZONE 'Africa/Lagos') + interval '17 hours', 0),
             ($1, $4, $5, 'Africa/Lagos', '09:00', '17:00', ($5::date::timestamp AT TIME ZONE 'Africa/Lagos') + interval '9 hours 30 minutes', NULL, 1800)`,
      [a.ownerCtx.org.id, a.employeeCtx.membership.id, threeAgo, a.employee2Ctx.membership.id, twoAgo]);
    const m = await attendanceMonth(a.ownerCtx, { month });
    expect(m.month).toBe(month);
    expect(m.days[0]).toBe(range.from);
    const ada = m.rows.find((r) => r.display_name === "Ada Employee")!;
    const ben = m.rows.find((r) => r.display_name === "Ben Employee")!;
    // Both dates may fall in the previous month early in a month; only assert when they are inside it.
    if (threeAgo >= range.from) { expect(ada.days[threeAgo]).toMatchObject({ late: 0 }); expect(ada.total_seconds).toBe(8 * 3600 + 10 * 60); }
    if (twoAgo >= range.from) { expect(ben.days[twoAgo]).toMatchObject({ late: 1800 }); expect(ben.late).toBe(1); }
    expect(ada.present).toBe(threeAgo >= range.from ? 2 : 1); // plus today
    // Missed days count only working days before today, after joining.
    expect(ada.missed).toBeGreaterThanOrEqual(0);
    expect(m.rows.every((r) => r.missed <= m.workingDays.filter((d) => d < today).length)).toBe(true);
    // A team lead sees their team only; a past month is empty but well-formed.
    const lead = await attendanceMonth(a.managerCtx, { month });
    expect(lead.rows.map((r) => r.display_name).sort()).toEqual(["Ada Employee", "Ben Employee", "David Manager"]);
    const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const past = await attendanceMonth(a.ownerCtx, { month: lastMonth });
    expect(past.rows.every((r) => r.present === 0)).toBe(true);
    // Company B sees none of it.
    expect((await attendanceMonth(b.ownerCtx, { month })).rows.every((r) => r.present === 0)).toBe(true);
    // The personal clock browses months too.
    const mine = await myClock(a.employeeCtx, { month });
    expect(mine.month).toBe(month);
    expect(mine.history.every((h) => h.local_date !== today && h.local_date.startsWith(month))).toBe(true);
    const mineLast = await myClock(a.employeeCtx, { month: lastMonth });
    expect(mineLast.history).toEqual([]);
    expect(mineLast.record?.local_date).toBe(today); // today's record is always there for the buttons
  });
});
