import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_LIMITS, FOLLOW_UP_PREFERENCES, FOLLOW_UP_STATUSES, REFUSAL_CODES, REPLY_CHOICES,
  badgeOf, batchSummary, clip, deadlineLabel, durationLabel, factLines, factsOrNull, failureWords, firstName, refusalWords, statusWords, whenLabel,
  type FollowUpFacts, type FollowUpView,
} from "@/lib/follow-ups";
import { LIMITED_PURPOSES, USAGE_PURPOSES } from "@/server/services/ai-usage";

// Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4): the shared words and
// lines every page, the notch and the model read, and the migration that holds them.

const TZ = "Africa/Lagos";
const now = new Date("2026-10-08T14:41:00Z"); // Thu 8 Oct 15:41 in Lagos

const taskFacts: FollowUpFacts = {
  v: 1, kind: "task", gatheredAt: now.toISOString(), freshSince: "2026-10-07T14:41:00Z", fresh: true, timeVisible: true,
  task: { id: "t1", title: "Landing page", project: "Website", status: "in_progress", progressPercent: 60, dueAt: "2026-10-09T16:00:00Z", overdue: false, blockedReason: null, completedAt: null },
  history: [{ from: "todo", to: "in_progress", at: "2026-10-07T09:00:00Z", by: "Ben Okafor", byThem: true, reason: null }],
  comments: [{ by: "Ben Okafor", byThem: true, at: "2026-10-07T15:02:00Z", body: "Copy is done, waiting on images" }, { by: "Olu Adeyemi", byThem: false, at: "2026-10-06T10:00:00Z", body: "Any news?" }],
  submission: null,
  time: { todaySeconds: 4800, weekSeconds: 21_900 },
  timer: { state: "running", since: "2026-10-08T13:10:00Z", taskId: "t1", taskTitle: "Landing page", ownTodo: false },
  lastUpdate: { kind: "comment", at: "2026-10-07T15:02:00Z", text: "Copy is done, waiting on images", taskTitle: "Landing page" },
};

const personFacts: FollowUpFacts = {
  v: 1, kind: "person", gatheredAt: now.toISOString(), freshSince: "2026-10-07T14:41:00Z", fresh: true, timeVisible: true,
  time: { todaySeconds: 2700, weekSeconds: 9000 },
  timer: { state: "running", since: "2026-10-08T13:10:00Z", taskId: null, taskTitle: null, ownTodo: true },
  openTasks: [
    { id: "a", title: "A", status: "in_progress", progressPercent: 60, dueAt: null, overdue: false, blockedReason: null },
    { id: "b", title: "B", status: "blocked", progressPercent: 0, dueAt: "2026-10-01T16:00:00Z", overdue: true, blockedReason: "waiting" },
  ],
  openMore: 3, completedToday: [{ id: "c", title: "C" }],
  lastUpdate: { kind: "status", at: "2026-10-08T12:00:00Z", text: "in_progress", taskTitle: "A" },
};

describe("words", () => {
  it("clips without splitting an emoji", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("a long sentence here", 10)).toBe("a long se…");
    expect(clip("abcdefgh😀xyz", 10)).toBe("abcdefgh…");
    expect(clip("abc", 1)).toBe("…");
  });

  it("gives first names, status words and durations", () => {
    expect(firstName("Ben Okafor")).toBe("Ben");
    expect(firstName("  Ada  ")).toBe("Ada");
    expect(["todo", "in_progress", "blocked", "in_review", "completed"].map((s) => statusWords(s as never))).toEqual(["not started", "in progress", "blocked", "waiting for a check", "done"]);
    expect([0, 30, 60, 2700, 4800, 7200, 21_900].map(durationLabel)).toEqual(["no time", "under a minute", "1 min", "45 min", "1 h 20 min", "2 h", "6 h 5 min"]);
  });

  it("says when: a time today, the day and time otherwise; deadlines say tomorrow", () => {
    expect(whenLabel("2026-10-08T14:40:00Z", TZ, now)).toBe("15:40");
    expect(whenLabel("2026-10-07T15:02:00Z", TZ, now)).toBe("Wed 7 Oct 16:02");
    expect(whenLabel("not a time", TZ, now)).toBe("");
    expect(deadlineLabel("2026-10-08T14:30:00Z", TZ, now)).toBe("15:30");
    expect(deadlineLabel("2026-10-09T11:00:00Z", TZ, now)).toBe("12:00 tomorrow");
    expect(deadlineLabel("2026-10-12T11:00:00Z", TZ, now)).toBe("Mon 12 Oct 12:00");
    // Late in the evening in Lagos, midnight UTC is still "today" there.
    expect(whenLabel("2026-10-08T22:30:00Z", TZ, new Date("2026-10-08T22:00:00Z"))).toBe("23:30");
  });

  it("refuses in plain words", () => {
    expect(REFUSAL_CODES.map((c) => refusalWords(c, "Ben Okafor", "Ben"))).toEqual([
      "You can't follow up on yourself. Ask me what's on your list instead.",
      "Ben Okafor isn't an active member of this workspace.",
      "That task isn't one you can see, or it was removed.",
      "Ben doesn't hold or check that task. Ask about the person who holds it.",
      "That's one of Ben's own to-dos. Assistants never share those; message Ben if you need to know.",
      "You can follow up only on people in teams you lead, people you share a task with, or anyone if you're the owner or HR. Ben isn't one of them.",
    ]);
    expect((["subject_left", "not_allowed", "task_gone", "error"] as const).map((f) => failureWords(f, "Ben"))).toEqual([
      "Ben is no longer in this workspace.", "You can no longer follow up on Ben.", "That task was removed or is no longer one you can see.", "Something went wrong; ask again.",
    ]);
  });

  it("badges every status", () => {
    const subject = { membershipId: "s", name: "Ben Okafor", firstName: "Ben", assistant: { name: "Brenda", colour: "white", visor: "bean", eyes: "pill" } } as FollowUpView["subject"];
    expect(FOLLOW_UP_STATUSES.map((status) => badgeOf({ status, subject }))).toEqual([
      { label: "Starting", tone: "neutral" }, { label: "Waiting for Ben", tone: "warning" }, { label: "Writing the answer", tone: "neutral" },
      { label: "Answered", tone: "success" }, { label: "No reply", tone: "neutral" }, { label: "Not now", tone: "neutral" },
      { label: "Cancelled", tone: "neutral" }, { label: "Couldn't follow up", tone: "danger" },
    ]);
  });

  it("sums up a group", () => {
    const c = { total: 6, open: 0, answered: 3, replied: 2, noReply: 1, declined: 0, cancelled: 0, failed: 0 };
    expect(batchSummary(c)).toBe("6 people: 3 answered from their work, 2 replied, 1 didn't reply in time.");
    expect(batchSummary({ ...c, total: 1, answered: 0, replied: 0, noReply: 0, declined: 1 })).toBe("1 person: 1 said not now.");
    expect(batchSummary({ ...c, answered: 1, failed: 1, declined: 1 })).toBe("6 people: 1 answered from their work, 2 replied, 1 didn't reply in time, 1 said not now, 1 couldn't be asked.");
  });
});

describe("what was shared, line by line", () => {
  it("lists a task's facts for the person who asked", () => {
    expect(factLines(taskFacts, { timeZone: TZ, now, first: "Ben" })).toEqual([
      "“Landing page” is in progress, 60% done, due Fri 9 Oct 17:00",
      "Latest from Ben: a comment, Wed 7 Oct 16:02: “Copy is done, waiting on images”",
      "Time on it: 1 h 20 min today, 6 h 5 min this week",
      "Working now on “Landing page” since 14:10",
      // Ben's comment is the "Latest from Ben" line: not listed twice (visual review, 8 October 2026).
      "Olu commented, Tue 6 Oct 11:00: “Any news?”",
      "Ben moved it from not started to in progress, Wed 7 Oct 10:00",
    ]);
  });

  it("writes it for the subject, and says what the asker cannot see", () => {
    const hidden = { ...taskFacts, timeVisible: false, time: null, timer: null };
    expect(factLines(hidden, { timeZone: TZ, now, first: "Ben", forSubject: true, asker: "Olu Adeyemi" })).toEqual([
      "“Landing page” is in progress, 60% done, due Fri 9 Oct 17:00",
      "Latest from you: a comment, Wed 7 Oct 16:02: “Copy is done, waiting on images”",
      "Time: not shared, Olu can't see your timesheets",
      "Olu commented, Tue 6 Oct 11:00: “Any news?”",
      "You moved it from not started to in progress, Wed 7 Oct 10:00",
    ]);
    expect(factLines(hidden, { timeZone: TZ, now, first: "Ben" })[2]).toBe("Time: not shared with you");
  });

  it("says who created the task, instead of a move to not started", () => {
    const made = { ...taskFacts, comments: [], history: [{ from: null, to: "todo", at: "2026-10-05T09:00:00Z", by: "Olu Adeyemi", byThem: false, reason: null }, { from: null, to: "todo", at: "2026-10-04T09:00:00Z", by: null, byThem: false, reason: null }] };
    const lines = factLines(made, { timeZone: TZ, now, first: "Ben" });
    expect(lines).toContain("Olu created it, Mon 5 Oct 10:00");
    expect(lines).toContain("Created, Sun 4 Oct 10:00");
    expect(lines.join("\n")).not.toContain("to not started");
  });

  it("says blocked, done, overdue and nothing lately", () => {
    const base = { ...taskFacts, history: [], comments: [], time: null, timer: null, lastUpdate: null };
    expect(factLines({ ...base, task: { ...base.task!, status: "blocked", progressPercent: 0, dueAt: null, blockedReason: "waiting on images" } }, { timeZone: TZ, now, first: "Ben" }))
      .toEqual(["“Landing page” is blocked: waiting on images", "Nothing recorded on this lately"]);
    expect(factLines({ ...base, task: { ...base.task!, status: "completed", progressPercent: 100, completedAt: "2026-10-07T13:00:00Z" } }, { timeZone: TZ, now, first: "Ben" })[0])
      .toBe("“Landing page” is done, finished Wed 7 Oct 14:00");
    expect(factLines({ ...base, task: { ...base.task!, overdue: true, dueAt: "2026-10-05T16:00:00Z" } }, { timeZone: TZ, now, first: "Ben" })[0])
      .toBe("“Landing page” is in progress, 60% done, overdue since Mon 5 Oct 17:00");
    expect(factLines({ ...base, submission: { at: "2026-10-08T09:00:00Z", note: "Draft attached" } }, { timeZone: TZ, now, first: "Ben" }).at(-1))
      .toBe("Ben sent it for a check, 10:00: “Draft attached”");
  });

  it("lists what a person is working on, never naming a to-do of their own", () => {
    expect(factLines(personFacts, { timeZone: TZ, now, first: "Ben" })).toEqual([
      "Latest from Ben: marked “A” in progress, 13:00",
      "Time logged: 45 min today, 2 h 30 min this week",
      "Timer running on a to-do of their own",
      "Open: “A” (in progress, 60%), “B” (blocked, overdue) and 3 more",
      "Finished today: “C”",
    ]);
    expect(factLines(personFacts, { timeZone: TZ, now, first: "Ben", forSubject: true })[2]).toBe("Timer running on a to-do of your own");
    expect(factLines({ ...personFacts, openTasks: [], openMore: 0, completedToday: [], timer: null, time: null, lastUpdate: null }, { timeZone: TZ, now, first: "Ben" }))
      .toEqual(["Nothing recorded lately", "No open shared work you can see"]);
  });

  it("reads a stored snapshot back, and an empty one as nothing", () => {
    expect(factsOrNull({})).toBeNull();
    expect(factsOrNull(null)).toBeNull();
    expect(factsOrNull(taskFacts)).toBe(taskFacts);
  });
});

// ---- Migration 0039: the database holds exactly what the code knows, and only adds -------------------------------------

const sql = readFileSync(join(process.cwd(), "db/migrations/0039_assistant_follow_ups.sql"), "utf8");
/** The statements without comments and without function bodies (their UPDATEs are the reply and the cancel). */
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "$$ … $$");
const listed = (re: RegExp) => re.exec(code)?.[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));

describe("migration 0039", () => {
  it("lists exactly the statuses, choices, preferences and purposes the code knows", () => {
    expect(listed(/follow_ups_status_check\s+CHECK \(status IN \(([^)]*)\)\)/)).toEqual([...FOLLOW_UP_STATUSES]);
    expect(listed(/follow_ups_reply_choice_check CHECK \(reply_choice IN \(([^)]*)\)\)/)).toEqual([...REPLY_CHOICES]);
    expect(listed(/assistant_profiles_followups_check CHECK \(followups IN \(([^)]*)\)\)/)).toEqual([...FOLLOW_UP_PREFERENCES]);
    // Phase 5 (owner decision, 8 October 2026): 0041 adds 'mention' after 0039's list (checked in mentions-lib.test.ts).
    // Phase 7b (owner decision, 8 October 2026): 0048 adds 'loose_ends' and 'commitments' (loops-migration.test.ts).
    // Phase 7c (owner decisions, 8–9 October 2026): 0050 adds 'standup' (loops-migration.test.ts).
    expect(listed(/ai_usage_purpose_check CHECK \(purpose IN \(([^)]*)\)\)/)).toEqual(USAGE_PURPOSES.filter((p) => p !== "mention" && p !== "loose_ends" && p !== "commitments" && p !== "standup"));
    expect(LIMITED_PURPOSES).toContain("followup");
    expect(code).toMatch(new RegExp(`char_length\\(question\\) BETWEEN 1 AND ${FOLLOW_UP_LIMITS.questionMax}`));
    expect(code).toMatch(new RegExp(`char_length\\(reply_note\\) BETWEEN 1 AND ${FOLLOW_UP_LIMITS.noteMax}`));
  });

  it("only adds: no dropped tables, no rows rewritten or deleted, no roles or passwords", () => {
    expect(outside).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(outside).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(outside).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(outside).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(code).not.toMatch(/\bALTER\s+(ROLE|USER)\b/i);
    expect(code).not.toMatch(/\bPASSWORD\b/i);
    expect(outside.match(/\bGRANT\b[^;]*;/gi)).toEqual([
      "GRANT EXECUTE ON FUNCTION app_follow_up_refusal(uuid, uuid, uuid) TO boardroom_app;",
      "GRANT SELECT, INSERT, UPDATE ON follow_up_batches, follow_ups TO boardroom_app;",
      "GRANT EXECUTE ON FUNCTION app_follow_up_reply(uuid, text, text) TO boardroom_app;",
      "GRANT EXECUTE ON FUNCTION app_follow_up_cancel(uuid) TO boardroom_app;",
    ]);
    // Every table and column it makes can be made again: IF NOT EXISTS everywhere, and constant defaults (metadata-only).
    for (const m of outside.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(\S+)/gi)) expect(m[2], m[0]).toMatch(/^IF$/i);
    for (const m of outside.matchAll(/\bADD COLUMN\s+(\S+)/gi)) expect(m[1], m[0]).toMatch(/^IF$/i);
  });
});
