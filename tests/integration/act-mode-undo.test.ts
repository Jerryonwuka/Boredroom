/**
 * Undo (owner decision, 8 October 2026: act without asking). Every kind a done line can offer: done through her chat
 * (`runBrendaTool`), undone as the person (`undoAction`), the state checked, then a second press: 409 ALREADY_UNDONE and
 * nothing changed. The refusals in words when the thing moved on (started, changed, seen, answered, the reminder gone
 * off); someone else's, forged and expired tokens; the log (one row per undo, generic words for owners and HR); and the
 * database's own rules for withdrawing a message passed to an assistant (migration 0045).
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (Max), Ben Okafor
 * (Brenda). Olu, David and Ada chose "Act without asking"; Ben kept "Ask me before acting".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { createReminder, setBrendaSettings } from "@/server/services/brenda";
import { saveActMode } from "@/server/services/act-mode";
import { runBrendaTool, confirmAction, type Action } from "@/server/services/copilot";
import { signUndoToken, undoAction, undoOffer, UNDO_WORDS, type UndoKind } from "@/server/services/undo";
import { acceptItem, getAssistantItem, markItemSeen, sendAssistantItem, waitingItems } from "@/server/services/assistant-items";
import { processFollowUp, replyToFollowUp } from "@/server/services/follow-ups";
import { openChannel, sendMessage } from "@/server/services/messaging";
import { updateTask } from "@/server/services/tasks";
import { todayLocal } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext;
let design = "";
const id = (c: OrgContext) => c.membership.id;
const READ = { act: "read" as const };
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await adminQuery<T>(sql, params))[0];
/** Successful undos by kind, to check the log holds exactly one row for each. */
const undone = new Map<UndoKind, number>();

/** The done line's Undo token (the action ran without a Confirm press). */
function tokenOf(r: { actions: Action[] }, i = 0): string {
  const t = r.actions[i]?.undo?.token;
  expect(t, "the done line offers Undo").toEqual(expect.any(String));
  return t!;
}

/** Undo once (it works, with these words), then again: 409 ALREADY_UNDONE. */
async function undoTwice(c: OrgContext, token: string, kind: UndoKind, words: string) {
  const r = await undoAction(c, token);
  expect(r).toEqual({ undone: true, summary: words });
  undone.set(kind, (undone.get(kind) ?? 0) + 1);
  await expect(undoAction(c, token)).rejects.toMatchObject({ status: 409, code: "ALREADY_UNDONE", message: "That was already undone." });
}

/** A refusal in words; pressed again it says the same (the claim was given back), never "already undone". */
async function refusedTwice(c: OrgContext, token: string, code: string, words: string) {
  await expect(undoAction(c, token)).rejects.toMatchObject({ status: 409, code, message: words });
  await expect(undoAction(c, token)).rejects.toMatchObject({ status: 409, code, message: words });
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  await setBrendaSettings(owner, { dailyReportTime: "23:59", dailyReportEnabled: true });
  for (const c of [olu, david, owner]) await saveActMode(c, "auto");
  design = await openChannel(david, a.teamId);
});

describe("to-dos and tasks", () => {
  it("todo_created, her own: archived", async () => {
    const r = await runBrendaTool(olu, "create_todos", { items: [{ title: "Draft the brief" }] }, "chat", READ);
    const t = await one<{ id: string }>("SELECT id FROM tasks WHERE title = 'Draft the brief'");
    await undoTwice(olu, tokenOf(r), "todo_created", "Removed the to-do");
    expect(await one("SELECT archived_at IS NOT NULL AS archived FROM tasks WHERE id = $1", [t.id])).toEqual({ archived: true });
  });

  it("todo_created in 'ask' mode too: an own to-do runs at once, so it can be undone (not marked auto)", async () => {
    const r = await runBrendaTool(ben, "create_todos", { items: [{ title: "Ben's own step" }] }, "chat", READ);
    expect(r.actions[0].auto).toBeUndefined();
    await undoTwice(ben, tokenOf(r), "todo_created", "Removed the to-do");
    const logged = await one<{ detail: Record<string, unknown> }>("SELECT detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'undo'", [id(ben)]);
    expect(logged.detail.auto).toBeUndefined();
  });

  it("todo_created, handed to Ben: archived, and the words say Ben was told", async () => {
    const r = await runBrendaTool(david, "create_todos", { items: [{ title: "Check the pricing copy", assignee: "Ben Okafor" }] }, "chat", READ);
    expect(r.actions[0].auto).toBe(true);
    await undoTwice(david, tokenOf(r), "todo_created", "Removed the to-do. Ben was already told about it.");
    expect(await one("SELECT archived_at IS NOT NULL AS archived FROM tasks WHERE title = 'Check the pricing copy'")).toEqual({ archived: true });
  });

  it("todo_created, started since: it stays, and the words say why", async () => {
    const r = await runBrendaTool(olu, "create_todos", { items: [{ title: "Start me" }] }, "chat", READ);
    const t = await one<{ id: string; version: number }>("SELECT id, version FROM tasks WHERE title = 'Start me'");
    await updateTask(olu, t.id, { expectedVersion: t.version, status: "in_progress" });
    await refusedTwice(olu, tokenOf(r), "UNDO_CHANGED", "It has changed since (started or edited), so it stays.");
    expect(await one("SELECT archived_at, status FROM tasks WHERE id = $1", [t.id])).toEqual({ archived_at: null, status: "in_progress" });
  });

  it("task_changed: the fields and the status go back", async () => {
    const before = await one("SELECT priority, status, title FROM tasks WHERE id = $1", [a.taskIds.homepage]);
    expect(before).toEqual({ priority: "high", status: "todo", title: "Homepage design" });
    const r = await runBrendaTool(olu, "update_task", { taskId: a.taskIds.homepage, priority: "urgent", status: "in_progress" }, "chat", READ);
    expect(await one("SELECT priority, status FROM tasks WHERE id = $1", [a.taskIds.homepage])).toEqual({ priority: "urgent", status: "in_progress" });
    await undoTwice(olu, tokenOf(r), "task_changed", "Put the task back as it was");
    expect(await one("SELECT priority, status, title FROM tasks WHERE id = $1", [a.taskIds.homepage])).toEqual(before);
  });

  it("task_changed, changed by someone since: it stays", async () => {
    const r = await runBrendaTool(olu, "update_task", { taskId: a.taskIds.homepage, title: "Homepage v2" }, "chat", READ);
    const t = await one<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]);
    await updateTask(david, a.taskIds.homepage, { expectedVersion: t.version, title: "Homepage v3" });
    await refusedTwice(olu, tokenOf(r), "UNDO_CHANGED", "Someone changed it since, so it stays. Open the task to change it back.");
    expect(await one("SELECT title FROM tasks WHERE id = $1", [a.taskIds.homepage])).toEqual({ title: "Homepage v3" });
  });

  it("task_assigned: the task goes back to whoever held it", async () => {
    const r = await runBrendaTool(david, "assign_task", { taskId: a.taskIds.second, assigneeMembershipId: id(olu) }, "chat", READ);
    expect(await one("SELECT assignee_membership_id FROM tasks WHERE id = $1", [a.taskIds.second])).toEqual({ assignee_membership_id: id(olu) });
    await undoTwice(david, tokenOf(r), "task_assigned", "Gave the task back to Ben");
    expect(await one("SELECT assignee_membership_id FROM tasks WHERE id = $1", [a.taskIds.second])).toEqual({ assignee_membership_id: id(ben) });
  });
});

describe("reminders, status, the day, documents", () => {
  const inTwoHours = () => new Date(Date.now() + 2 * 3600_000).toISOString();

  it("reminder_set: cancelled", async () => {
    const r = await runBrendaTool(olu, "remind_me", { body: "Call Josh", at: inTwoHours() }, "chat", READ);
    await undoTwice(olu, tokenOf(r), "reminder_set", "Cancelled the reminder");
    expect(await one("SELECT cancelled_at IS NOT NULL AS cancelled FROM brenda_reminders WHERE body = 'Call Josh'")).toEqual({ cancelled: true });
  });

  it("reminder_set, gone off since: it can't be undone", async () => {
    const r = await runBrendaTool(olu, "remind_me", { body: "Water the plants", at: inTwoHours() }, "chat", READ);
    await adminQuery("UPDATE brenda_reminders SET sent_at = now() WHERE body = 'Water the plants'");
    await refusedTwice(olu, tokenOf(r), "UNDO_TOO_LATE", "That reminder already went off.");
  });

  it("reminder_cancelled: put back", async () => {
    const rem = await createReminder(olu, { body: "Send the invoice", remindAt: inTwoHours() });
    const r = await runBrendaTool(olu, "cancel_reminder", { reminderId: rem.id }, "chat", READ);
    expect(await one("SELECT cancelled_at IS NOT NULL AS cancelled FROM brenda_reminders WHERE id = $1", [rem.id])).toEqual({ cancelled: true });
    await undoTwice(olu, tokenOf(r), "reminder_cancelled", "Put the reminder back");
    expect(await one("SELECT cancelled_at FROM brenda_reminders WHERE id = $1", [rem.id])).toEqual({ cancelled_at: null });
  });

  it("status_set: back as it was", async () => {
    expect(await one("SELECT presence FROM profiles WHERE id = $1", [olu.user.profileId])).toEqual({ presence: "active" });
    const r = await runBrendaTool(olu, "set_status", { presence: "busy" }, "chat", READ);
    expect(await one("SELECT presence FROM profiles WHERE id = $1", [olu.user.profileId])).toEqual({ presence: "busy" });
    await undoTwice(olu, tokenOf(r), "status_set", "Status back to active");
    expect(await one("SELECT presence FROM profiles WHERE id = $1", [olu.user.profileId])).toEqual({ presence: "active" });
  });

  it("day_planned: today's list back as it was", async () => {
    const today = todayLocal(olu.org.timezone);
    const plan = async () => (await adminQuery<{ task_id: string }>("SELECT task_id FROM daily_plan_items WHERE membership_id = $1 AND local_date = $2 ORDER BY position", [id(olu), today])).map((x) => x.task_id);
    const before = await plan();
    const r = await runBrendaTool(olu, "plan_day", { taskIds: [a.taskIds.meeting, a.taskIds.homepage] }, "chat", READ);
    expect(await plan()).toEqual([a.taskIds.meeting, a.taskIds.homepage]);
    await undoTwice(olu, tokenOf(r), "day_planned", "Put today's list back as it was");
    expect(await plan()).toEqual(before);
  });

  it("doc_created: archived", async () => {
    const r = await runBrendaTool(olu, "create_doc", { title: "Retro notes", body: "What went well." }, "chat", READ);
    await undoTwice(olu, tokenOf(r), "doc_created", "Removed the document");
    expect(await one("SELECT archived_at IS NOT NULL AS archived FROM documents WHERE title = 'Retro notes'")).toEqual({ archived: true });
  });
});

describe("Messages", () => {
  it("message_sent: withdrawn", async () => {
    const r = await runBrendaTool(olu, "send_message", { to: "Ben Okafor", body: "Can you send me the deck?" }, "chat", READ);
    expect(r.actions[0].auto).toBe(true);
    await undoTwice(olu, tokenOf(r), "message_sent", "Withdrew the message. They may have seen it already.");
    expect(await one("SELECT deleted_at IS NOT NULL AS withdrawn FROM messages WHERE body = 'Can you send me the deck?'")).toEqual({ withdrawn: true });
  });

  it("conversations_read: unread again", async () => {
    await sendMessage(david, { conversationId: design, body: "Retro at four." }, { startMention: false });
    const r = await runBrendaTool(olu, "mark_read", { conversations: [design] }, "chat", READ);
    expect(await one("SELECT marked_unread FROM conversation_reads WHERE conversation_id = $1 AND membership_id = $2", [design, id(olu)])).toEqual({ marked_unread: false });
    await undoTwice(olu, tokenOf(r), "conversations_read", "Marked them as unread again");
    expect(await one("SELECT marked_unread FROM conversation_reads WHERE conversation_id = $1 AND membership_id = $2", [design, id(olu)])).toEqual({ marked_unread: true });
  });
});

describe("follow-ups", () => {
  const fuOf = async (batchId: string) => adminQuery<{ id: string; subject_membership_id: string; status: string }>("SELECT id, subject_membership_id, status FROM follow_ups WHERE batch_id = $1", [batchId]);
  /** Answered by its subject (or by their assistant from their work, whichever happens without the model). */
  async function answer(subject: OrgContext, fuId: string) {
    await processFollowUp(fuId, { useModel: false });
    if ((await one<{ status: string }>("SELECT status FROM follow_ups WHERE id = $1", [fuId])).status !== "answered") {
      await replyToFollowUp(subject, fuId, { choice: "on_track" }, { useModel: false, start: false });
      await processFollowUp(fuId, { useModel: false });
    }
    expect(await one("SELECT status FROM follow_ups WHERE id = $1", [fuId])).toEqual({ status: "answered" });
  }

  it("follow_up_asked: cancelled", async () => {
    const r = await runBrendaTool(david, "follow_up", { people: ["Ben Okafor"], question: "Where are you on the pricing page?" }, "chat", { ...READ, start: false });
    const batchId = r.actions[0].followUpBatchId!;
    await undoTwice(david, tokenOf(r), "follow_up_asked", "Cancelled the follow-up");
    expect((await fuOf(batchId)).map((f) => f.status)).toEqual(["cancelled"]);
  });

  it("one of two answered: the other is cancelled, and the words say one was answered", async () => {
    const r = await runBrendaTool(owner, "follow_up", { people: ["Olu Adeyemi", "Ben Okafor"], question: "What are you working on?" }, "chat", { ...READ, start: false });
    const batchId = r.actions[0].followUpBatchId!;
    const fus = await fuOf(batchId);
    expect(fus).toHaveLength(2);
    const bens = fus.find((f) => f.subject_membership_id === id(ben))!;
    await answer(ben, bens.id);
    await undoTwice(owner, tokenOf(r), "follow_up_asked", "Cancelled the follow-up. 1 had already been answered.");
    const after = new Map((await fuOf(batchId)).map((f) => [f.subject_membership_id, f.status]));
    expect(after.get(id(ben))).toBe("answered");
    expect(after.get(id(olu))).toBe("cancelled");
  });

  it("all answered: nothing left to cancel", async () => {
    const r = await runBrendaTool(david, "follow_up", { people: ["Olu Adeyemi"], question: "Where are you on the homepage?" }, "chat", { ...READ, start: false });
    const [fu] = await fuOf(r.actions[0].followUpBatchId!);
    await answer(olu, fu.id);
    await refusedTwice(david, tokenOf(r), "UNDO_TOO_LATE", "Already answered: there is nothing left to cancel.");
  });
});

describe("between assistants", () => {
  const itemOf = (r: { actions: Action[] }) => r.actions[0].assistantItemId!;

  it("assistant_message: withdrawn; Ben no longer reads it and his notification says so", async () => {
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body: "The client moved the deadline to Friday." }, "chat", READ);
    const item = itemOf(r);
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [item])).toHaveLength(1);
    await undoTwice(olu, tokenOf(r), "assistant_message", "Withdrew your message to Ben's Brenda");
    expect(await one("SELECT status, finished_at IS NOT NULL AS finished FROM assistant_items WHERE id = $1", [item])).toEqual({ status: "withdrawn", finished: true });
    // Ben: gone from what he can read, his inbox and his item page; his notification closed with the words.
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [item])).toEqual([]);
    expect(await getAssistantItem(ben, item)).toBeNull();
    expect((await waitingItems(ben)).map((v) => v.id)).not.toContain(item);
    expect(await one("SELECT read_at IS NOT NULL AS read, body FROM notifications WHERE recipient_membership_id = $1 AND deduplication_key = $2", [id(ben), `aitem:${item}`]))
      .toEqual({ read: true, body: "Olu withdrew this message." });
    // Olu: still hers to read, under Done, "Withdrawn".
    expect(await getAssistantItem(olu, item)).toMatchObject({ status: "withdrawn", badge: { label: "Withdrawn", tone: "neutral" }, canReply: false, canSeen: false });
    // Audited once, with ids only.
    expect(await adminQuery("SELECT metadata FROM audit_events WHERE action = 'assistant_item.withdrawn' AND subject_id = $1", [item])).toEqual([{ metadata: { itemId: item, kind: "message" } }]);
  });

  it("assistant_message, seen since: it stays", async () => {
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body: "Seen before undo." }, "chat", READ);
    await markItemSeen(ben, itemOf(r));
    await refusedTwice(olu, tokenOf(r), "UNDO_TOO_LATE", "Ben has already seen it, so it stays.");
    expect(await one("SELECT status FROM assistant_items WHERE id = $1", [itemOf(r)])).toEqual({ status: "seen" });
  });

  it("assistant_message, over 10 minutes old: too late", async () => {
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body: "An old one." }, "chat", READ);
    // What was sent never changes (the guard): a data fix disables it by name.
    await adminQuery("ALTER TABLE assistant_items DISABLE TRIGGER assistant_items_guard");
    try { await adminQuery("UPDATE assistant_items SET created_at = now() - interval '11 minutes' WHERE id = $1", [itemOf(r)]); }
    finally { await adminQuery("ALTER TABLE assistant_items ENABLE TRIGGER assistant_items_guard"); }
    await refusedTwice(olu, tokenOf(r), "UNDO_EXPIRED", "It's been more than 10 minutes, so it can't be undone here.");
    expect(await one("SELECT status FROM assistant_items WHERE id = $1", [itemOf(r)])).toEqual({ status: "delivered" });
  });

  it("assistant_request: cancelled while open; after Ben accepts it stays", async () => {
    const r = await runBrendaTool(olu, "hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Review pricing" }, "chat", READ);
    await undoTwice(olu, tokenOf(r), "assistant_request", "Cancelled your request to Ben");
    expect(await one("SELECT status FROM assistant_items WHERE id = $1", [itemOf(r)])).toEqual({ status: "cancelled" });
    const r2 = await runBrendaTool(olu, "hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Review the deck" }, "chat", READ);
    await acceptItem(ben, itemOf(r2));
    await refusedTwice(olu, tokenOf(r2), "UNDO_TOO_LATE", "Ben has already answered it.");
    expect(await one("SELECT status FROM assistant_items WHERE id = $1", [itemOf(r2)])).toEqual({ status: "done" });
  });

  it("report_note: withdrawn", async () => {
    const r = await runBrendaTool(olu, "add_report_note", { body: "We shipped the beta." }, "chat", READ);
    await undoTwice(olu, tokenOf(r), "report_note", "Withdrew your note from today's team report");
    expect(await one("SELECT status FROM assistant_items WHERE id = $1", [itemOf(r)])).toEqual({ status: "withdrawn" });
  });
});

describe("whose, forged, expired", () => {
  it("someone else's token: 403, and nothing claimed or done", async () => {
    const r = await runBrendaTool(olu, "create_todos", { items: [{ title: "Not Ben's to undo" }] }, "chat", READ);
    const claims = () => one<{ n: number }>("SELECT count(*)::int AS n FROM idempotency_keys WHERE route = 'brenda-undo'");
    const before = await claims();
    await expect(undoAction(ben, tokenOf(r))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "That belongs to someone else." });
    expect(await claims()).toEqual(before);
    expect(await one("SELECT archived_at FROM tasks WHERE title = 'Not Ben''s to undo'")).toEqual({ archived_at: null });
    await undoTwice(olu, tokenOf(r), "todo_created", "Removed the to-do");
  });

  it("forged, a Confirm token or nonsense: 400 INVALID", async () => {
    const r = await runBrendaTool(olu, "create_todos", { items: [{ title: "Forged undo" }] }, "chat", READ);
    const real = tokenOf(r);
    const [body, sig] = real.split(".");
    const forged = `${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    for (const t of [forged, "not-a-token-at-all", `${Buffer.from(JSON.stringify({ k: "brenda-undo", o: olu.org.id, m: id(olu), s: { kind: "doc_created", docId: a.taskIds.homepage }, exp: 9_999_999_999 })).toString("base64url")}.x`]) {
      await expect(undoAction(olu, t)).rejects.toMatchObject({ status: 400, code: "INVALID", message: "That undo is not valid." });
    }
    // A Confirm card's token is not an Undo, and an Undo's is not a Confirm.
    const card = await runBrendaTool(ben, "send_message", { to: "Olu Adeyemi", body: "Confirm me" });
    const confirm = card.proposals.find((p) => p.kind === "confirm") as { token: string };
    await expect(undoAction(ben, confirm.token)).rejects.toMatchObject({ status: 400, code: "INVALID" });
    await expect(confirmAction(olu, real)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(await one("SELECT archived_at FROM tasks WHERE title = 'Forged undo'")).toEqual({ archived_at: null });
  });

  it("an offer that is not an undo the service knows is not made", () => {
    expect(undoOffer(olu, { kind: "todo_created", tasks: [] }, "Nothing")).toBeNull();
    expect(undoOffer(olu, { kind: "wipe_everything" } as never, "No")).toBeNull();
    const ok = undoOffer(olu, { kind: "doc_created", docId: a.taskIds.homepage }, "Saved a doc");
    expect(ok?.token).toEqual(expect.any(String));
    expect(Date.parse(ok!.until) - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it("expired: 409 UNDO_EXPIRED, nothing done", async () => {
    const r = await runBrendaTool(olu, "create_doc", { title: "Expiring notes", body: "Short-lived." }, "chat", READ);
    const doc = await one<{ id: string }>("SELECT id FROM documents WHERE title = 'Expiring notes'");
    expect(tokenOf(r)).toEqual(expect.any(String));
    const short = signUndoToken(olu, { kind: "doc_created", docId: doc.id }, "Saved “Expiring notes”", 1);
    await new Promise((res) => setTimeout(res, 2100));
    await refusedTwice(olu, short, "UNDO_EXPIRED", "It's been more than 10 minutes, so it can't be undone here.");
    expect(await one("SELECT archived_at FROM documents WHERE id = $1", [doc.id])).toEqual({ archived_at: null });
  });

  it("each undo is logged once, in generic words for owners and HR and the person's own for them", async () => {
    const rows = await adminQuery<{ summary: string; outcome: string; source: string; undo_of: string; personal: string }>(
      "SELECT summary, outcome, source, detail->>'undoOf' AS undo_of, detail->>'personalSummary' AS personal FROM brenda_actions WHERE tool = 'undo'");
    const byKind = new Map<string, number>();
    for (const x of rows) byKind.set(x.undo_of, (byKind.get(x.undo_of) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual(Object.fromEntries(undone));
    for (const x of rows) {
      expect(x).toMatchObject({ outcome: "done", source: "chat", summary: UNDO_WORDS.logged[x.undo_of as UndoKind] });
      expect(x.personal).toMatch(/^Undid: ./);
    }
    // Auto actions' undos are marked auto too.
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM brenda_actions WHERE tool = 'undo' AND (detail->>'auto') = 'true'")).n).toBeGreaterThan(0);
  });
});

describe("the database's rules for withdrawing a message to an assistant (0045)", () => {
  it("only its sender, only a message, only while unseen", async () => {
    // Ben's message to Olu: Olu (the recipient) cannot unsend it.
    const toOlu = await sendAssistantItem(ben, { kind: "message", recipientMembershipId: id(olu), body: "Hi from Ben" });
    expect(await appQueryAs(olu.user.profileId, "SELECT app_assistant_item_unsend($1) AS r", [toOlu.id])).toEqual([{ r: "not_found" }]);
    // A request or a note is never unsent (cancel and withdraw are their own steps).
    const [req] = await adminQuery<{ id: string }>("SELECT id FROM assistant_items WHERE kind = 'request' AND sender_membership_id = $1 LIMIT 1", [id(olu)]);
    const [note] = await adminQuery<{ id: string }>("SELECT id FROM assistant_items WHERE kind = 'report_note' AND sender_membership_id = $1 LIMIT 1", [id(olu)]);
    for (const x of [req.id, note.id]) expect(await appQueryAs(olu.user.profileId, "SELECT app_assistant_item_unsend($1) AS r", [x])).toEqual([{ r: "not_found" }]);
    // Seen: closed for the sender, and the guard refuses seen → withdrawn for everyone.
    await markItemSeen(olu, toOlu.id);
    expect(await appQueryAs(ben.user.profileId, "SELECT app_assistant_item_unsend($1) AS r", [toOlu.id])).toEqual([{ r: "closed" }]);
    await expect(adminQuery("UPDATE assistant_items SET status = 'withdrawn' WHERE id = $1", [toOlu.id])).rejects.toThrow(/ASSISTANT_ITEM_TRANSITION/);
    // The app role cannot move it directly either (only Boredroom's worker updates items).
    expect(await appQueryAs(ben.user.profileId, "UPDATE assistant_items SET status = 'withdrawn' WHERE id = $1 RETURNING id", [toOlu.id])).toEqual([]);
    // A fresh one: the sender's own call withdraws it, and again says ok without changing anything.
    const fresh = await sendAssistantItem(ben, { kind: "message", recipientMembershipId: id(olu), body: "Withdraw me" });
    expect(await appQueryAs(ben.user.profileId, "SELECT app_assistant_item_unsend($1) AS r", [fresh.id])).toEqual([{ r: "ok" }]);
    expect(await appQueryAs(ben.user.profileId, "SELECT app_assistant_item_unsend($1) AS r", [fresh.id])).toEqual([{ r: "ok" }]);
    expect(await appQueryAs(olu.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [fresh.id])).toEqual([]);
    expect(await appQueryAs(ben.user.profileId, "SELECT status FROM assistant_items WHERE id = $1", [fresh.id])).toEqual([{ status: "withdrawn" }]);
  });
});
