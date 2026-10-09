import { describe, it, expect } from "vitest";
import { blockerTitle, decisionsMarkdown, reportMarkdown, standupDecisions, standupMarkdown, type DailyReport, type ReportStandup } from "@/server/services/daily-report";
import type { OrgContext } from "@/server/lib/api";

// The end-of-day report's Standup section (owner decisions, 8–9 October 2026: phase 7c, contract B.11): after the Updates
// and before the notes, one line per team the reader receives a rollup for, with the blockers named in what was posted;
// a blocker naming the reader joins "Decisions for you" unless that task is already there. Pure.

const DAVID = "00000000-0000-4000-8000-0000000000b9";
const ROLLUP = "00000000-0000-4000-8000-0000000000d2";
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222";
const ctx = {
  user: { profileId: "p", authUserId: "a", email: "d@example.test", displayName: "David King", emailVerified: true, sessionId: "test" },
  org: { id: "o", slug: "acme", name: "Acme", timezone: "Africa/Lagos", current_policy_id: null, status: "active" },
  membership: { id: DAVID, role: "manager", employee_code: "M1" },
} as unknown as OrgContext;

const standup = (): ReportStandup => ({ teams: [{
  rollupId: ROLLUP, team: "Design", posted: 4, members: 6, href: `/app/acme/home/standup?r=${ROLLUP}`,
  blockers: [
    { membershipId: "m-ben", name: "Ben Okafor", text: "\"Logo files\": waiting on Ada Obi (Can you send the SVGs?)", taskId: T1, onMembershipId: "m-ada", onName: "Ada Obi" },
    { membershipId: "m-olu", name: "Olu Ade", text: "“Pricing *page*”: waiting on David", taskId: T2, onMembershipId: DAVID, onName: "David King" },
    { membershipId: "m-sam", name: "Sam Lee", text: "Waiting on legal for the contract", taskId: null, onMembershipId: DAVID, onName: "David King" },
  ],
}] });

function report(o: Partial<DailyReport> = {}): DailyReport {
  return {
    localDate: "2026-10-09", title: "Team report, Friday 9 October", scope: "team", people: [],
    totals: { people: 0, trackedHours: 0, tasksCompleted: 0, submittedForReview: 0, overdueOpen: 0, blockedTasks: 0, daysLate: 0 },
    headline: "Your team logged no confirmed hours today.", attention: [], waitingForYourReview: 0, empty: false,
    updates: [{ membershipId: "m-olu", name: "Olu Ade", line: "Olu finished the pricing page." }], updatesAt: "2026-10-09T16:00:00Z",
    notes: [{ membershipId: "m-olu", name: "Olu Ade", assistantName: "Max", body: "Client call moved.", at: "2026-10-09T16:05:00Z" }],
    decisions: { reviews: [], corrections: [], requests: [], blocked: [] }, changes: null, snapshot: null, ...o,
  };
}
const write = (r: DailyReport) => reportMarkdown(ctx, r, { writtenAt: new Date("2026-10-09T17:00:00Z"), endOfDay: true, reportTime: "18:00", author: "Brenda", workspaceName: "Brenda" });

describe("## Standup", () => {
  it("is one line per team with its rollup, then the blockers named in what was posted", () => {
    expect(standupMarkdown("acme", standup())).toEqual([
      "## Standup",
      "",
      `- **Design**: 4 of 6 posted ([rollup](/app/acme/home/standup?r=${ROLLUP}))`,
      `  - Blocked: **Ben Okafor** on **Ada Obi**: “Logo files” ([task](/app/acme/tasks/${T1}))`,
      `  - Blocked: **Olu Ade** on **David King**: “Pricing \\*page\\*” ([task](/app/acme/tasks/${T2}))`,
      "  - Blocked: **Sam Lee** on **David King**: “Waiting on legal for the contract”",
    ]);
  });

  it("comes after the Updates and before the notes; nothing when the reader receives no rollup", () => {
    const md = write(report({ standup: standup() }));
    const updates = md.indexOf("## Updates"), section = md.indexOf("## Standup"), notes = md.indexOf("## Notes from the team");
    expect(updates).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(updates);
    expect(notes).toBeGreaterThan(section);
    expect(write(report())).not.toContain("## Standup");
    expect(write(report({ standup: null }))).not.toContain("## Standup");
  });

  it("keeps at most 10 blockers a team, then how many more", () => {
    const s = standup();
    s.teams[0].blockers = Array.from({ length: 13 }, (_, i) => ({ ...s.teams[0].blockers[0], text: `"Task ${i}": blocked` }));
    const lines = standupMarkdown("acme", s);
    expect(lines.filter((l) => l.startsWith("  - Blocked:"))).toHaveLength(10);
    expect(lines[lines.length - 1]).toBe("  - And 3 more.");
  });
});

describe("a blocker naming the reader joins Decisions for you", () => {
  it("one line per task, the reader's own blockers only, never one already listed", () => {
    const d = standupDecisions(standup(), DAVID, new Set());
    expect(d).toEqual([
      { text: "Olu is blocked on you: “Pricing *page*” (standup)", source: { kind: "task", id: T2 }, link: "“Pricing *page*”" },
      { text: "Sam is blocked on you: “Waiting on legal for the contract” (standup)", source: { kind: "standup_rollup", id: ROLLUP }, link: null },
    ]);
    // A task already in "Blocked tasks", or with an open "blocked on you" question, is not listed twice.
    expect(standupDecisions(standup(), DAVID, new Set([T2])).map((x) => x.text)).toEqual(["Sam is blocked on you: “Waiting on legal for the contract” (standup)"]);
    // Ada reads only hers.
    expect(standupDecisions(standup(), "m-ada", new Set()).map((x) => x.text)).toEqual(["Ben is blocked on you: “Logo files” (standup)"]);
  });

  it("reads in the report as the other decisions do, linked to the task or the rollup", () => {
    const lines = decisionsMarkdown("acme", { reviews: [], corrections: [], requests: [], blocked: standupDecisions(standup(), DAVID, new Set()) });
    expect(lines).toContain(`- Olu is blocked on you: [“Pricing \\*page\\*”](/app/acme/tasks/${T2}) (standup)`);
    expect(lines).toContain(`- Sam is blocked on you: “Waiting on legal for the contract” (standup) ([rollup](/app/acme/home/standup?r=${ROLLUP}))`);
  });

  it("names the task a Blocked line quotes, or the line itself, clipped", () => {
    expect(blockerTitle("\"Logo files\": waiting on Ada")).toBe("Logo files");
    expect(blockerTitle("“Hero images” is late")).toBe("Hero images");
    expect(blockerTitle(`Waiting on legal ${"x".repeat(200)}`).length).toBeLessThanOrEqual(120);
  });
});
