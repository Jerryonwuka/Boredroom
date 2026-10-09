import { describe, it, expect, vi } from "vitest";

// Following a commitment through (owner decisions, 8 October 2026: phase 7b, contract C.4): when the due reminder goes
// (two hours before a due time from 11:00, else 09:00 that day, in the committer's zone), never in quiet hours and never
// after the due day; when a stalled note goes; when a thread follow-up may be posted. Pure decisions: no database.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { dueReminderAt, inWorkingHours, reminderDecision, stalledDecision } from "@/server/services/commitment-followthrough";

const LAGOS = "Africa/Lagos"; // UTC+1, no daylight saving
const LONDON = "Europe/London"; // UTC+1 in October (BST)

describe("dueReminderAt", () => {
  it("two hours before a due time from 11:00 local", () => {
    expect(dueReminderAt("2026-10-09T16:00:00Z", { timeZone: LAGOS }).toISOString()).toBe("2026-10-09T14:00:00.000Z"); // 17:00 → 15:00
    expect(dueReminderAt("2026-10-09T10:00:00Z", { timeZone: LAGOS }).toISOString()).toBe("2026-10-09T08:00:00.000Z"); // 11:00 → 09:00
  });
  it("09:00 that day for an earlier due time, and never after the due time itself", () => {
    expect(dueReminderAt("2026-10-09T09:00:00Z", { timeZone: LAGOS }).toISOString()).toBe("2026-10-09T08:00:00.000Z"); // 10:00 → 09:00
    expect(dueReminderAt("2026-10-09T07:00:00Z", { timeZone: LAGOS }).toISOString()).toBe("2026-10-09T07:00:00.000Z"); // 08:00 → 08:00
  });
  it("in the committer's own zone", () => {
    // 16:00Z is 17:00 in London too in October; 08:30Z is 09:30 London: reminded at 09:00 London (08:00Z).
    expect(dueReminderAt("2026-10-09T08:30:00Z", { timeZone: LONDON }).toISOString()).toBe("2026-10-09T08:00:00.000Z");
    expect(dueReminderAt("2026-10-09T08:30:00Z", { timeZone: "Asia/Tokyo" }).toISOString()).toBe("2026-10-09T06:30:00.000Z"); // 17:30 Tokyo → 15:30
  });
});

describe("reminderDecision: the quiet-hours rule", () => {
  const due = "2026-10-09T16:00:00Z"; // Fri 17:00 Lagos; reminded at 15:00
  const at = (iso: string, quiet = false) => reminderDecision({ now: new Date(iso), dueAt: due, timeZone: LAGOS, quiet: { active: quiet } });
  it("waits until its time", () => expect(at("2026-10-09T13:59:00Z")).toBe("wait"));
  it("sends at its time, and later that day", () => {
    expect(at("2026-10-09T14:00:00Z")).toBe("send");
    expect(at("2026-10-09T22:30:00Z")).toBe("send");
  });
  it("waits for quiet hours to end (the next sweep sends it)", () => expect(at("2026-10-09T14:00:00Z", true)).toBe("quiet"));
  it("after the due day in the person's zone it is late: marked, never sent", () => {
    expect(at("2026-10-09T23:00:00Z")).toBe("late"); // Saturday 00:00 Lagos
    expect(at("2026-10-10T09:00:00Z", true)).toBe("late");
  });
});

describe("stalledDecision", () => {
  const since = new Date("2026-10-08T09:00:00Z");
  const base = { now: new Date("2026-10-12T09:00:00Z"), dueAt: "2026-10-07T16:00:00Z", since, progress: false, asker: true, quiet: { active: false } };
  it("notes a commitment two working days overdue with no progress", () => expect(stalledDecision(base)).toBe("note"));
  it("not yet when it was due after the stalled line, or there was progress", () => {
    expect(stalledDecision({ ...base, dueAt: "2026-10-08T16:00:00Z" })).toBe("wait");
    expect(stalledDecision({ ...base, progress: true })).toBe("wait");
  });
  it("waits for the asker's quiet hours; with nobody to tell it is only marked", () => {
    expect(stalledDecision({ ...base, quiet: { active: true } })).toBe("quiet");
    expect(stalledDecision({ ...base, asker: false, quiet: { active: true } })).toBe("note");
  });
});

describe("inWorkingHours", () => {
  const schedule = { timezone: LAGOS, workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
  it("inside a working day's window only", () => {
    expect(inWorkingHours(new Date("2026-10-09T08:00:00Z"), schedule)).toBe(true); // Fri 09:00
    expect(inWorkingHours(new Date("2026-10-09T15:59:00Z"), schedule)).toBe(true);
    expect(inWorkingHours(new Date("2026-10-09T16:00:00Z"), schedule)).toBe(false); // 17:00
    expect(inWorkingHours(new Date("2026-10-09T07:59:00Z"), schedule)).toBe(false);
    expect(inWorkingHours(new Date("2026-10-10T10:00:00Z"), schedule)).toBe(false); // Saturday
  });
});
