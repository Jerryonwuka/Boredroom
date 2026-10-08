/**
 * Assistants talk to each other: messages and replies (owner decision, 8 October 2026: personal assistants, phase 6).
 * "Tell Ben's assistant the client moved the deadline to Friday": her chat prepares a Confirm with the exact words, the
 * Confirm press makes the item, Ben's assistant delivers it (his inbox, the bell, the notch), Ben marks it seen and may
 * reply once in one line, and Olu's assistant shows "Ben has seen it". The limits, mutes, row-level security and the
 * database's guard on what was sent.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No test calls the model: the key from
 * .env.local is dropped.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (her assistant is Max),
 * Ben Okafor (kept Brenda).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { runBrendaTool, confirmAction, type Proposal, type Action } from "@/server/services/copilot";
import {
  assistantItemsForDesktop, getAssistantItem, listAssistantItems, listMutes, markItemSeen, planMessage, replyToItem, sendAssistantItem, setMute, waitingItems,
  type DesktopAssistantItems,
} from "@/server/services/assistant-items";
import { desktopState } from "@/server/services/desktop";
import { withWorker } from "@/server/db";
import { ASSISTANT_ITEM_LIMITS, ASSISTANT_ITEM_WORDS as W } from "@/lib/assistant-items";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let ada: OrgContext, mary: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext;
const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const itemIdOf = (x: Action | undefined) => (x as (Action & { assistantItemId?: string }) | undefined)?.assistantItemId ?? "";
const notes = (c: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null; read_at: string | null }>(
    "SELECT title, body, href, resource_id, read_at FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [id(c), type]);
const message = (from: OrgContext, to: OrgContext, body: string) => sendAssistantItem(from, { kind: "message", recipientMembershipId: id(to), body });
/** Items made today by admin (bypassing the services), to reach a day's limits without sending each one. */
async function seed(from: string, to: string, kind: "message" | "request", n: number) {
  for (let i = 0; i < n; i++) {
    await adminQuery(
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body, request_kind, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [org(), kind, from, to, kind === "message" ? `Seeded ${i}` : null, kind === "request" ? "add_todo" : null,
       JSON.stringify(kind === "request" ? { v: 1, kind: "add_todo", title: `Seeded ${i}`, dueAt: null } : {}), kind === "request" ? new Date(Date.now() + 3 * 86_400_000).toISOString() : null]);
  }
}
/** Rows written just after a call returns (her activity line is not awaited by the Confirm). */
async function eventually<T>(read: () => Promise<T[]>, tries = 20): Promise<T[]> {
  for (let i = 0; i < tries; i++) { const r = await read(); if (r.length) return r; await new Promise((ok) => setTimeout(ok, 50)); }
  return read();
}
async function extraMember(name: string, email: string): Promise<OrgContext> {
  const { createVerifiedUser, joinViaInvitation } = await import("@/server/services/fixtures");
  const u = await createVerifiedUser(email, name);
  return joinViaInvitation(a.hrCtx, u, "employee", a.teamId);
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  ada = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
});

describe("pass_message through her chat", () => {
  let itemId = "";

  it("prepares a Confirm with the exact words, in a tainted turn too, and sends nothing yet", async () => {
    const body = "The client moved the deadline to Friday.";
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body });
    const c = confirmOf(r.proposals);
    expect(c).toMatchObject({ tool: "pass_message", summary: "Pass this to Ben's Brenda? Ben gets it as your message." });
    expect(c?.detail).toBe(body);
    expect(r.actions).toEqual([]);
    const tainted = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body }, "chat", { tainted: true });
    expect(confirmOf(tainted.proposals)?.summary).toBe("Pass this to Ben's Brenda? Ben gets it as your message.");
    expect(await adminQuery("SELECT 1 FROM assistant_items WHERE sender_membership_id = $1", [id(olu)])).toEqual([]);
  });

  it("the Confirm press makes the item, notifies Ben and logs it in Olu's activity", async () => {
    const r = await runBrendaTool(olu, "pass_message", { to: "Ben Okafor", body: "The client moved the deadline to Friday." });
    const done = await confirmAction(olu, confirmOf(r.proposals)!.token);
    expect(done.error).toBeNull();
    itemId = itemIdOf(done.actions[0]);
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(done.actions[0]).toMatchObject({ kind: "assistant_message", summary: "Passed your message to Ben's Brenda", href: `/app/company-a/home/assistants/items/${itemId}` });
    const [row] = await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_items WHERE id = $1", [itemId]);
    expect(row).toMatchObject({ kind: "message", status: "delivered", sender_membership_id: id(olu), recipient_membership_id: id(ben), body: "The client moved the deadline to Friday.", tidied: false });
    expect(await notes(ben, "assistant.message")).toEqual([expect.objectContaining({
      title: "Olu's Max passed on a message", body: "“The client moved the deadline to Friday.”", resource_id: itemId, href: `/app/company-a/home/assistants/items/${itemId}`,
    })]);
    // Her activity line (written right after the press, not awaited by it): owners and HR read that she passed a message
    // on, she reads to whom.
    const logged = await eventually(() => adminQuery<{ summary: string; detail: Record<string, unknown> }>("SELECT summary, detail FROM brenda_actions WHERE membership_id = $1 AND tool = 'pass_message'", [id(olu)]));
    expect(logged).toEqual([expect.objectContaining({ summary: "Passed a message to a colleague's assistant", detail: expect.objectContaining({ personalSummary: "Passed a message to Ben's Brenda" }) })]);
    // Audit rows hold ids and codes, never words.
    const audits = await adminQuery<{ metadata: unknown }>("SELECT metadata FROM audit_events WHERE subject_id = $1", [itemId]);
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain("deadline");
  });

  it("the notch shows Ben a message card, opened by the notification's resource id", async () => {
    const state = await desktopState(ben);
    const items = (state as unknown as { assistantItems: DesktopAssistantItems }).assistantItems;
    expect(items.ready).toBe(true);
    expect(items.waiting).toEqual([expect.objectContaining({
      id: itemId, kind: "message", title: "Olu's Max passed on a message", body: "The client moved the deadline to Friday.", canReply: true, tidied: false,
      sender: expect.objectContaining({ name: "Olu Adeyemi", assistant: expect.objectContaining({ name: "Max", colour: "blue" }) }),
    })]);
    expect(state.notifications.find((n) => n.type === "assistant.message")?.resource_id).toBe(itemId);
    expect((await assistantItemsForDesktop(olu)).waiting).toEqual([]);
  });

  it("Ben sees it waiting; Olu sees Delivered, then Seen once Ben opens it", async () => {
    const forBen = await getAssistantItem(ben, itemId);
    expect(forBen).toMatchObject({ viewer: "recipient", status: "delivered", badge: { label: "New", tone: "warning" }, canSeen: true, canReply: true, canAccept: false, canMute: true });
    expect(forBen!.sender).toMatchObject({ firstName: "Olu", assistant: { name: "Max" } });
    expect((await waitingItems(ben)).map((v) => v.id)).toContain(itemId);
    expect(await getAssistantItem(olu, itemId)).toMatchObject({ viewer: "sender", badge: { label: "Delivered", tone: "neutral" }, canSeen: false, canReply: false });
    const seen = await markItemSeen(ben, itemId);
    expect(seen).toMatchObject({ status: "seen", canSeen: false, canReply: true });
    expect(seen.seenAt).toBeTruthy();
    expect(await getAssistantItem(olu, itemId)).toMatchObject({ status: "seen", badge: { label: "Seen", tone: "success" } });
    expect((await waitingItems(ben)).map((v) => v.id)).not.toContain(itemId);
    expect((await notes(ben, "assistant.message"))[0].read_at).toBeTruthy();
    // Seen twice is fine; Olu cannot mark her own as seen.
    await expect(markItemSeen(ben, itemId)).resolves.toMatchObject({ status: "seen" });
    await expect(markItemSeen(olu, itemId)).rejects.toMatchObject({ status: 404 });
  });

  it("Ben replies once in one line; Olu is told; a second reply is refused", async () => {
    const v = await replyToItem(ben, itemId, "Thanks,\nnoted.");
    expect(v.reply).toMatchObject({ body: "Thanks, noted." });
    expect(v.badge).toEqual({ label: "Replied", tone: "success" });
    await expect(replyToItem(ben, itemId, "Again")).rejects.toMatchObject({ status: 409, code: "ALREADY_REPLIED" });
    await expect(replyToItem(olu, itemId, "Me too")).rejects.toMatchObject({ status: 404 });
    await expect(replyToItem(ben, itemId, "x".repeat(281))).rejects.toMatchObject({ status: 422 });
    const told = await notes(olu, "assistant.reply");
    expect(told).toEqual([expect.objectContaining({ title: "Ben replied to your message", body: "“Thanks, noted.”" })]);
    const reply = await getAssistantItem(olu, told[0].resource_id!);
    expect(reply).toMatchObject({ kind: "reply", viewer: "recipient", replyTo: { id: itemId, body: "The client moved the deadline to Friday." } });
    expect((await getAssistantItem(olu, itemId))!.reply?.body).toBe("Thanks, noted.");
    // Lists: Olu's Sent, Ben's Received.
    expect((await listAssistantItems(olu, { box: "sent" })).items.map((x) => x.id)).toContain(itemId);
    expect((await listAssistantItems(ben, { box: "received" })).items.map((x) => x.id)).toContain(itemId);
  });
});

describe("who may send", () => {
  it("refuses yourself and a former member, in words", async () => {
    expect(await planMessage(olu, { to: "Olu Adeyemi", body: "Hi" })).toEqual({ ok: false, code: "self", error: W.refusals.self() });
    const gone = await extraMember("Gina Gone", "gina@company-a.test");
    await adminQuery("UPDATE memberships SET status = 'revoked', revoked_at = now() WHERE id = $1", [id(gone)]);
    expect(await planMessage(olu, { to: id(gone), body: "Hi" })).toMatchObject({ ok: false, code: "not_member", error: "Gina Gone isn't an active member of this workspace." });
    expect(await planMessage(olu, { to: "Nobody Here", body: "Hi" })).toMatchObject({ ok: false, code: "not_member" });
  });

  it("stops at five messages a day to the same person", async () => {
    for (let i = 0; i < ASSISTANT_ITEM_LIMITS.messagesPerPairPerDay; i++) await message(olu, david, `Note ${i + 1}`);
    const plan = await planMessage(olu, { to: "David Manager", body: "One more" });
    expect(plan).toEqual({ ok: false, code: "limit_pair", error: "You've passed on 5 messages to David today. Message David directly, or try again tomorrow." });
    await expect(message(olu, david, "One more")).rejects.toMatchObject({ status: 409, code: "ASSISTANT_ITEM_LIMIT" });
  });

  it("stops at twenty incoming a day for one person, from everyone", async () => {
    const target = await extraMember("Tess Target", "tess@company-a.test");
    const senders = [id(ada), id(mary), id(david), id(ben)];
    for (let i = 0; i < ASSISTANT_ITEM_LIMITS.incomingPerRecipientPerDay; i++) await seed(senders[i % 4], id(target), "message", 1);
    expect(await planMessage(olu, { to: "Tess Target", body: "Hello" })).toEqual({ ok: false, code: "limit_recipient", error: "Tess has had a lot from other people's assistants today. Message Tess directly instead." });
  });

  it("stops at forty sent a day, to everyone", async () => {
    const people: OrgContext[] = [];
    for (let i = 0; i < 9; i++) people.push(await extraMember(`Pat Person${i}`, `pat${i}@company-a.test`));
    for (const p of people) await seed(id(mary), id(p), "message", 4);   // Mary: 36 today
    await seed(id(mary), id(ada), "request", 3);                          // 39
    await seed(id(mary), id(david), "message", 1);                        // 40
    expect(await planMessage(mary, { to: "Ben Okafor", body: "Hello" })).toEqual({ ok: false, code: "limit_sender", error: "You've sent 40 messages and requests through other people's assistants today. Try again tomorrow." });
  });

  it("a mute stops new items from that sender, never a reply to the person's own message; unmuting allows them again", async () => {
    const mine = await message(ben, olu, "Can you send me the brief?");
    await expect(setMute(ben, id(olu), true)).resolves.toEqual({ muted: true });
    expect((await listMutes(ben)).mutes).toEqual([expect.objectContaining({ membershipId: id(olu), name: "Olu Adeyemi", assistant: expect.objectContaining({ name: "Max" }) })]);
    expect(await planMessage(olu, { to: "Ben Okafor", body: "Another thing" })).toEqual({ ok: false, code: "muted", error: "Ben isn't taking messages from your assistant right now." });
    await expect(message(olu, ben, "Another thing")).rejects.toMatchObject({ status: 403, code: "MUTED" });
    await expect(replyToItem(olu, mine.id, "Sent it just now.")).resolves.toMatchObject({ reply: { body: "Sent it just now." } });
    expect((await getAssistantItem(ben, mine.id))!.reply?.body).toBe("Sent it just now.");
    // Olu cannot read Ben's mutes.
    expect(await appQueryAs(olu.user.profileId, "SELECT * FROM assistant_item_mutes")).toEqual([]);
    await setMute(ben, id(olu), false);
    expect((await listMutes(ben)).mutes).toEqual([]);
    expect(await planMessage(olu, { to: "Ben Okafor", body: "Another thing" })).toMatchObject({ ok: true });
    // While someone else is signed in as Ben, his mutes stay as they are.
    const asAdmin = { ...ben, user: { ...ben.user, impersonation: { id: "imp", adminEmail: "admin@boredroom.test" } } } as OrgContext;
    await expect(setMute(asAdmin, id(olu), true)).rejects.toMatchObject({ status: 403 });
  });
});

describe("row-level security and the guard", () => {
  let itemId = "";
  beforeAll(async () => {
    itemId = (await message(ben, olu, "Private between us.")).id;
  });

  it("only the two people read it: not the owner, HR, their team lead or another workspace", async () => {
    for (const c of [ada, mary, david]) {
      expect(await appQueryAs(c.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [itemId])).toEqual([]);
      expect(await getAssistantItem(c, itemId)).toBeNull();
    }
    expect(await appQueryAs(olu.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [itemId])).toHaveLength(1);
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM assistant_items WHERE id = $1", [itemId])).toHaveLength(1);
  });

  it("nobody updates or deletes it as the app; a forged insert is refused", async () => {
    expect(await appQueryAs(ben.user.profileId, "UPDATE assistant_items SET status = 'seen' WHERE id = $1 RETURNING id", [itemId])).toEqual([]);
    expect(await appQueryAs(olu.user.profileId, "UPDATE assistant_items SET status = 'seen' WHERE id = $1 RETURNING id", [itemId])).toEqual([]);
    await expect(appQueryAs(ben.user.profileId, "DELETE FROM assistant_items WHERE id = $1", [itemId])).rejects.toThrow(/permission denied/);
    // As Olu, pretending Ben sent it; as Olu, a row already seen.
    await expect(appQueryAs(olu.user.profileId,
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body) VALUES ($1, 'message', $2, $3, 'Forged')`, [org(), id(ben), id(olu)]))
      .rejects.toThrow(/row-level security/);
    await expect(appQueryAs(olu.user.profileId,
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body, status, seen_at) VALUES ($1, 'message', $2, $3, 'Forged', 'seen', now())`, [org(), id(olu), id(ben)]))
      .rejects.toThrow(/row-level security/);
    // A reply to a message that was not sent to the replier.
    await expect(appQueryAs(david.user.profileId,
      `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, parent_id, body) VALUES ($1, 'reply', $2, $3, $4, 'Forged')`, [org(), id(david), id(ben), itemId]))
      .rejects.toThrow(/row-level security/);
  });

  it("what was sent never changes, even for Boredroom's worker; the status only moves forward", async () => {
    await expect(withWorker((db) => db.query("UPDATE assistant_items SET body = 'Changed' WHERE id = $1", [itemId]))).rejects.toThrow(/ASSISTANT_ITEM_FIXED/);
    await expect(withWorker((db) => db.query(`UPDATE assistant_items SET payload = '{"x":1}'::jsonb WHERE id = $1`, [itemId]))).rejects.toThrow(/ASSISTANT_ITEM_FIXED/);
    await markItemSeen(olu, itemId);
    await expect(withWorker((db) => db.query("UPDATE assistant_items SET status = 'delivered' WHERE id = $1", [itemId]))).rejects.toThrow(/ASSISTANT_ITEM_TRANSITION/);
    expect((await adminQuery<{ body: string; status: string }>("SELECT body, status FROM assistant_items WHERE id = $1", [itemId]))[0]).toEqual({ body: "Private between us.", status: "seen" });
  });
});
