import { describe, it, expect } from "vitest";
import {
  changesMarkdown, changesSince, decisionsMarkdown, reportMarkdown, snapshotOf,
  type DailyReport, type PersonDay, type ReportSnapshot, type SnapshotTask,
} from "@/server/services/daily-report";
import type { OrgContext } from "@/server/lib/api";

// Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a, the team report). The end-of-day report opens
// with "Decisions for you" (what waits on the reader), then "Changed since yesterday" (compared with the snapshot the
// previous report was written from: newly blocked, unblocked, deadlines moved later, newly late, finished; unchanged
// tasks left out), and every line links its source. A list that could not be read says "not available", never nothing.

const TZ = "Africa/Lagos";
const ctx = {
  user: { profileId: "p", authUserId: "a", email: "d@example.test", displayName: "David Lead", emailVerified: true, sessionId: "test" },
  org: { id: "o", slug: "acme", name: "Acme", timezone: TZ, current_policy_id: null, status: "active" },
  membership: { id: "m", role: "manager", employee_code: "M1" },
} as unknown as OrgContext;

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const BEN = "m-ben", OLU = "m-olu";
const names = { [BEN]: "Ben Okafor", [OLU]: "Olu Adeyemi" };
const task = (o: Partial<SnapshotTask> = {}): SnapshotTask => ({ a: BEN, t: "A task", s: "todo", due: null, late: false, reason: null, ...o });
const snap = (localDate: string, tasks: Record<string, SnapshotTask>, o: Partial<ReportSnapshot> = {}): ReportSnapshot => ({ v: 1, at: `${localDate}T17:00:00.000Z`, localDate, truncated: false, tasks, ...o });
const TODAY = "2026-10-08"; // a Thursday

describe("changesSince", () => {
  it("puts each change in its group and leaves unchanged tasks out", () => {
    const prev = snap("2026-10-07", {
      [id(1)]: task({ t: "Landing page", s: "in_progress" }),
      [id(2)]: task({ t: "Pricing", a: OLU, s: "blocked", reason: "Waiting on David" }),
      [id(3)]: task({ t: "Invoices", s: "in_progress", due: "2026-10-08T16:00:00.000Z" }),
      [id(4)]: task({ t: "Copy", s: "todo", due: "2026-10-07T10:00:00.000Z", late: false }),
      [id(5)]: task({ t: "Logo", s: "in_review" }),
      [id(6)]: task({ t: "Unchanged", s: "in_progress", due: "2026-10-20T16:00:00.000Z" }),
      [id(7)]: task({ t: "Gone from view", s: "blocked" }),
      [id(8)]: task({ t: "Blocked then done", s: "blocked" }),
      [id(9)]: task({ t: "Review then back", a: OLU, s: "blocked" }),
    });
    const now = snap(TODAY, {
      [id(1)]: task({ t: "Landing page", s: "blocked", reason: "Brand images" }),
      [id(2)]: task({ t: "Pricing", a: OLU, s: "in_progress" }),
      [id(3)]: task({ t: "Invoices", s: "in_progress", due: "2026-10-12T16:00:00.000Z" }),
      [id(4)]: task({ t: "Copy", s: "todo", due: "2026-10-07T10:00:00.000Z", late: true }),
      [id(5)]: task({ t: "Logo", s: "completed" }),
      [id(6)]: task({ t: "Unchanged", s: "in_progress", due: "2026-10-20T16:00:00.000Z" }),
      [id(8)]: task({ t: "Blocked then done", s: "completed" }),
      [id(9)]: task({ t: "Review then back", a: OLU, s: "in_review" }),
    });
    const c = changesSince(prev, now, { names, timeZone: TZ });
    if (c === "not_available") throw new Error("expected changes");
    const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
    expect(c).toMatchObject({ since: "2026-10-07", sinceLabel: "yesterday", truncated: false });
    expect(c.newlyBlocked).toEqual([{ taskId: id(1), title: "Landing page", person: "Ben Okafor", detail: null }]);
    expect(titles(c.unblocked)).toEqual(["Pricing", "Review then back"]);
    expect(c.unblocked[0].person).toBe("Olu Adeyemi");
    expect(c.slipped).toEqual([{ taskId: id(3), title: "Invoices", person: "Ben Okafor", detail: "due Thu 8 Oct → Mon 12 Oct" }]);
    expect(c.newlyLate).toEqual([{ taskId: id(4), title: "Copy", person: "Ben Okafor", detail: "due Wed 7 Oct" }]);
    // Finished counts as finished, not as unblocked.
    expect(titles(c.finished)).toEqual(["Logo", "Blocked then done"]);
    const all = [...c.newlyBlocked, ...c.unblocked, ...c.slipped, ...c.newlyLate, ...c.finished].map((x) => x.title);
    expect(all).not.toContain("Unchanged");
    expect(all).not.toContain("Gone from view");
  });

  it("takes a task that is new since the last report as newly blocked, newly late or finished", () => {
    const c = changesSince(snap("2026-10-07", {}), snap(TODAY, {
      [id(1)]: task({ t: "New and blocked", s: "blocked" }),
      [id(2)]: task({ t: "New and late", s: "in_progress", due: "2026-10-08T08:00:00.000Z", late: true }),
      [id(3)]: task({ t: "New and done", s: "completed" }),
      [id(4)]: task({ t: "New and quiet", s: "todo" }),
    }), { names, timeZone: TZ });
    if (c === "not_available") throw new Error("expected changes");
    expect(c.newlyBlocked.map((x) => x.title)).toEqual(["New and blocked"]);
    expect(c.newlyLate.map((x) => x.title)).toEqual(["New and late"]);
    expect(c.finished.map((x) => x.title)).toEqual(["New and done"]);
    expect(c.unblocked).toEqual([]);
    expect(c.slipped).toEqual([]);
  });

  it("says a deadline moved within one day with the times, and ignores one moved earlier or removed", () => {
    const prev = snap("2026-10-07", {
      [id(1)]: task({ t: "Same day", due: "2026-10-08T11:00:00.000Z" }),
      [id(2)]: task({ t: "Earlier", due: "2026-10-12T11:00:00.000Z" }),
      [id(3)]: task({ t: "Removed", due: "2026-10-12T11:00:00.000Z" }),
      [id(4)]: task({ t: "Done anyway", due: "2026-10-08T11:00:00.000Z", s: "in_progress" }),
    });
    const now = snap(TODAY, {
      [id(1)]: task({ t: "Same day", due: "2026-10-08T16:00:00.000Z" }),
      [id(2)]: task({ t: "Earlier", due: "2026-10-09T11:00:00.000Z" }),
      [id(3)]: task({ t: "Removed", due: null }),
      [id(4)]: task({ t: "Done anyway", due: "2026-10-12T11:00:00.000Z", s: "completed" }),
    });
    const c = changesSince(prev, now, { names, timeZone: TZ });
    if (c === "not_available") throw new Error("expected changes");
    expect(c.slipped).toEqual([{ taskId: id(1), title: "Same day", person: "Ben Okafor", detail: "due Thu 8 Oct 12:00 → Thu 8 Oct 17:00" }]);
  });

  it("does not take a task missing from a cut earlier snapshot as new, and says changes may be missing", () => {
    const prev = snap("2026-10-07", { [id(1)]: task({ t: "Kept", s: "todo" }) }, { truncated: true });
    const c = changesSince(prev, snap(TODAY, {
      [id(1)]: task({ t: "Kept", s: "blocked" }),
      [id(2)]: task({ t: "Maybe cut off", s: "blocked", late: true, due: "2026-10-01T10:00:00.000Z" }),
      [id(3)]: task({ t: "Done today", s: "completed" }),
    }), { names, timeZone: TZ });
    if (c === "not_available") throw new Error("expected changes");
    expect(c.truncated).toBe(true);
    expect(c.newlyBlocked.map((x) => x.title)).toEqual(["Kept"]);
    expect(c.newlyLate).toEqual([]);
    // Everything done in today's snapshot was done after the earlier report.
    expect(c.finished.map((x) => x.title)).toEqual(["Done today"]);
    const cut = changesSince(snap("2026-10-07", {}), snap(TODAY, {}, { truncated: true }));
    expect(cut !== "not_available" && cut.truncated).toBe(true);
  });

  it("names the earlier report: yesterday, a weekday within the week, the date at 7 days; none beyond, or none at all", () => {
    const now = snap(TODAY, {});
    const label = (d: string) => { const c = changesSince(snap(d, {}), now); return c === "not_available" ? c : c.sinceLabel; };
    expect(label("2026-10-07")).toBe("yesterday");
    expect(label("2026-10-05")).toBe("Monday");
    expect(label("2026-10-02")).toBe("Friday");
    expect(label("2026-10-01")).toBe("Thursday 1 October");
    expect(label("2026-09-30")).toBe("not_available");
    expect(label(TODAY)).toBe("not_available");
    expect(changesSince(null, now)).toBe("not_available");
  });

  it("names someone it cannot place as Someone", () => {
    const c = changesSince(snap("2026-10-07", {}), snap(TODAY, { [id(1)]: task({ a: "m-gone", s: "blocked" }) }), { names });
    expect(c !== "not_available" && c.newlyBlocked[0].person).toBe("Someone");
  });
});

describe("snapshotOf", () => {
  it("reads a stored snapshot field by field and drops what is not a task", () => {
    const s = snapshotOf({
      v: 1, at: "2026-10-07T17:00:00+00:00", localDate: "2026-10-07", truncated: false,
      tasks: {
        [id(1)]: { a: BEN, t: "Landing page", s: "blocked", due: "2026-10-09T10:00:00+00:00", late: false, reason: "Images" },
        [id(2)]: { a: BEN, t: "Bad status", s: "archived", due: null, late: false, reason: null },
        "not-a-uuid": { a: BEN, t: "Bad key", s: "todo", due: null, late: false, reason: null },
        [id(3)]: "junk",
      },
    });
    expect(s).toEqual({ v: 1, at: "2026-10-07T17:00:00.000Z", localDate: "2026-10-07", truncated: false, tasks: { [id(1)]: { a: BEN, t: "Landing page", s: "blocked", due: "2026-10-09T10:00:00.000Z", late: false, reason: "Images" } } });
  });

  it("is null for anything else", () => {
    for (const bad of [null, "x", 3, [], { v: 2, at: "2026-10-07T17:00:00Z", localDate: "2026-10-07", tasks: {} }, { v: 1, at: "nope", localDate: "2026-10-07", tasks: {} }, { v: 1, at: "2026-10-07T17:00:00Z", localDate: "7 Oct", tasks: {} }, { v: 1, at: "2026-10-07T17:00:00Z", localDate: "2026-10-07" }]) {
      expect(snapshotOf(bad)).toBeNull();
    }
  });
});

describe("changesMarkdown", () => {
  const item = (n: number, title: string, person = "Ben Okafor", detail: string | null = null) => ({ taskId: id(n), title, person, detail });
  const base = { since: "2026-10-07", sinceLabel: "yesterday", newlyBlocked: [], unblocked: [], slipped: [], newlyLate: [], finished: [], truncated: false };

  it("has one line per kind of change, its tasks linked with who holds them, kinds with nothing left out", () => {
    const lines = changesMarkdown("acme", {
      ...base,
      newlyBlocked: [item(1, "Landing page"), item(2, "Pricing", "Ada")],
      slipped: [item(3, "Invoices", "Ben Okafor", "due Thu 8 Oct → Mon 12 Oct")],
      finished: [item(4, "Logo *v2* [final]")],
    });
    expect(lines).toEqual([
      "## Changed since yesterday",
      "",
      `- **Newly blocked**: [“Landing page”](/app/acme/tasks/${id(1)}) (Ben Okafor), [“Pricing”](/app/acme/tasks/${id(2)}) (Ada)`,
      `- **Deadline moved later**: [“Invoices”](/app/acme/tasks/${id(3)}) (Ben Okafor, due Thu 8 Oct → Mon 12 Oct)`,
      `- **Finished**: [“Logo \\*v2\\* \\[final\\]”](/app/acme/tasks/${id(4)}) (Ben Okafor)`,
    ]);
  });

  it("shows at most 8 tasks a line, then how many more", () => {
    const many = Array.from({ length: 11 }, (_, i) => item(i + 1, `Task ${i + 1}`));
    const line = changesMarkdown("acme", { ...base, newlyLate: many })[2];
    expect(line.match(/\]\(\/app\/acme\/tasks\//g)).toHaveLength(8);
    expect(line.endsWith(" and 3 more")).toBe(true);
  });

  it("says nothing changed, that there is nothing to compare with, and when changes may be missing", () => {
    expect(changesMarkdown("acme", { ...base, sinceLabel: "Friday" })).toEqual(["## Changed since Friday", "", "Nothing changed since Friday."]);
    expect(changesMarkdown("acme", "not_available")).toEqual(["## Changed since yesterday", "", "Not available: there is no earlier report to compare with."]);
    expect(changesMarkdown("acme", { ...base, truncated: true, unblocked: [item(1, "X")] }).slice(-2)).toEqual(["", "_Some changes may not be listed._"]);
  });
});

describe("decisionsMarkdown", () => {
  const none = { reviews: [], corrections: [], requests: [], blocked: [] };

  it("links each decision to its source: a title in place, otherwise after the line", () => {
    const lines = decisionsMarkdown("acme", {
      reviews: [{ text: "Review “Landing page” from Ben Okafor, sent 14:02", source: { kind: "task", id: id(1) }, link: "“Landing page”" }],
      requests: [
        { text: "Ben Okafor asks you to accept: Add to-do “Pricing review”", source: { kind: "assistant_item", id: id(2) } },
        { text: "Olu Adeyemi's Max asks: “Where are you on [the] *brief*? See https://evil.example/x”", source: { kind: "follow_up", id: id(3) } },
      ],
      corrections: [{ text: "Time correction from Ada on “Invoices”", source: { kind: "time_correction", id: id(4) } }],
      blocked: [{ text: "“Pricing” (Olu Adeyemi) is blocked: Waiting on David", source: { kind: "task", id: id(5) }, link: "“Pricing”" }],
    });
    expect(lines).toEqual([
      "## Decisions for you",
      "",
      `- Review [“Landing page”](/app/acme/tasks/${id(1)}) from Ben Okafor, sent 14:02`,
      `- Ben Okafor asks you to accept: Add to-do “Pricing review” ([item](/app/acme/home/assistants/items/${id(2)}))`,
      `- Olu Adeyemi's Max asks: “Where are you on \\[the\\] \\*brief\\*? See \`https://evil.example/x\`” ([follow-up](/app/acme/home/follow-ups/${id(3)}))`,
      "- Time correction from Ada on “Invoices” ([time correction](/app/acme/reviews?tab=corrections))",
      `- [“Pricing”](/app/acme/tasks/${id(5)}) (Olu Adeyemi) is blocked: Waiting on David`,
    ]);
  });

  it("says when nothing is waiting, and which lists could not be read", () => {
    expect(decisionsMarkdown("acme", none)).toEqual(["## Decisions for you", "", "Nothing is waiting on you."]);
    expect(decisionsMarkdown("acme", { ...none, requests: null, corrections: null })).toEqual([
      "## Decisions for you", "", "- Requests: not available", "- Time corrections: not available",
    ]);
  });

  it("shows ten of a kind, then how many more with the page they are on", () => {
    const reviews = Array.from({ length: 12 }, (_, i) => ({ text: `Review “T${i}” from Ben, sent 09:00`, source: { kind: "task" as const, id: id(i + 1) }, link: `“T${i}”` }));
    const lines = decisionsMarkdown("acme", { ...none, reviews });
    expect(lines.filter((l) => l.startsWith("- Review "))).toHaveLength(10);
    expect(lines.at(-1)).toBe("- And 2 more reviews ([review](/app/acme/reviews?tab=submissions))");
  });

  it("shows a title as text when its source has no page", () => {
    expect(decisionsMarkdown("acme", { ...none, reviews: [{ text: "Review “X_y” from Ben, sent 09:00", source: { kind: "task", id: "nope" }, link: "“X_y”" }] })[2])
      .toBe("- Review “X\\_y” from Ben, sent 09:00");
  });
});

describe("reportMarkdown (phase 7a)", () => {
  const ben: PersonDay = {
    membershipId: BEN, name: "Ben Okafor", teams: ["Design"], trackedSeconds: 7200, trackedHours: 2,
    tasksCompleted: 2, completedTitles: ["Landing page", "Old title"], submittedForReview: 1, submittedTitles: ["Logo"],
    openTasks: 3, blockedTasks: 1, overdueOpen: 1, overdueTitles: ["Copy"], daysClockedIn: 1, daysLate: 1,
    inProgress: [{ title: "Invoices", progress: 40 }], blocked: [{ title: "Pricing", reason: "Waiting on https://evil.example/x" }],
    attendance: { clockedInAt: "2026-10-08T08:12:00Z", lateMinutes: 12, missing: false },
    taskRefs: {
      completed: [{ id: id(1), title: "Landing page" }], submitted: [{ id: id(2), title: "Logo" }], overdue: [{ id: id(3), title: "Copy" }],
      inProgress: [{ id: id(4), title: "Invoices", progress: 40 }], blocked: [{ id: id(5), title: "Pricing", reason: "Waiting on https://evil.example/x" }],
    },
  };
  const report = (o: Partial<DailyReport> = {}): DailyReport => ({
    localDate: TODAY, title: "Team report, Thursday 8 October", scope: "team", people: [ben],
    totals: { people: 1, trackedHours: 2, tasksCompleted: 2, submittedForReview: 1, overdueOpen: 1, blockedTasks: 1, daysLate: 1 },
    headline: "Your team logged 2 confirmed hours today and finished 2 tasks.", attention: [], waitingForYourReview: 0, empty: false,
    updates: [], updatesAt: null, notes: [],
    decisions: { reviews: [{ text: "Review “Logo” from Ben Okafor, sent 14:02", source: { kind: "task", id: id(2) }, link: "“Logo”" }], corrections: [], requests: null, blocked: [] },
    changes: { since: "2026-10-07", sinceLabel: "yesterday", newlyBlocked: [{ taskId: id(5), title: "Pricing", person: "Ben Okafor", detail: null }], unblocked: [], slipped: [], newlyLate: [], finished: [], truncated: false },
    snapshot: null, ...o,
  });
  const write = (r: DailyReport, c: OrgContext = ctx) => reportMarkdown(c, r, { writtenAt: new Date("2026-10-08T17:00:00Z"), endOfDay: true, reportTime: "18:00", author: "Brenda", workspaceName: "Brenda" });

  it("puts Decisions for you right under the headline, then what changed, then the people", () => {
    const md = write(report());
    const headline = md.indexOf("**Your team logged"), decisions = md.indexOf("## Decisions for you"), changed = md.indexOf("## Changed since yesterday"), person = md.indexOf("## Ben Okafor");
    expect(headline).toBeGreaterThan(-1);
    expect(decisions).toBeGreaterThan(headline);
    expect(changed).toBeGreaterThan(decisions);
    expect(person).toBeGreaterThan(changed);
    expect(md).toContain(`- Review [“Logo”](/app/acme/tasks/${id(2)}) from Ben Okafor, sent 14:02\n- Requests: not available\n`);
    expect(md).toContain(`- **Newly blocked**: [“Pricing”](/app/acme/tasks/${id(5)}) (Ben Okafor)`);
  });

  it("links every task in a person's section, and attendance for a lead", () => {
    const md = write(report());
    expect(md).toContain(`- Finished: [“Landing page”](/app/acme/tasks/${id(1)}) and 1 more`);
    expect(md).toContain(`- Sent for review: [“Logo”](/app/acme/tasks/${id(2)})`);
    expect(md).toContain(`- In progress: [“Invoices”](/app/acme/tasks/${id(4)}) (40%)`);
    expect(md).toContain(`- Overdue: [“Copy”](/app/acme/tasks/${id(3)})`);
    // The reason is someone's words: the address shows as code, never a link.
    expect(md).toContain(`- Blocked: [“Pricing”](/app/acme/tasks/${id(5)}) (Waiting on \`https://evil.example/x\`)`);
    expect(md).toContain("- Attendance: clocked in at 09:12, 12 minutes late ([attendance](/app/acme/attendance))");
  });

  it("shows titles as text when their ids are not there", () => {
    const md = write(report({ people: [{ ...ben, taskRefs: { completed: [], submitted: [], overdue: [], inProgress: [], blocked: [] } }] }));
    expect(md).toContain("- Finished: “Landing page”, “Old title”");
    expect(md).toContain("- In progress: “Invoices” (40%)");
  });

  it("leaves Changed since out before migration 0046, and says when there is nothing to compare with", () => {
    expect(write(report({ changes: null }))).not.toContain("## Changed since");
    expect(write(report({ changes: "not_available" }))).toContain("## Changed since yesterday\n\nNot available: there is no earlier report to compare with.\n");
  });

  it("says Nothing is waiting on you when no decision waits", () => {
    expect(write(report({ decisions: { reviews: [], corrections: [], requests: [], blocked: [] } }))).toContain("## Decisions for you\n\nNothing is waiting on you.\n");
  });
});
