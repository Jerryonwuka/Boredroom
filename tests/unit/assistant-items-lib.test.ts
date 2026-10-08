import { describe, it, expect } from "vitest";
import {
  ASSISTANT_ITEM_KINDS, ASSISTANT_ITEM_LIMITS, ASSISTANT_ITEM_NOTIFICATION_TYPES, ASSISTANT_ITEM_STATUSES, HOLDER_MOVES, REQUEST_KINDS,
  doneWords, isOpenItem, itemBadge, payloadOrNull, requestLines, type AssistantItemView,
} from "@/lib/assistant-items";
import { DEFAULT_ASSISTANT } from "@/lib/assistant-look";

// Personal assistants, phase 6 (owner decision, 8 October 2026): what the server, the inbox, the chat's card and the
// notch share about items between assistants. A request runs only from a payload that passes payloadOrNull, strictly;
// a badge always has a word.

const TZ = "Europe/London";
const TASK = "00000000-0000-4000-8000-0000000000d1";

describe("payloadOrNull", () => {
  const todo = { v: 1, kind: "add_todo", title: "Review pricing", dueAt: "2026-10-09T17:00:00+01:00" };
  const reminder = { v: 1, kind: "set_reminder", text: "Call Josh", at: "2026-10-08T15:00:00+01:00" };
  const move = { v: 1, kind: "task_status", taskId: TASK, taskTitle: "Landing page", from: "in_progress", to: "in_review", reason: null };
  const comment = { v: 1, kind: "task_comment", taskId: TASK, taskTitle: "Landing page", text: "The client approved.\nShip it." };

  it("accepts each kind as it stands", () => {
    expect(payloadOrNull(todo)).toEqual(todo);
    expect(payloadOrNull({ ...todo, dueAt: null })).toEqual({ ...todo, dueAt: null });
    expect(payloadOrNull(reminder)).toEqual(reminder);
    expect(payloadOrNull(move)).toEqual(move);
    expect(payloadOrNull({ ...move, to: "blocked", reason: "Waiting on legal" })).toEqual({ ...move, to: "blocked", reason: "Waiting on legal" });
    expect(payloadOrNull(comment)).toEqual(comment);
  });

  it("refuses another version, an unknown kind, extra or missing keys, and things that are not objects", () => {
    expect(payloadOrNull({ ...todo, v: 2 })).toBeNull();
    expect(payloadOrNull({ ...todo, kind: "delete_everything" })).toBeNull();
    expect(payloadOrNull({ ...todo, assignee: "someone" })).toBeNull();
    expect(payloadOrNull({ v: 1, kind: "add_todo", title: "Review pricing" })).toBeNull();
    for (const x of [null, undefined, "add_todo", 1, [todo]]) expect(payloadOrNull(x)).toBeNull();
  });

  it("refuses bad ids, long or empty text, times that are not ISO with an offset, and statuses that are not one", () => {
    expect(payloadOrNull({ ...move, taskId: "not-a-uuid" })).toBeNull();
    expect(payloadOrNull({ ...todo, title: "x".repeat(ASSISTANT_ITEM_LIMITS.todoTitleMax + 1) })).toBeNull();
    expect(payloadOrNull({ ...todo, title: "" })).toBeNull();
    expect(payloadOrNull({ ...todo, title: " padded " })).toBeNull();
    expect(payloadOrNull({ ...todo, title: "line\nbreak" })).toBeNull();
    expect(payloadOrNull({ ...reminder, at: "tomorrow at 3" })).toBeNull();
    expect(payloadOrNull({ ...reminder, at: "2026-10-08T15:00:00" })).toBeNull();
    expect(payloadOrNull({ ...reminder, text: "x".repeat(ASSISTANT_ITEM_LIMITS.reminderTextMax + 1) })).toBeNull();
    expect(payloadOrNull({ ...move, to: "archived" })).toBeNull();
    expect(payloadOrNull({ ...move, from: "in_review", to: "in_review" })).toBeNull();
    expect(payloadOrNull({ ...comment, text: "x".repeat(ASSISTANT_ITEM_LIMITS.commentMax + 1) })).toBeNull();
  });

  it("refuses 'blocked' without a reason: the plan asks for one first, so a payload is always executable", () => {
    expect(payloadOrNull({ ...move, to: "blocked", reason: null })).toBeNull();
  });
});

describe("requestLines and doneWords", () => {
  it("say each request in one line and one line per field", () => {
    expect(requestLines({ v: 1, kind: "add_todo", title: "Review pricing", dueAt: "2026-10-09T16:00:00Z" }, { timeZone: TZ }))
      .toEqual({ summary: "add the to-do “Review pricing”, due Fri 9 Oct, 17:00", lines: ["New to-do: “Review pricing”", "Due: Fri 9 Oct, 17:00"] });
    expect(requestLines({ v: 1, kind: "add_todo", title: "Review pricing", dueAt: null }, { timeZone: TZ }).lines).toEqual(["New to-do: “Review pricing”", "Due: no date"]);
    expect(requestLines({ v: 1, kind: "set_reminder", text: "Call Josh", at: "2026-10-08T14:00:00Z" }, { timeZone: TZ }).summary).toBe("set a reminder for Thu 8 Oct, 15:00: “Call Josh”");
    expect(requestLines({ v: 1, kind: "task_status", taskId: TASK, taskTitle: "Landing page", from: "in_progress", to: "blocked", reason: "Legal" }, { timeZone: TZ }))
      .toEqual({ summary: "move “Landing page” to Blocked", lines: ["Task: “Landing page”", "Status: In progress to Blocked", "Reason: “Legal”"] });
    expect(requestLines({ v: 1, kind: "task_comment", taskId: TASK, taskTitle: "Landing page", text: "Approved" }, { timeZone: TZ }))
      .toEqual({ summary: "comment on “Landing page”: “Approved”", lines: ["Task: “Landing page”", "Comment: “Approved”"] });
  });

  it("say what was done after the recipient accepted", () => {
    expect(doneWords({ v: 1, kind: "add_todo", title: "Review pricing", dueAt: null }, TZ)).toBe("to-do added");
    expect(doneWords({ v: 1, kind: "task_status", taskId: TASK, taskTitle: "Landing page", from: "in_progress", to: "in_review", reason: null }, TZ)).toBe("“Landing page” is now in review");
  });

  it("only allows the moves the holder may make themself", () => {
    expect(HOLDER_MOVES.todo).toEqual(["in_progress"]);
    expect(HOLDER_MOVES.in_progress).toEqual(["todo", "blocked", "in_review", "completed"]);
    expect(HOLDER_MOVES.blocked).toEqual(["in_progress"]);
    expect(HOLDER_MOVES.in_review).toEqual([]);
    expect(HOLDER_MOVES.completed).toEqual([]);
  });
});

describe("itemBadge: every kind, status and viewer has a word", () => {
  const person = (name: string) => ({ membershipId: `m-${name}`, name, firstName: name.split(" ")[0], assistant: DEFAULT_ASSISTANT });
  const reply = { id: "r1", body: "On it", createdAt: "2026-10-08T14:00:00Z", seenAt: null };
  type B = Pick<AssistantItemView, "kind" | "status" | "viewer" | "reply" | "recipient" | "report">;
  const v = (o: Partial<B>): B => ({ kind: "message", status: "delivered", viewer: "sender", reply: null, recipient: person("Ada Obi"), report: null, ...o });

  it("messages and replies", () => {
    expect(itemBadge(v({}))).toEqual({ label: "Delivered", tone: "neutral" });
    expect(itemBadge(v({ viewer: "recipient" }))).toEqual({ label: "New", tone: "warning" });
    expect(itemBadge(v({ status: "seen" }))).toEqual({ label: "Seen", tone: "success" });
    expect(itemBadge(v({ status: "seen", reply }))).toEqual({ label: "Replied", tone: "success" });
    expect(itemBadge(v({ kind: "reply", viewer: "recipient" }))).toEqual({ label: "New", tone: "warning" });
    expect(itemBadge(v({ kind: "reply", status: "seen" }))).toEqual({ label: "Seen", tone: "success" });
  });

  it("requests, for the sender and the recipient", () => {
    const r = (status: B["status"], viewer: B["viewer"] = "sender") => itemBadge(v({ kind: "request", status, viewer }));
    expect(r("delivered")).toEqual({ label: "Waiting for Ada", tone: "warning" });
    expect(r("seen")).toEqual({ label: "Waiting for Ada", tone: "warning" });
    expect(r("delivered", "recipient")).toEqual({ label: "Needs your answer", tone: "warning" });
    expect(r("accepted")).toEqual({ label: "Doing it", tone: "neutral" });
    expect(r("done")).toEqual({ label: "Done", tone: "success" });
    expect(r("declined")).toEqual({ label: "Declined", tone: "neutral" });
    expect(r("failed")).toEqual({ label: "Couldn't be done", tone: "danger" });
    expect(r("expired")).toEqual({ label: "Expired", tone: "neutral" });
    expect(r("cancelled")).toEqual({ label: "Cancelled", tone: "neutral" });
  });

  it("report notes", () => {
    const n = (status: B["status"], reportTime?: string) => itemBadge(v({ kind: "report_note", status, recipient: null }), { reportTime });
    expect(n("delivered", "18:00")).toEqual({ label: "Goes in at 18:00", tone: "neutral" });
    expect(n("delivered")).toEqual({ label: "Goes in today's report", tone: "neutral" });
    expect(n("done")).toEqual({ label: "In the report", tone: "success" });
    expect(n("withdrawn")).toEqual({ label: "Withdrawn", tone: "neutral" });
    expect(n("expired")).toEqual({ label: "Not sent", tone: "neutral" });
  });

  it("never draws an empty badge, whatever the combination", () => {
    for (const kind of ASSISTANT_ITEM_KINDS) for (const status of ASSISTANT_ITEM_STATUSES) for (const viewer of ["sender", "recipient", "reader"] as const) {
      const b = itemBadge(v({ kind, status, viewer, recipient: kind === "report_note" ? null : person("Ada Obi") }));
      expect(b.label.trim().length, `${kind} ${status} ${viewer}`).toBeGreaterThan(0);
      expect(["neutral", "warning", "success", "danger"]).toContain(b.tone);
    }
  });

  it("knows what is still open", () => {
    expect(isOpenItem({ kind: "request", status: "accepted" })).toBe(true);
    expect(isOpenItem({ kind: "request", status: "done" })).toBe(false);
    expect(isOpenItem({ kind: "message", status: "delivered" })).toBe(true);
    expect(isOpenItem({ kind: "message", status: "seen" })).toBe(false);
  });
});

describe("the shared constants", () => {
  it("match the contract (B.2, C.5)", () => {
    expect(REQUEST_KINDS).toEqual(["add_todo", "set_reminder", "task_status", "task_comment"]);
    expect(ASSISTANT_ITEM_LIMITS).toMatchObject({ messagesPerPairPerDay: 5, requestsPerPairPerDay: 3, incomingPerRecipientPerDay: 20, perSenderPerDay: 40, reportNotesPerPersonPerDay: 3, messageMax: 1000, replyMax: 280, reportNoteMax: 500, requestTtlDays: 3 });
    expect(ASSISTANT_ITEM_NOTIFICATION_TYPES).toEqual({ message: "assistant.message", request: "assistant.request", reply: "assistant.reply", outcome: "assistant.outcome", tagged: "assistant.tagged", threadReply: "assistant.thread_reply" });
  });
});
