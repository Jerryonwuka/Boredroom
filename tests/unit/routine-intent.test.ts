import { describe, it, expect } from "vitest";
import { DEFAULT_TIMES, cadenceOf, looksLikeRoutine, routineIntent, timeOf } from "@/server/services/routine-intent";

// Routines in the built-in helper's words (owner decision, 8 October 2026: phase 7a, contract I.4). Pure: every phrasing,
// the default times, the bare-hour rule, and what is not a routine.

const create = (text: string) => {
  const r = routineIntent(text);
  if (!r || r.kind !== "create") throw new Error(`not a create: ${text} → ${JSON.stringify(r)}`);
  return r;
};

describe("setting one up", () => {
  it("reads the owner's three examples", () => {
    expect(routineIntent("Every Friday at 4pm, send me what's still owed")).toEqual({ kind: "create", template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00", teams: null });
    expect(routineIntent("Every weekday at 9, brief me")).toEqual({ kind: "create", template: "morning_brief", cadence: { kind: "weekdays" }, time: "09:00", teams: null });
    expect(routineIntent("Every Friday at 4pm, chase stalled tasks on my team")).toEqual({ kind: "create", template: "chase_stalled", cadence: { kind: "weekly", days: [5] }, time: "16:00", teams: null });
  });

  it("knows every template by its words", () => {
    expect(create("every day at 9 brief me").template).toBe("morning_brief");
    expect(create("Send me a morning brief every weekday").template).toBe("morning_brief");
    expect(create("every morning tell me what's waiting").template).toBe("morning_brief");
    expect(create("on Fridays send me what's still owed").template).toBe("still_owed");
    expect(create("every friday, a still owed roundup please").template).toBe("still_owed");
    expect(create("Weekly roundup every Friday at 5pm").template).toBe("still_owed");
    expect(create("every weekday at 3pm check what's blocked on me").template).toBe("afternoon_check");
    expect(create("afternoon check every day").template).toBe("afternoon_check");
    expect(create("chase my team every Friday").template).toBe("chase_stalled");
  });

  it("reads a chase's team: 'my team' is the teams the person leads, a name is that team", () => {
    expect(create("every Friday at 4pm chase stalled tasks on my team").teams).toBeNull();
    expect(create("chase stalled tasks on my teams every monday").teams).toBeNull();
    expect(create("every Friday chase stalled tasks on Design").teams).toEqual(["design"]);
    expect(create("chase stalled tasks on the Design team every Friday at 4pm").teams).toEqual(["design"]);
    expect(create("chase stalled tasks in Ops every weekday").teams).toEqual(["ops"]);
  });

  it("reads every cadence", () => {
    expect(cadenceOf("every day")).toEqual({ kind: "daily" });
    expect(cadenceOf("daily")).toEqual({ kind: "daily" });
    expect(cadenceOf("every morning")).toEqual({ kind: "daily" });
    expect(cadenceOf("every weekday")).toEqual({ kind: "weekdays" });
    expect(cadenceOf("weekdays")).toEqual({ kind: "weekdays" });
    expect(cadenceOf("on weekdays")).toEqual({ kind: "weekdays" });
    expect(cadenceOf("every monday and thursday")).toEqual({ kind: "weekly", days: [1, 4] });
    expect(cadenceOf("every fri")).toEqual({ kind: "weekly", days: [5] });
    expect(cadenceOf("on fridays")).toEqual({ kind: "weekly", days: [5] });
    expect(cadenceOf("every mon, wed and fri")).toEqual({ kind: "weekly", days: [1, 3, 5] });
    expect(cadenceOf("every tuesday")).toEqual({ kind: "weekly", days: [2] });
    expect(cadenceOf("every wednesday")).toEqual({ kind: "weekly", days: [3] });
    expect(cadenceOf("every thursday")).toEqual({ kind: "weekly", days: [4] });
    expect(cadenceOf("every saturday and sunday")).toEqual({ kind: "weekly", days: [0, 6] });
    expect(cadenceOf("on the 1st of every month")).toEqual({ kind: "monthly", day: 1 });
    expect(cadenceOf("every month on the 15th")).toEqual({ kind: "monthly", day: 15 });
    expect(cadenceOf("on the last day of the month")).toEqual({ kind: "monthly", day: 0 });
    expect(cadenceOf("monthly")).toEqual({ kind: "monthly", day: 1 });
    expect(cadenceOf("tomorrow")).toBeNull();
  });

  it("reads times: 4pm, 16:00, 9, 9:30am, noon", () => {
    expect(timeOf("at 4pm")).toBe("16:00");
    expect(timeOf("at 4 pm")).toBe("16:00");
    expect(timeOf("at 16:00")).toBe("16:00");
    expect(timeOf("at 9")).toBe("09:00");
    expect(timeOf("at 9:30am")).toBe("09:30");
    expect(timeOf("at 9.30")).toBe("09:30");
    expect(timeOf("at noon")).toBe("12:00");
    expect(timeOf("at 12pm")).toBe("12:00");
    expect(timeOf("at 12am")).toBe("00:00");
    expect(timeOf("every friday 5pm")).toBe("17:00");
    expect(timeOf("at 25:00")).toBeNull();
    expect(timeOf("every friday")).toBeNull();
  });

  it("a bare hour from 1 to 7 is in the afternoon, except for a morning brief", () => {
    expect(timeOf("at 4")).toBe("16:00");
    expect(timeOf("at 7")).toBe("19:00");
    expect(timeOf("at 8")).toBe("08:00");
    expect(timeOf("at 7", true)).toBe("07:00");
    expect(create("every Friday at 4 send me what's still owed").time).toBe("16:00");
    expect(create("every weekday at 7 brief me").time).toBe("07:00");
    expect(create("every weekday at 7am brief me").time).toBe("07:00");
    expect(create("every day at 3 check what's blocked on me").time).toBe("15:00");
  });

  it("uses each template's default time when none is given", () => {
    expect(DEFAULT_TIMES).toEqual({ morning_brief: "09:00", still_owed: "16:00", afternoon_check: "15:00", chase_stalled: "16:00", loose_ends: "17:30" });
    expect(create("every weekday, brief me").time).toBe("09:00");
    expect(create("every Friday send me what's still owed").time).toBe("16:00");
    expect(create("afternoon check every weekday").time).toBe("15:00");
    expect(create("chase stalled tasks on my team every Friday").time).toBe("16:00");
  });

  it("tolerates case, curly quotes and punctuation", () => {
    expect(create("EVERY FRIDAY AT 4PM, SEND ME WHAT’S STILL OWED!").template).toBe("still_owed");
    expect(create("Please, every weekday at 9: brief me.").template).toBe("morning_brief");
  });
});

describe("listing, pausing, turning on, deleting", () => {
  it("lists", () => {
    for (const q of ["What routines do I have?", "my routines", "List my routines", "show me my routines", "Which routines are on?"]) {
      expect(routineIntent(q), q).toEqual({ kind: "list" });
    }
  });

  it("pauses, turns on and deletes by the name the person uses", () => {
    expect(routineIntent("Pause my Friday roundup")).toEqual({ kind: "pause", name: "friday roundup" });
    expect(routineIntent("stop my morning brief")).toEqual({ kind: "pause", name: "morning brief" });
    expect(routineIntent("turn off the afternoon check")).toEqual({ kind: "pause", name: "afternoon check" });
    expect(routineIntent("Turn on my morning brief")).toEqual({ kind: "turn_on", name: "morning brief" });
    expect(routineIntent("resume my Friday roundup")).toEqual({ kind: "turn_on", name: "friday roundup" });
    expect(routineIntent("Delete my Friday roundup routine")).toEqual({ kind: "delete", name: "friday roundup" });
    expect(routineIntent("pause my design summary routine")).toEqual({ kind: "pause", name: "design summary" });
  });

  it("never takes a check-in for the afternoon check (review, 8 October 2026)", () => {
    expect(routineIntent("cancel my check-in reminder")).toBeNull();
    expect(looksLikeRoutine("check-in")).toBe(false);
    expect(looksLikeRoutine("check in reminder")).toBe(false);
  });

  it("leaves the timer, reminders and to-dos alone", () => {
    for (const q of ["stop my timer", "pause the timer", "start my timer", "delete my to-do", "cancel my reminder", "cancel my 3pm reminder", "turn off my status"]) {
      expect(routineIntent(q), q).toBeNull();
    }
    expect(looksLikeRoutine("timer")).toBe(false);
    expect(looksLikeRoutine("friday roundup")).toBe(true);
  });
});

describe("what is not a routine", () => {
  it("needs both what it does and how often", () => {
    for (const q of [
      "remind me every Friday", "Remind me every Friday at 4pm to send the invoice", "brief me", "What's waiting for me?",
      "what's still owed?", "every Friday", "Every Friday at 4pm", "Tell Ben's assistant every Friday is a deadline", "I need to send what's still owed every Friday",
      "add a to-do every friday", "", "   ",
    ]) expect(routineIntent(q), q).toBeNull();
  });
});

describe("loose ends (phase 7b, owner decisions, 8 October 2026)", () => {
  it("sets up the loose_ends template with its cadence, 17:30 when no time is said", () => {
    expect(routineIntent("every evening, check for loose ends")).toEqual({ kind: "create", template: "loose_ends", cadence: { kind: "daily" }, time: "17:30", teams: null });
    expect(routineIntent("every weekday at 6pm find my loose ends")).toEqual({ kind: "create", template: "loose_ends", cadence: { kind: "weekdays" }, time: "18:00", teams: null });
    expect(create("Every Friday at 4pm, look for loose ends").template).toBe("loose_ends");
    expect(create("loose ends every day").time).toBe("17:30");
  });
  it("without a cadence it is not a routine (the helper's loop intent takes it)", () => {
    for (const q of ["any loose ends?", "check my loose ends", "show my loose ends"]) expect(routineIntent(q), q).toBeNull();
  });
  it("its name reads as a routine's", () => {
    expect(routineIntent("pause my loose ends")).toEqual({ kind: "pause", name: "loose ends" });
    expect(looksLikeRoutine("evening loose ends")).toBe(true);
  });
});
