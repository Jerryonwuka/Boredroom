import { describe, it, expect } from "vitest";
import { commitmentLines, commitmentsMarkdown, reportMarkdown, type DailyReport, type DecisionItem } from "@/server/services/daily-report";
import { DEFAULT_ASSISTANT } from "@/lib/assistant-look";
import type { CommitmentView } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

// The end-of-day report's Commitments section (owner decisions, 8 October 2026: phase 7b, contract C.5): made today and
// overdue, each line linked (the commitment, the message only when the reader can read it, the to-do), "not available"
// for a list that could not be read, at most 10 each, after "Changed since …". Pure: no database, no model.

const TZ = "Africa/Lagos";
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const DAVID = id(90), OLU = id(91), BEN = id(92), ADA = id(93);
const CONV = id(80);
const person = (membershipId: string, name: string) => ({ membershipId, name, firstName: name.split(" ")[0], assistant: DEFAULT_ASSISTANT });

const view = (o: Partial<CommitmentView> = {}): CommitmentView => ({
  id: id(1), kind: "agreed_ask", status: "open", display: "open", viewer: "supervisor",
  title: "Send the deck", dueAt: "2026-10-09T16:00:00.000Z", dueWords: "Thursday", dueLabel: "Thu 9 Oct, 17:00",
  committer: person(BEN, "Ben Okafor"), asker: person(OLU, "Olu Adeyemi"),
  where: { conversationId: CONV, kind: "channel", name: "#Design" },
  message: { id: id(2), at: "2026-10-08T08:00:00.000Z", href: `/app/acme/messages?c=${CONV}#m-${id(2)}`, quote: "Ben, can you send the deck?", withdrawn: false },
  agreement: null, todo: null, detectedBy: "claude", createdAt: "2026-10-08T08:01:00.000Z", decidedAt: "2026-10-08T09:00:00.000Z", doneAt: null,
  expiresAt: "2026-10-15T08:01:00.000Z", declineReason: null, stalled: false, badge: { label: "Open", tone: "neutral" },
  canAccept: false, canDecline: false, canDismiss: false, canMarkDone: false, acceptMakesTodo: true, href: `/app/acme/commitments?c=${id(1)}`,
  ...o,
});

describe("commitmentLines", () => {
  it("made today: what, who, due, asked by; links the commitment and the message", () => {
    expect(commitmentLines([view()], { reader: DAVID, timeZone: TZ, overdue: false })).toEqual([{
      text: "“Send the deck” (Ben Okafor), due Thu 9 Oct, 17:00, asked by Olu", source: null,
      sources: [{ kind: "commitment", id: id(1) }, { kind: "message", id: id(2), conversationId: CONV }],
    }]);
  });

  it("overdue: was due, the stalled words once noted; links the commitment and the to-do", () => {
    const v = view({ title: "Fix the login bug", committer: person(ADA, "Ada Employee"), dueLabel: "Tue 6 Oct, 17:00", stalled: true, todo: { id: id(3), title: "Fix the login bug", status: "todo", href: "/t" } });
    expect(commitmentLines([v], { reader: DAVID, timeZone: TZ, overdue: true })).toEqual([{
      text: "“Fix the login bug” (Ada Employee), was due Tue 6 Oct, 17:00, 2 working days with no progress", source: null,
      sources: [{ kind: "commitment", id: id(1) }, { kind: "task", id: id(3) }],
    }]);
  });

  it("no message link when the reader cannot read the message; 'you' for the reader as the asker; a promise names nobody", () => {
    const [noRead] = commitmentLines([view({ message: { ...view().message, href: null, quote: null } })], { reader: DAVID, timeZone: TZ, overdue: false });
    expect(noRead.sources).toEqual([{ kind: "commitment", id: id(1) }]);
    expect(commitmentLines([view()], { reader: OLU, timeZone: TZ, overdue: false })[0].text).toContain("asked by you");
    expect(commitmentLines([view({ kind: "promise", asker: null, dueAt: null, dueLabel: null })], { reader: DAVID, timeZone: TZ, overdue: false })[0].text).toBe("“Send the deck” (Ben Okafor)");
  });
});

describe("commitmentsMarkdown", () => {
  const line = (text: string, n: number): DecisionItem => ({ text, source: null, sources: [{ kind: "commitment", id: id(n) }] });

  it("is the contract's section", () => {
    const made = commitmentLines([view()], { reader: DAVID, timeZone: TZ, overdue: false });
    const overdue = commitmentLines([view({ id: id(4), title: "Fix the login bug", committer: person(ADA, "Ada Employee"), dueLabel: "Tue 6 Oct, 17:00", stalled: true, todo: { id: id(3), title: "x", status: "todo", href: "/t" } })], { reader: DAVID, timeZone: TZ, overdue: true });
    expect(commitmentsMarkdown("acme", { madeToday: made, overdue }).join("\n")).toBe([
      "## Commitments",
      "",
      "**Made today**",
      `- “Send the deck” (Ben Okafor), due Thu 9 Oct, 17:00, asked by Olu ([commitment](/app/acme/commitments?c=${id(1)}), [message](/app/acme/messages?c=${CONV}#m-${id(2)}))`,
      "",
      "**Overdue**",
      `- “Fix the login bug” (Ada Employee), was due Tue 6 Oct, 17:00, 2 working days with no progress ([commitment](/app/acme/commitments?c=${id(4)}), [task](/app/acme/tasks/${id(3)}))`,
    ].join("\n"));
  });

  it("says not available for a list that could not be read, and nothing for an empty one", () => {
    expect(commitmentsMarkdown("acme", { madeToday: null, overdue: [] })).toEqual(["## Commitments", "", "**Made today**", "- Not available."]);
    expect(commitmentsMarkdown("acme", { madeToday: [], overdue: [] })).toEqual(["## Commitments", "", "Nothing was made today and nothing is overdue."]);
  });

  it("at most 10 a list, then how many more", () => {
    const many = Array.from({ length: 13 }, (_, i) => line(`“T${i}”`, 10 + i));
    const md = commitmentsMarkdown("acme", { madeToday: many, overdue: [] });
    expect(md.filter((l) => l.startsWith("- “T"))).toHaveLength(10);
    expect(md).toContain("- And 3 more.");
  });

  it("someone's words stay text: markup is escaped and addresses are code, never links", () => {
    const md = commitmentsMarkdown("acme", { madeToday: [line("“[click](https://evil.example/x) **now**”", 1)], overdue: [] }).join("\n");
    expect(md).not.toContain("](https://evil.example");
    expect(md).toContain("`https://evil.example/x`");
    expect(md).toContain("\\*\\*now\\*\\*");
  });
});

describe("in the report", () => {
  const ctx = {
    user: { profileId: "p", authUserId: "a", email: "d@example.test", displayName: "David Lead", emailVerified: true, sessionId: "test" },
    org: { id: "o", slug: "acme", name: "Acme", timezone: TZ, current_policy_id: null, status: "active" },
    membership: { id: DAVID, role: "manager", employee_code: "M1" },
  } as unknown as OrgContext;
  const report = (o: Partial<DailyReport> = {}): DailyReport => ({
    localDate: "2026-10-08", title: "Team report, Thursday 8 October", scope: "team", people: [],
    totals: { people: 0, trackedHours: 0, tasksCompleted: 0, submittedForReview: 0, overdueOpen: 0, blockedTasks: 0, daysLate: 0 },
    headline: "Your team logged no confirmed hours today and finished no tasks.", attention: [], waitingForYourReview: 0, empty: false,
    updates: [], updatesAt: null, notes: [], decisions: { reviews: [], corrections: [], requests: [], blocked: [] },
    changes: { since: "2026-10-07", sinceLabel: "yesterday", newlyBlocked: [], unblocked: [], slipped: [], newlyLate: [], finished: [], truncated: false },
    snapshot: null, ...o,
  });
  const write = (r: DailyReport) => reportMarkdown(ctx, r, { writtenAt: new Date("2026-10-08T17:00:00Z"), endOfDay: true, reportTime: "18:00", author: "Brenda", workspaceName: "Brenda" });

  it("comes after what changed, and is left out when there is none (before 0048, or tracking off with nothing)", () => {
    const md = write(report({ commitments: { madeToday: commitmentLines([view()], { reader: DAVID, timeZone: TZ, overdue: false }), overdue: [] } }));
    expect(md.indexOf("## Commitments")).toBeGreaterThan(md.indexOf("## Changed since yesterday"));
    expect(md.indexOf("## Commitments")).toBeLessThan(md.indexOf("## Needs your attention"));
    expect(write(report({ commitments: null }))).not.toContain("## Commitments");
    expect(write(report())).not.toContain("## Commitments");
  });
});
