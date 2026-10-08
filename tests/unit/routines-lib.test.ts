/**
 * Routines' shared words and text (owner decision, 8 October 2026: phase 7a): when a routine runs in words, a run's
 * output as Markdown (sections, "not available", "and N more", what it did) and as plain lines for the notch and a
 * notification, and the status badges.
 */
import { describe, expect, it } from "vitest";
import {
  ROUTINE_LIMITS, ROUTINE_TEMPLATES, ROUTINE_WORDS, cadenceFrom, cadenceWords, dayList, isRoutineTemplate, ordinal, outputCount,
  pausedWords, routineBadge, routineMarkdown, routinePlainLines, runBadge, type RoutineOutput,
} from "@/lib/routines";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const F1 = "33333333-3333-4333-8333-333333333333";

describe("cadenceWords", () => {
  it("says when it runs", () => {
    expect(cadenceWords({ kind: "daily" }, "09:00")).toBe("Every day at 09:00");
    expect(cadenceWords({ kind: "weekdays" }, "09:00")).toBe("Every weekday at 09:00");
    expect(cadenceWords({ kind: "weekly", days: [5] }, "16:00")).toBe("Every Friday at 16:00");
    expect(cadenceWords({ kind: "weekly", days: [4, 1] }, "08:30")).toBe("Every Monday and Thursday at 08:30");
    expect(cadenceWords({ kind: "weekly", days: [0, 1, 3, 5] }, "08:30")).toBe("Every Monday, Wednesday, Friday and Sunday at 08:30");
    expect(cadenceWords({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] }, "07:00")).toBe("Every day at 07:00");
    expect(cadenceWords({ kind: "monthly", day: 1 }, "09:00")).toBe("On the 1st of every month at 09:00");
    expect(cadenceWords({ kind: "monthly", day: 22 }, "09:00")).toBe("On the 22nd of every month at 09:00");
    expect(cadenceWords({ kind: "monthly", day: 0 }, "17:00")).toBe("On the last day of every month at 17:00");
  });

  it("ordinals and day lists", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
    expect(dayList([5])).toBe("Friday");
    expect(dayList([])).toBe("");
  });

  it("reads a stored cadence back", () => {
    expect(cadenceFrom("weekly", [4, 1, 4], null)).toEqual({ kind: "weekly", days: [1, 4] });
    expect(cadenceFrom("monthly", [], 0)).toEqual({ kind: "monthly", day: 0 });
    expect(cadenceFrom("weekly", [], null)).toBeNull();
    expect(cadenceFrom("hourly", [], null)).toBeNull();
  });
});

const output = (over: Partial<RoutineOutput> = {}): RoutineOutput => ({
  v: 1, title: "What's still owed", lead: "3 things are still owed.", empty: false, calm: "Nothing is still owed.",
  sections: [
    { id: "tasks", label: "Overdue or blocked", items: [
      { text: "“Landing *page*” (Ben Okafor), overdue since Tue 6 Oct", sources: [{ kind: "task", id: T1 }] },
      { text: "“Pricing” (Ada)", detail: "blocked: waiting for [copy]", sources: [{ kind: "task", id: T2 }, { kind: "follow_up", id: F1 }] },
    ], more: 2, missing: false },
    { id: "sent", label: "Waiting on others' assistants", items: [], more: 0, missing: true },
    { id: "received", label: "Waiting on you", items: [], more: 0, missing: false },
  ],
  actions: [], generatedAt: "2026-10-09T15:00:00.000Z", ...over,
});

describe("routineMarkdown", () => {
  it("lead, sections with sources, 'and N more', 'not available'; empty sections left out", () => {
    expect(routineMarkdown(output(), "acme")).toBe([
      "**3 things are still owed.**",
      "",
      "**Overdue or blocked**",
      `- “Landing \\*page\\*” \\(Ben Okafor\\), overdue since Tue 6 Oct ([task](/app/acme/tasks/${T1}))`,
      `- “Pricing” \\(Ada\\), blocked: waiting for \\[copy\\] ([task](/app/acme/tasks/${T2}), [follow-up](/app/acme/home/follow-ups/${F1}))`,
      "- And 2 more.",
      "",
      "**Waiting on others' assistants**",
      "- not available",
    ].join("\n"));
  });

  it("what it did, and what it would do in a preview", () => {
    const did = output({ actions: [
      { kind: "follow_up", text: "Asked Ben's Brenda about “Landing page”", done: true, followUpId: F1, taskId: T1 },
      { kind: "follow_up", text: "“Pricing page” (Ada)", done: false, reason: "You've already followed up with Ada about this twice today." },
    ] });
    expect(routineMarkdown(did, "acme").split("\n\n").pop()).toBe([
      "**What it did**",
      `- Asked Ben's Brenda about “Landing page” ([follow-up](/app/acme/home/follow-ups/${F1}), [task](/app/acme/tasks/${T1}))`,
      "- Not asked: “Pricing page” \\(Ada\\): You've already followed up with Ada about this twice today.",
    ].join("\n"));
    // A text that already carries its reason is not repeated.
    const said = output({ actions: [{ kind: "follow_up", text: "Not asked: “Pricing page” (Ada): Over the limit.", done: false, reason: "Over the limit." }] });
    expect(routineMarkdown(said, "acme").split("\n\n").pop()).toBe("**What it did**\n- Not asked: “Pricing page” \\(Ada\\): Over the limit.");
    const would = output({ actions: [{ kind: "follow_up", text: "Would ask Ben's Brenda about “Landing page”", done: false }] });
    expect(routineMarkdown(would, "acme").split("\n\n").pop()).toBe("**What it would do**\n- Would ask Ben's Brenda about “Landing page”");
  });

  it("the calm line when there is nothing", () => {
    const calm = output({ empty: true, lead: "0 things are still owed.", sections: [{ id: "tasks", label: "Overdue or blocked", items: [], more: 0, missing: false }] });
    expect(routineMarkdown(calm, "acme")).toBe("**Nothing is still owed.**");
  });
});

describe("routinePlainLines", () => {
  it("items with their first link, missing sections, then 'And N more' in the last place", () => {
    expect(routinePlainLines(output(), "acme", 6)).toEqual([
      { text: "“Landing *page*” (Ben Okafor), overdue since Tue 6 Oct", href: `/app/acme/tasks/${T1}` },
      { text: "“Pricing” (Ada), blocked: waiting for [copy]", href: `/app/acme/tasks/${T2}` },
      { text: "Waiting on others' assistants: not available", href: null },
      { text: "And 2 more.", href: null },
    ]);
    expect(routinePlainLines(output(), "acme", 3)).toEqual([
      { text: "“Landing *page*” (Ben Okafor), overdue since Tue 6 Oct", href: `/app/acme/tasks/${T1}` },
      { text: "“Pricing” (Ada), blocked: waiting for [copy]", href: `/app/acme/tasks/${T2}` },
      { text: "And 3 more.", href: null },
    ]);
    expect(routinePlainLines(output(), "acme", 1)).toHaveLength(1);
  });

  it("everything when it fits, and the calm line when there is nothing", () => {
    const small = output({ sections: [{ id: "a", label: "A", items: [{ text: "One", sources: [] }], more: 0, missing: false }] });
    expect(routinePlainLines(small, "acme")).toEqual([{ text: "One", href: null }]);
    expect(routinePlainLines(output({ empty: true, sections: [] }), "acme")).toEqual([{ text: "Nothing is still owed.", href: null }]);
    expect(outputCount(output())).toBe(4);
  });
});

describe("badges and words", () => {
  it("routine status: On, Paused, Needs you (never orange)", () => {
    expect(routineBadge({ enabled: true, pausedReason: null })).toEqual({ label: "On", tone: "success" });
    expect(routineBadge({ enabled: false, pausedReason: "new" })).toEqual({ label: "Paused", tone: "neutral" });
    expect(routineBadge({ enabled: false, pausedReason: "no_rights" })).toEqual({ label: "Needs you", tone: "warning" });
    expect(pausedWords("failing")).toBe("Paused after 3 failed runs");
    expect(pausedWords("new")).toBe("Paused until you enable it");
  });

  it("run status: Sent, Held for quiet hours, Nothing to send, Skipped, Failed", () => {
    expect(runBadge({ status: "done", delivery: "delivered", reason: null }).label).toBe("Sent");
    expect(runBadge({ status: "done", delivery: "held", reason: null }).label).toBe("Held for quiet hours");
    expect(runBadge({ status: "empty", delivery: "silent", reason: null }).label).toBe("Nothing to send");
    expect(runBadge({ status: "skipped", delivery: "none", reason: "missed" }).label).toBe("Skipped: it missed its time");
    expect(runBadge({ status: "skipped", delivery: "none", reason: "weird" }).label).toBe("Skipped: it couldn't run then");
    expect(runBadge({ status: "failed", delivery: "none", reason: "error" })).toEqual({ label: "Failed", tone: "danger" });
  });

  it("templates, limits and the J words", () => {
    expect(ROUTINE_TEMPLATES.every(isRoutineTemplate)).toBe(true);
    expect(isRoutineTemplate("chase_everyone")).toBe(false);
    expect(ROUTINE_WORDS.templates.chase_stalled.description).toBe("Asks your team's assistants about tasks with no progress for 2 working days, then tells you who was asked.");
    expect(ROUTINE_WORDS.settings.description("Max")).toBe("Things Max does for you on a schedule. New routines start paused: preview one, then enable it.");
    expect(ROUTINE_WORDS.settings.limitTip).toBe("You have 20 routines, the most you can keep.");
    expect(ROUTINE_WORDS.quiet.during("Max")).toEqual(["No pop-ups or sounds from the desktop app", "Max doesn't read replies aloud on its own", "Routines wait and arrive together when quiet hours end", "Notifications still collect in the bell"]);
    expect(ROUTINE_WORDS.notifications.bundleTitle(2)).toBe("2 routines ran during quiet hours");
    expect(ROUTINE_LIMITS).toMatchObject({ perPerson: 20, chasePerRun: 10, stalledWorkingDays: 2, catchUpMinutes: 120, maxConsecutiveFailures: 3, sectionItems: 10, reportedKeepDays: 30 });
  });
});
