import { describe, it, expect } from "vitest";
import { reportMarkdown, type DailyReport, type PersonDay } from "@/server/services/daily-report";
import type { OrgContext } from "@/server/lib/api";

// Personal assistants, phase 6 (owner decision, 8 October 2026): "Tell Brenda to put this in today's team report". The
// notes go in the end-of-day report under "Notes from the team", after the Updates and before what needs attention,
// "From Olu via Max", in the person's own words: quoted as typed, never Markdown, any address shown as code.

const ctx = {
  user: { profileId: "p", authUserId: "a", email: "d@example.test", displayName: "David Lead", emailVerified: true, sessionId: "test" },
  org: { id: "o", slug: "acme", name: "Acme", timezone: "Europe/London", current_policy_id: null, status: "active" },
  membership: { id: "m", role: "manager", employee_code: "M1" },
} as unknown as OrgContext;

const olu: PersonDay = {
  membershipId: "m-olu", name: "Olu Adeyemi", teams: ["Design"], trackedSeconds: 7200, trackedHours: 2,
  tasksCompleted: 1, completedTitles: ["Pricing page"], submittedForReview: 0, submittedTitles: [],
  openTasks: 1, blockedTasks: 0, overdueOpen: 0, overdueTitles: [], daysClockedIn: 1, daysLate: 0,
  inProgress: [], blocked: [], attendance: { clockedInAt: null, lateMinutes: 0, missing: false },
  taskRefs: { completed: [{ id: "11111111-1111-4111-8111-111111111111", title: "Pricing page" }], submitted: [], overdue: [], inProgress: [], blocked: [] },
};

function report(o: Partial<DailyReport> = {}): DailyReport {
  return {
    localDate: "2026-10-08", title: "Team report, Thursday 8 October", scope: "team", people: [olu],
    totals: { people: 1, trackedHours: 2, tasksCompleted: 1, submittedForReview: 0, overdueOpen: 0, blockedTasks: 0, daysLate: 0 },
    headline: "Your team logged 2 confirmed hours today and finished 1 task.", attention: [], waitingForYourReview: 0, empty: false,
    updates: [], updatesAt: null, notes: [],
    decisions: { reviews: [], corrections: [], requests: [], blocked: [] }, changes: null, snapshot: null, ...o,
  };
}
const write = (r: DailyReport) => reportMarkdown(ctx, r, { writtenAt: new Date("2026-10-08T17:00:00Z"), endOfDay: true, reportTime: "18:00", author: "Brenda", workspaceName: "Brenda" });
const note = (body: string, o: Partial<DailyReport["notes"][number]> = {}) => ({ membershipId: "m-olu", name: "Olu Adeyemi", assistantName: "Max", body, at: "2026-10-08T15:05:00Z", ...o });

describe("Notes from the team", () => {
  it("comes after the Updates and before what needs attention, one line per note: who, via which assistant, when, the words", () => {
    const md = write(report({
      updates: [{ membershipId: "m-olu", name: "Olu Adeyemi", line: "Olu finished the pricing page." }], updatesAt: "2026-10-08T16:00:00Z",
      notes: [note("The client moved the deadline to Friday."), note("Ben covered support.", { name: "Ben Okafor", assistantName: "Brenda", at: "2026-10-08T16:30:00Z" })],
    }));
    const updates = md.indexOf("## Updates"), notes = md.indexOf("## Notes from the team"), attention = md.indexOf("## Needs your attention");
    expect(updates).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(updates);
    expect(attention).toBeGreaterThan(notes);
    expect(md).toContain([
      "## Notes from the team",
      "",
      "- **Olu Adeyemi** via Max, 16:05: “The client moved the deadline to Friday.”",
      "- **Ben Okafor** via Brenda, 17:30: “Ben covered support.”",
    ].join("\n"));
  });

  it("links each note to the note, and each update to the follow-up behind it (phase 7a: every line has a source)", () => {
    const noteId = "22222222-2222-4222-8222-222222222222", followUpId = "33333333-3333-4333-8333-333333333333";
    const md = write(report({
      updates: [{ membershipId: "m-olu", name: "Olu Adeyemi", line: "Olu finished the pricing page.", id: followUpId }], updatesAt: "2026-10-08T16:00:00Z",
      notes: [note("The client moved the deadline to Friday.", { id: noteId })],
    }));
    expect(md).toContain(`- **Olu Adeyemi**: Olu finished the pricing page. ([follow-up](/app/acme/home/follow-ups/${followUpId}))`);
    expect(md).toContain(`- **Olu Adeyemi** via Max, 16:05: “The client moved the deadline to Friday.” ([note](/app/acme/home/assistants/items/${noteId}))`);
    // An id that is not one gives no link (lib/evidence-links builds paths from UUIDs only).
    expect(write(report({ notes: [note("Plain.", { id: "not-an-id" })] }))).toContain("16:05: “Plain.”\n");
  });

  it("has no section when there are no notes", () => {
    expect(write(report())).not.toContain("Notes from the team");
  });

  it("shows Markdown in a note as typed, and an address as code, never a link", () => {
    const md = write(report({ notes: [note("**Urgent**: see [this](https://evil.example/x) and https://evil.example/y # now")] }));
    const line = md.split("\n").find((l) => l.startsWith("- **Olu Adeyemi** via Max")) ?? "";
    expect(line).toContain("\\*\\*Urgent\\*\\*");
    expect(line).toContain("\\[this\\]");
    expect(line).toContain("`https://evil.example/y`");
    expect(line).toContain("\\# now");
    expect(line).not.toMatch(/\]\(https?:/);
  });

  it("keeps a note to one line of at most 500 characters, and a name as text", () => {
    const md = write(report({ notes: [note(`first line\nsecond ${"x".repeat(600)}`, { name: "Eve *Bold* [x]", assistantName: "Max" })] }));
    const line = md.split("\n").find((l) => l.startsWith("- **Eve")) ?? "";
    expect(line.startsWith("- **Eve \\*Bold\\* \\[x\\]** via Max, 16:05: “first line second ")).toBe(true);
    expect(line.endsWith("…”")).toBe(true);
    expect(md).not.toContain("\nsecond");
  });
});
