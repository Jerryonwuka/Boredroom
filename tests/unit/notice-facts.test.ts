import { afterEach, describe, expect, it } from "vitest";
import {
  NOTICE_LIMITS, NOTICE_RESOLVERS, answerResult, clipLine, commentIdOf, daysEarly, mentionIdOf, messageIdOf, noticeFacts, noticeKindOf, oneLine,
  reminderIdOf, reportDayOf, requestMove, reviewIdOf, snapshotCounts, storedReportFacts, submissionIdOf, whereOf, type NoticeRow,
} from "@/server/services/notice-facts";
import { REPORT_FACTS_NAMES, reportFactsOf, snapshotOf, type DailyReport, type PersonDay } from "@/server/services/daily-report";
import { REPLY_CHOICES, REPLY_LABELS, type FollowUpFacts, type FollowUpView } from "@/lib/follow-ups";
import type { OrgContext } from "@/server/lib/api";

// The notch's notification facts (owner decision, 9 October 2026: notch notifications, "A plus the grafts", contract B):
// the team report's counts as written (reportFactsOf) and as read back (storedReportFacts, or the snapshot before 0052),
// the follow-up answer's result for every status, reply and kind, the request's change from each payload, the keys the
// facts are read by, how early approved work was in the organisation's zone, and the one-line text rules. Pure: no
// database, no model.

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADA = id(1), BEN = id(2), MSG = id(10), ME = id(11);

// ---- The team report's counts --------------------------------------------------------------------------------------------

const person = (n: number, name: string, o: Partial<PersonDay> = {}): PersonDay => ({
  membershipId: id(100 + n), name, teams: ["Design"], trackedSeconds: 0, trackedHours: 0,
  tasksCompleted: 0, completedTitles: [], submittedForReview: 0, submittedTitles: [], openTasks: 0, blockedTasks: 0, overdueOpen: 0, overdueTitles: [],
  daysClockedIn: 0, daysLate: 0, inProgress: [], blocked: [], attendance: { clockedInAt: null, lateMinutes: 0, missing: false },
  taskRefs: { completed: [], submitted: [], overdue: [], inProgress: [], blocked: [] }, ...o,
});
const report = (people: PersonDay[], o: Partial<DailyReport> = {}): DailyReport => ({
  localDate: "2026-10-08", title: "Team report, Thursday 8 October", scope: "team", people,
  totals: { people: people.length, trackedHours: 0, tasksCompleted: 3, submittedForReview: 1, overdueOpen: 8, blockedTasks: 2, daysLate: 1 },
  headline: "Nobody logged confirmed hours today.", attention: [], waitingForYourReview: 4, empty: false, updates: [], updatesAt: null, notes: [],
  decisions: { reviews: [], corrections: [], requests: [], blocked: [] }, changes: null, snapshot: null, ...o,
});

describe("reportFactsOf", () => {
  it("is the report's own numbers: hours from the people, the totals, who did not clock in and who was late", () => {
    const r = report([
      person(1, "Fabro Fashio", { attendance: { clockedInAt: null, lateMinutes: 0, missing: true } }),
      person(2, "Jerry Onwuka", { trackedSeconds: 1800, attendance: { clockedInAt: null, lateMinutes: 0, missing: true } }),
      person(3, "Aba Shopping", { trackedSeconds: 46_200, attendance: { clockedInAt: "2026-10-08T08:40:00Z", lateMinutes: 40, missing: false } }),
    ]);
    expect(reportFactsOf(r)).toEqual({
      v: 1, localDate: "2026-10-08", scope: "team", people: 3, trackedSeconds: 48_000, finished: 3, sentForReview: 1, overdue: 8, blocked: 2, waitingForYou: 4,
      missing: [{ membershipId: id(101), name: "Fabro Fashio" }, { membershipId: id(102), name: "Jerry Onwuka" }], missingCount: 2,
      late: [{ membershipId: id(103), name: "Aba Shopping", minutes: 40 }], lateCount: 1,
    });
  });

  it("keeps at most 12 names a list with the whole count, names on one line of 80 characters, and stays under 15 KB", () => {
    const many = Array.from({ length: 30 }, (_, i) => person(i, `${"𝔄".repeat(70)} Person\n${i}`, { attendance: { clockedInAt: null, lateMinutes: i % 2 ? 5 : 0, missing: i % 2 === 0 } }));
    const f = reportFactsOf(report(many));
    expect(f.missing).toHaveLength(REPORT_FACTS_NAMES);
    expect(f.missingCount).toBe(15);
    expect(f.late).toHaveLength(REPORT_FACTS_NAMES);
    expect(f.lateCount).toBe(15);
    for (const p of [...f.missing, ...f.late]) {
      expect(p.name).not.toMatch(/\n/);
      expect(p.name.length).toBeLessThanOrEqual(80);
    }
    expect(Buffer.byteLength(JSON.stringify(f))).toBeLessThan(15_000);
  });

  it("reads back as written; anything that is not one is null and stray names are dropped", () => {
    const f = reportFactsOf(report([person(1, "Ada Obi", { attendance: { clockedInAt: null, lateMinutes: 0, missing: true } })]));
    expect(storedReportFacts(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(storedReportFacts(null)).toBeNull();
    expect(storedReportFacts({ ...f, v: 2 })).toBeNull();
    expect(storedReportFacts({ ...f, overdue: -1 })).toBeNull();
    expect(storedReportFacts({ ...f, finished: "3" })).toBeNull();
    expect(storedReportFacts({ ...f, scope: "everyone" })).toBeNull();
    expect(storedReportFacts({ ...f, missing: [{ membershipId: "not-an-id", name: "X" }, ...f.missing] })!.missing).toEqual(f.missing);
  });
});

describe("the snapshot's counts (before 0052)", () => {
  it("finished, overdue (late and not done) and blocked", () => {
    const s = snapshotOf({
      v: 1, at: "2026-10-08T17:00:00.000Z", localDate: "2026-10-08", truncated: false, tasks: {
        [id(1)]: { a: ADA, t: "Landing page", s: "completed", due: null, late: false, reason: null },
        [id(2)]: { a: ADA, t: "Copy", s: "in_progress", due: "2026-10-01T10:00:00.000Z", late: true, reason: null },
        [id(3)]: { a: BEN, t: "Logo", s: "blocked", due: "2026-10-02T10:00:00.000Z", late: true, reason: "Waiting" },
        [id(4)]: { a: BEN, t: "Pricing", s: "todo", due: null, late: false, reason: null },
        [id(5)]: { a: BEN, t: "Done late", s: "completed", due: "2026-10-01T10:00:00.000Z", late: true, reason: null },
      },
    })!;
    expect(snapshotCounts(s)).toEqual({ finished: 2, overdue: 2, blocked: 1 });
  });
});

// ---- The follow-up answer's result ---------------------------------------------------------------------------------------

const base: FollowUpFacts = { v: 1, kind: "person", gatheredAt: "2026-10-08T12:00:00Z", freshSince: "2026-10-08T00:00:00Z", fresh: true, timeVisible: true, lastUpdate: null };
const view = (o: Partial<Pick<FollowUpView, "status" | "reply" | "facts">>): Pick<FollowUpView, "status" | "reply" | "facts"> => ({ status: "answered", reply: null, facts: base, ...o });

describe("answerResult", () => {
  it("closed without an answer from the work: no reply, not now, couldn't follow up; still open or cancelled: none", () => {
    expect(answerResult(view({ status: "expired" }))).toEqual({ key: "no_reply", label: "No reply" });
    expect(answerResult(view({ status: "declined" }))).toEqual({ key: "not_now", label: "Not now" });
    expect(answerResult(view({ status: "failed", facts: null }))).toEqual({ key: "failed", label: "Couldn't follow up" });
    for (const status of ["pending", "asking", "answering", "cancelled"] as const) expect(answerResult(view({ status }))).toBeNull();
  });

  it("a reply wins, by its choice", () => {
    for (const choice of REPLY_CHOICES) {
      expect(answerResult(view({ reply: { choice, note: null, at: "2026-10-08T12:00:00Z" } }))).toEqual({ key: choice, label: REPLY_LABELS[choice] });
    }
  });

  it("a task's follow-up answered from the work: the task's status", () => {
    const task = (status: NonNullable<FollowUpFacts["task"]>["status"]): FollowUpFacts => ({ ...base, kind: "task", task: { id: id(1), title: "Landing page", project: "Web", status, progressPercent: 0, dueAt: null, overdue: false, blockedReason: null, completedAt: null } });
    expect(answerResult(view({ facts: task("todo") }))).toEqual({ key: "not_started", label: "Not started" });
    expect(answerResult(view({ facts: task("in_progress") }))).toEqual({ key: "in_progress", label: "In progress" });
    expect(answerResult(view({ facts: task("blocked") }))).toEqual({ key: "blocked", label: "Blocked" });
    expect(answerResult(view({ facts: task("in_review") }))).toEqual({ key: "in_review", label: "In review" });
    expect(answerResult(view({ facts: task("completed") }))).toEqual({ key: "done", label: "Done" });
  });

  it("a person's follow-up answered from the work: their time today, only when the asker may see it", () => {
    const time = (todaySeconds: number) => ({ todaySeconds, weekSeconds: 840 });
    expect(answerResult(view({ facts: { ...base, time: time(0), timer: { state: "running", since: "2026-10-08T11:00:00Z", taskId: null, taskTitle: null, ownTodo: true } } }))).toEqual({ key: "on_track", label: "Working now" });
    expect(answerResult(view({ facts: { ...base, time: time(600), timer: null } }))).toEqual({ key: "on_track", label: "Working today" });
    expect(answerResult(view({ facts: { ...base, time: time(0), timer: { state: "paused", since: "2026-10-08T11:00:00Z", taskId: null, taskTitle: null, ownTodo: false } } }))).toEqual({ key: "not_started", label: "Not started today" });
    expect(answerResult(view({ facts: { ...base, timeVisible: false, time: null, timer: null } }))).toBeNull();
    expect(answerResult(view({ facts: { ...base, time: null } }))).toBeNull();
    expect(answerResult(view({ facts: null }))).toBeNull();
  });
});

// ---- The request's change ------------------------------------------------------------------------------------------------

describe("requestMove", () => {
  const none = { title: null, taskTitle: null, fromStatus: null, toStatus: null, dueAt: null, at: null, text: null };
  it("draws each payload's change; a task move's statuses as keys (the notch has the words)", () => {
    expect(requestMove({ v: 1, kind: "add_todo", title: "Review pricing", dueAt: "2026-10-09T16:00:00.000Z" })).toEqual({ ...none, kind: "add_todo", title: "Review pricing", dueAt: "2026-10-09T16:00:00.000Z" });
    expect(requestMove({ v: 1, kind: "add_todo", title: "Review pricing", dueAt: null })).toEqual({ ...none, kind: "add_todo", title: "Review pricing" });
    expect(requestMove({ v: 1, kind: "set_reminder", text: "Call the printer", at: "2026-10-08T14:00:00.000Z" })).toEqual({ ...none, kind: "set_reminder", text: "Call the printer", at: "2026-10-08T14:00:00.000Z" });
    expect(requestMove({ v: 1, kind: "task_status", taskId: id(1), taskTitle: "Checkout flow", from: "in_progress", to: "in_review", reason: "Ready" })).toEqual({ ...none, kind: "task_status", taskTitle: "Checkout flow", fromStatus: "in_progress", toStatus: "in_review" });
    expect(requestMove({ v: 1, kind: "task_comment", taskId: id(1), taskTitle: "Checkout flow", text: "Looks good\nto me" })).toEqual({ ...none, kind: "task_comment", taskTitle: "Checkout flow", text: "Looks good to me" });
    expect(requestMove(null)).toBeNull();
    expect(requestMove(undefined)).toBeNull();
  });
});

// ---- Keys, kinds, days early, text ---------------------------------------------------------------------------------------

describe("the keys the facts are read by", () => {
  it("take the id from their own prefix only, and only a UUID", () => {
    expect(messageIdOf(`message:${MSG}`)).toBe(MSG);
    expect(messageIdOf(`message:${MSG.toUpperCase()}`)).toBe(MSG);
    expect(mentionIdOf(`mention:${MSG}:${ME}`)).toBe(MSG);
    expect(commentIdOf(`comment:${MSG}:${ME}`)).toBe(MSG);
    expect(reminderIdOf(`brenda.reminder:${MSG}`)).toBe(MSG);
    expect(reviewIdOf(`review:${MSG}`)).toBe(MSG);
    expect(submissionIdOf(`review.requested:${MSG}`)).toBe(MSG);
    const parsers = [messageIdOf, mentionIdOf, commentIdOf, reminderIdOf, reviewIdOf, submissionIdOf];
    for (const bad of [null, undefined, "", "message:", "message:abc", `message:${MSG}x`, `message:${MSG}:${ME}`, `mention:${MSG}`, `mention:${MSG}:me`,
      `comment:${MSG}`, `brenda.reminder:${MSG}:${ME}`, `review.request:${MSG}`, `message.report:${MSG}`, "message:'; DROP TABLE x;--", `MESSAGE:${MSG}`]) {
      expect(parsers.map((p) => p(bad))).toEqual([null, null, null, null, null, null]);
    }
    expect(messageIdOf(`mention:${MSG}:${ME}`)).toBeNull();
    expect(mentionIdOf(`message:${MSG}`)).toBeNull();
    expect(reviewIdOf(`review.requested:${MSG}`)).toBeNull();
    expect(submissionIdOf(`review:${MSG}`)).toBeNull();
    expect(messageIdOf("message:not-a-uuid")).toBeNull();
    expect(reportDayOf("brenda.daily_report:2026-10-08")).toBe("2026-10-08");
    for (const bad of ["brenda.daily_report:2026-02-30", "brenda.daily_report:2026-10-8", "brenda.daily_report:", `brenda.daily_report:${MSG}`, "report:2026-10-08", null]) expect(reportDayOf(bad)).toBeNull();
    expect(reminderIdOf(`brenda.reminder:${MSG.slice(0, -1)}`)).toBeNull();
  });

  it("each type has its kind; the state lists' types and unknown ones have none", () => {
    const k = (type: string, resource_type: string | null = null) => noticeKindOf({ type, resource_type });
    expect(k("message.direct")).toBe("message");
    expect(k("message.mention")).toBe("mention");
    expect(k("task.comment")).toBe("comment");
    expect(k("brenda.followup_answer")).toBe("answer");
    expect(k("brenda.followup_batch", "follow_up")).toBe("batch");
    expect(k("brenda.followup_batch", "routine_run")).toBeNull();
    expect(k("brenda.daily_report")).toBe("report");
    for (const t of ["review.requested", "review.approved", "review.changes_requested", "review.question"]) expect(k(t)).toBe("review");
    expect(k("task.assigned")).toBe("assignment");
    expect(k("assistant.request")).toBe("request");
    expect(k("assistant.outcome")).toBe("request");
    for (const t of ["brenda.commitment_due", "brenda.commitment_accepted", "brenda.commitment_declined", "brenda.commitment_stalled"]) expect(k(t)).toBe("commitment");
    expect(k("brenda.reminder")).toBe("reminder");
    expect(k("brenda.routine")).toBe("routine");
    expect(k("brenda.standup_rollup")).toBe("rollup");
    // Phase 8: a missed call has facts; a call's notes do not (the plain card).
    expect(k("call.missed", "call")).toBe("call");
    expect(k("call.recap", "call")).toBeNull();
    for (const t of ["brenda.followup_ask", "assistant.message", "assistant.reply", "brenda.commitment", "brenda.open_ask", "brenda.blocked_on", "brenda.standup", "brenda.nudge", "billing.trial", "x"]) expect(k(t)).toBeNull();
  });
});

describe("daysEarly", () => {
  it("counts whole days in the organisation's zone, across a day boundary", () => {
    // Due 23:30 UTC on 9 December: 10 December in Lagos (UTC+1), still 9 December in London (UTC+0 in winter).
    expect(daysEarly("2026-12-09T23:30:00Z", "2026-12-09T10:00:00Z", "Africa/Lagos")).toBe(1);
    expect(daysEarly("2026-12-09T23:30:00Z", "2026-12-09T10:00:00Z", "Europe/London")).toBe(0);
    // Done 23:30 UTC on 8 October: 9 October in both (London is on summer time until 25 October).
    expect(daysEarly("2026-10-09T12:00:00Z", "2026-10-08T23:30:00Z", "Africa/Lagos")).toBe(0);
    expect(daysEarly("2026-10-09T12:00:00Z", "2026-10-08T23:30:00Z", "Europe/London")).toBe(0);
    expect(daysEarly("2026-10-08T12:00:00Z", "2026-10-10T08:00:00Z", "Africa/Lagos")).toBe(-2);
    expect(daysEarly(null, "2026-10-10T08:00:00Z", "Africa/Lagos")).toBeNull();
    expect(daysEarly("2026-10-10T08:00:00Z", null, "Africa/Lagos")).toBeNull();
    expect(daysEarly("not a date", "2026-10-10T08:00:00Z", "Africa/Lagos")).toBeNull();
  });
});

describe("text", () => {
  it("is one line: control and direction characters to spaces, runs collapsed", () => {
    expect(oneLine("  Can we push\n\tstandup\u0000 to 10:30?\u2028Thanks\u202e!  ")).toBe("Can we push standup to 10:30? Thanks !");
    expect(oneLine(null)).toBe("");
    expect(clipLine(" \n ")).toBeNull();
  });

  it("clips previews at 160 and names at 80, never splitting an emoji", () => {
    const long = `${"a".repeat(158)}😀😀`;
    const p = clipLine(long)!;
    expect(p.length).toBeLessThanOrEqual(NOTICE_LIMITS.preview);
    expect(p.endsWith("…")).toBe(true);
    expect(p).not.toMatch(/[\ud800-\udbff]…$/);
    expect(clipLine("x".repeat(200), NOTICE_LIMITS.name)!.length).toBe(80);
    expect(clipLine("Short")).toBe("Short");
  });

  it("says where a message was as the reader would", () => {
    expect(whereOf("direct", null)).toBe("your chat");
    expect(whereOf("organisation", null)).toBe("Everyone");
    expect(whereOf("team", "Design")).toBe("#Design");
    expect(whereOf("channel", "Launch\nplans")).toBe("#Launch plans");
    expect(whereOf("team", null)).toBeNull();
  });
});

// ---- The whole never throws ----------------------------------------------------------------------------------------------

describe("noticeFacts", () => {
  const ctx = {
    user: { profileId: id(50), authUserId: id(51), email: "a@example.test", displayName: "Ada Obi", emailVerified: true, sessionId: "test" },
    org: { id: id(52), slug: "acme", name: "Acme", timezone: "Africa/Lagos", current_policy_id: null, status: "active" },
    membership: { id: ME, role: "employee", employee_code: "E1" },
  } as unknown as OrgContext;
  const row = (type: string, n: number): NoticeRow => ({ id: id(200 + n), type, title: "T", body: null, href: null, resource_id: null, resource_type: null, deduplication_key: `brenda.reminder:${id(300 + n)}`, created_at: "2026-10-08T12:00:00Z" });
  const original = NOTICE_RESOLVERS.reminder;
  afterEach(() => { NOTICE_RESOLVERS.reminder = original; });

  it("has nothing to read for kinds without facts", async () => {
    expect((await noticeFacts(ctx, [row("brenda.nudge", 1), row("assistant.message", 2), row("x.y", 3)])).size).toBe(0);
  });

  it("a kind that fails is absent and nothing throws; each kind reads at most six, newest first", async () => {
    const seen: string[][] = [];
    NOTICE_RESOLVERS.reminder = async (_c, rows) => { seen.push(rows.map((r) => r.id)); throw new Error("boom"); };
    const rows = Array.from({ length: 9 }, (_, i) => row("brenda.reminder", i));
    await expect(noticeFacts(ctx, rows)).resolves.toEqual(new Map());
    expect(seen).toEqual([rows.slice(0, NOTICE_LIMITS.perKind).map((r) => r.id)]);
  });

  it("only what a resolver built is kept, under each notification's own id", async () => {
    NOTICE_RESOLVERS.reminder = async (_c, rows) => new Map([[rows[0].id, { people: [], make: () => ({ v: 1, kind: "reminder", text: "Call", at: "2026-10-08T14:00:00Z", setAt: null, taskTitle: null, taskId: null }) }]]);
    const out = await noticeFacts(ctx, [row("brenda.reminder", 1), row("brenda.reminder", 2)]);
    expect([...out.keys()]).toEqual([id(201)]);
    expect(out.get(id(201))).toMatchObject({ kind: "reminder", text: "Call" });
  });
});
