/**
 * Assistants talk to each other, end to end across the builders' seams (owner decision, 8 October 2026: personal
 * assistants, phase 6; integration review, 8 October 2026). Each case goes the whole way a person's presses go: her chat's
 * Confirm card on the sender's side, the recipient's own chat (or inbox step) on the other side, what both inboxes, the
 * bell and the notch show, the worker's job for what happens when nobody is looking, and Messages for "@Ben's Brenda".
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model: the key is dropped,
 * `startMention: false` on every send and runs are driven with `useModel: false`.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (her assistant is Max),
 * Ben Okafor (kept Brenda). #design is the Design team channel.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { runBrendaTool, confirmAction, type Proposal, type Action } from "@/server/services/copilot";
import {
  assistantItemsForDesktop, getAssistantItem, listAssistantItems, markItemSeen, setMute, waitingItems,
} from "@/server/services/assistant-items";
import { openChannel, sendMessage, thread, type SendInput } from "@/server/services/messaging";
import { processMention } from "@/server/services/mention-processor";
import { saveFollowUpPreference } from "@/server/services/follow-ups";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let david: OrgContext, olu: OrgContext, ben: OrgContext;
let design: string;
const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const itemIdOf = (x: Action | undefined) => (x as (Action & { assistantItemId?: string }) | undefined)?.assistantItemId ?? "";
const notes = (c: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null; resource_id: string | null; read_at: string | null }>(
    "SELECT title, body, resource_id, read_at FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [id(c), type]);
/** Her chat, then the Confirm press: the two steps a person takes. */
async function chatAndConfirm(c: OrgContext, tool: string, input: Record<string, unknown>) {
  const r = await runBrendaTool(c, tool, input);
  const card = confirmOf(r.proposals);
  if (!card) throw new Error(`no card: ${JSON.stringify(r.out)}`);
  const done = await confirmAction(c, card.token);
  expect(done.error).toBeNull();
  return { card, done, itemId: itemIdOf(done.actions[0]) };
}
type Token = NonNullable<SendInput["mentions"]>[number];
const BENS = (label = "@Ben's Brenda") => ({ kind: "others_assistant", membershipId: id(ben), label }) as unknown as Token;
const send = (c: OrgContext, body: string, mentions?: Token[]) => sendMessage(c, { conversationId: design, body, mentions }, { startMention: false });
const mentionRow = async (mid: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_mentions WHERE id = $1", [mid]))[0];

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
});

describe("a message, there and back, through both people's chats", () => {
  it("Olu's Max passes it on; Ben's own Brenda replies; Olu's assistant shows it seen and replied", async () => {
    const sent = await chatAndConfirm(olu, "pass_message", { to: "Ben Okafor", body: "The client moved the deadline to Friday." });
    const itemId = sent.itemId;
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
    // Ben: the bell, the notch and his Waiting for you.
    expect((await notes(ben, "assistant.message")).map((n) => n.resource_id)).toEqual([itemId]);
    expect((await assistantItemsForDesktop(ben)).waiting.map((w) => w.id)).toEqual([itemId]);
    expect((await waitingItems(ben)).map((v) => v.id)).toEqual([itemId]);
    // Olu's live status card reads the item: Delivered.
    expect(await getAssistantItem(olu, itemId)).toMatchObject({ status: "delivered", badge: { label: "Delivered" } });

    // Ben's own assistant: he asks what's there (quoted, taints the turn), then replies through a Confirm.
    const inbox = await runBrendaTool(ben, "assistant_inbox", {});
    expect(JSON.stringify(inbox.out)).toContain("The client moved the deadline to Friday.");
    const reply = await chatAndConfirm(ben, "respond_to_item", { itemId, action: "reply", text: "Noted, thanks." });
    expect(reply.card.summary).toBe("Reply to Olu?");

    // Olu: the message is seen and replied; the reply waits for her, on the bell and the notch's update card.
    expect(await getAssistantItem(olu, itemId)).toMatchObject({ status: "seen", badge: { label: "Replied" }, reply: { body: "Noted, thanks." } });
    const [rn] = await notes(olu, "assistant.reply");
    expect(rn).toMatchObject({ title: "Ben replied to your message", body: "“Noted, thanks.”" });
    const waiting = await waitingItems(olu);
    expect(waiting.map((v) => v.kind)).toEqual(["reply"]);
    expect(waiting[0].id).toBe(rn.resource_id);
    expect((await assistantItemsForDesktop(olu)).updates).toEqual([expect.objectContaining({ id: rn.resource_id, kind: "reply", body: "Noted, thanks." })]);
    // Olu reads it: it leaves her Waiting for you; nobody can reply to a reply.
    await markItemSeen(olu, rn.resource_id!);
    expect(await waitingItems(olu)).toEqual([]);
    expect((await runBrendaTool(olu, "respond_to_item", { itemId: rn.resource_id, action: "reply", text: "Great" })).out).toMatchObject({ error: expect.any(String) });
    // Sent and Received agree.
    expect((await listAssistantItems(olu, { box: "sent" })).items.map((v) => v.id)).toContain(itemId);
    expect((await listAssistantItems(ben, { box: "received" })).items.map((v) => v.id)).toContain(itemId);
  });
});

describe("a request, there and back", () => {
  it("Ben accepts in his chat; his assistant does it as him; Olu's status card says so", async () => {
    const sent = await chatAndConfirm(olu, "hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Review pricing" });
    expect(await adminQuery("SELECT 1 FROM tasks WHERE title = 'Review pricing'")).toEqual([]);
    expect((await assistantItemsForDesktop(ben)).waiting).toEqual([expect.objectContaining({ id: sent.itemId, kind: "request", lines: expect.arrayContaining([expect.any(String)]) })]);
    await chatAndConfirm(ben, "respond_to_item", { itemId: sent.itemId, action: "accept" });
    expect(await adminQuery("SELECT created_by, assignee_membership_id FROM tasks WHERE title = 'Review pricing'")).toEqual([{ created_by: id(ben), assignee_membership_id: id(ben) }]);
    expect(await getAssistantItem(olu, sent.itemId)).toMatchObject({ status: "done", badge: { label: "Done" } });
    expect((await notes(olu, "assistant.outcome")).at(-1)).toMatchObject({ title: expect.stringMatching(/^Ben accepted: /), resource_id: sent.itemId });
    expect((await assistantItemsForDesktop(olu)).updates.map((u) => u.id)).toContain(sent.itemId);
  });

  it("a change Ben could not make himself is refused at the plan; nothing is sent", async () => {
    // "Homepage design" is Olu's task, not Ben's to move.
    const r = await runBrendaTool(olu, "hand_over_request", { to: "Ben Okafor", kind: "task_status", taskId: a.taskIds.homepage, status: "in_progress" });
    expect(confirmOf(r.proposals)).toBeUndefined();
    expect(JSON.stringify(r.out)).toContain("Ben doesn't hold that task, so Ben can't move it.");
    expect(await adminQuery("SELECT 1 FROM assistant_items WHERE task_id = $1", [a.taskIds.homepage])).toEqual([]);
  });

  it("Ben declines with a reason through his chat; Olu reads the reason", async () => {
    const sent = await chatAndConfirm(olu, "hand_over_request", { to: "Ben Okafor", kind: "set_reminder", text: "Call Josh", at: new Date(Date.now() + 5 * 3_600_000).toISOString() });
    await chatAndConfirm(ben, "respond_to_item", { itemId: sent.itemId, action: "decline", text: "I already called him." });
    expect(await getAssistantItem(olu, sent.itemId)).toMatchObject({ status: "declined", declineReason: "I already called him." });
    expect((await notes(olu, "assistant.outcome")).at(-1)).toMatchObject({ title: "Ben declined your request", body: "“I already called him.”" });
    expect(await adminQuery("SELECT 1 FROM brenda_reminders WHERE body = 'Call Josh'")).toEqual([]);
  });

  it("Olu cancels through her chat while it is open", async () => {
    const sent = await chatAndConfirm(olu, "hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Order cables" });
    await chatAndConfirm(olu, "respond_to_item", { itemId: sent.itemId, action: "cancel" });
    expect(await getAssistantItem(ben, sent.itemId)).toMatchObject({ status: "cancelled", canAccept: false });
  });
});

describe("what happens when nobody is looking: the worker's job", () => {
  it("the schedule sees an expired request and the assistant_item.sweep job closes it and tells the sender", async () => {
    // A request whose time has passed (admin insert: a request cannot be sent already expired).
    const [{ id: itemId }] = await adminQuery<{ id: string }>(
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, request_kind, payload, expires_at)
       VALUES ($1, 'request', $2, $3, 'add_todo', $4::jsonb, now() - interval '1 minute') RETURNING id`,
      [org(), id(olu), id(ben), JSON.stringify({ v: 1, kind: "add_todo", title: "Old thing", dueAt: null })]);
    const { scheduleAssistantItemSweep } = await import("../../worker/schedule");
    expect(await scheduleAssistantItemSweep()).toMatchObject({ queued: true, due: true });
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE type = 'assistant_item.sweep' AND state = 'pending'"))[0].n).toBeGreaterThan(0);
    const { handlers } = await import("../../worker/handlers");
    await handlers["assistant_item.sweep"]({}, { jobId: "test", attempt: 1 });
    expect((await adminQuery<{ status: string }>("SELECT status FROM assistant_items WHERE id = $1", [itemId]))[0].status).toBe("expired");
    expect((await notes(olu, "assistant.outcome")).at(-1)).toMatchObject({ title: "No answer from Ben", resource_id: itemId });
  });
});

describe("a mute, end to end", () => {
  it("the sender's chat says so in the agreed words and sends nothing", async () => {
    await setMute(ben, id(olu), true);
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body: "Are you free?" });
    expect(confirmOf(r.proposals)).toBeUndefined();
    expect(r.out).toMatchObject({ error: "Ben isn't taking messages from your assistant right now." });
    // The log owners and HR read never carries those words (it would reveal the mute).
    const logged = await adminQuery<{ summary: string }>("SELECT summary FROM brenda_actions WHERE membership_id = $1 AND tool = 'pass_message' AND outcome IN ('refused', 'failed')", [id(olu)]);
    for (const row of logged) expect(row.summary).not.toContain("isn't taking");
    await setMute(ben, id(olu), false);
  });
});

describe("@Ben's Brenda in a thread", () => {
  it("accepts the label with a curly apostrophe, as the composer sends it", async () => {
    const sent = await send(david, "@Ben’s Brenda how is the pricing page going?", [BENS("@Ben’s Brenda")]);
    expect(sent.mentionId).toBeTruthy();
    expect((await mentionRow(sent.mentionId!)).owner_membership_id).toBe(id(ben));
    await adminQuery("UPDATE assistant_mentions SET status = 'failed' WHERE id = $1", [sent.mentionId]);
  });

  it("“tell him …” is passed on in one line, and Ben is told", async () => {
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days'`);
    const sent = await send(david, "@Ben's Brenda tell him the client called about the deck", [BENS()]);
    expect(await processMention(sent.mentionId!, { useModel: false })).toBe("answered");
    const r = await mentionRow(sent.mentionId!);
    const [reply] = await adminQuery<{ body: string; sender_membership_id: string; author_kind: string }>("SELECT body, sender_membership_id, author_kind FROM messages WHERE id = $1", [r.reply_message_id]);
    expect(reply).toEqual({ body: "I'll make sure Ben sees this.", sender_membership_id: id(ben), author_kind: "assistant" });
    expect((await notes(ben, "assistant.tagged")).at(-1)).toMatchObject({ body: "“@Ben's Brenda tell him the client called about the deck”" });
  });

  it("the holding line carries who asked and is marked as the holding line for every reader", async () => {
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days'`);
    await saveFollowUpPreference(ben, "ask_first");
    const sent = await send(david, "@Ben's Brenda what are you working on?", [BENS()]);
    expect(await processMention(sent.mentionId!, { useModel: false })).toBe("asked");
    const holdingId = (await mentionRow(sent.mentionId!)).holding_message_id as string;
    for (const c of [olu, david, ben]) {
      const t = (await thread(c, design))!;
      const m = t.messages.find((x) => x.id === holdingId)!;
      expect(m.mention_reply).toMatchObject({ mentionId: sent.mentionId, holding: true, askedBy: { firstName: "David", isYou: c === david } });
      expect((m as unknown as { mentions: unknown[] }).mentions).toEqual([]);
      // The composer offers the other readers' assistants, never the viewer's own.
      expect(t.taggable.map((x) => x.membershipId)).not.toContain(id(c));
    }
    await saveFollowUpPreference(ben, "auto");
  });
});
