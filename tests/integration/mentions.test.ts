/**
 * @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5; migration 0041). "@Max …" in a
 * conversation makes the person's OWN assistant reply in the thread; "@Ben" highlights Ben and notifies him. These run
 * against the local test database only and never call the model: nothing here starts the processor (every send passes
 * `startMention: false`) and the answers are written straight through the queue's transitions.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben; Mary joins the team too, as HR), Olu
 * Adeyemi (her assistant is Max), Ben Okafor (kept Brenda). #design is the Design team channel, Everyone the
 * organisation's, #launch a named channel Olu made with Ben, and Olu and Ben have a direct thread. Company B is the
 * other tenant.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The fallback before 0041: the readiness check can be switched off for one test (the schema stays as it is).
const flags = vi.hoisted(() => ({ off: false }));
vi.mock("@/server/lib/schema-0041", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/lib/schema-0041")>();
  return { ...real, schema0041Ready: async (db: Parameters<typeof real.schema0041Ready>[0]) => (flags.off ? false : real.schema0041Ready(db)) };
});

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { setTeamMember } from "@/server/services/orgs";
import { createProject, createTask, quickTodo } from "@/server/services/tasks";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import {
  createChannel, deleteConversation, editMessage, openChannel, openDirect, sendMessage, sendVoiceMessage, setConversationPrefs, thread, updateChannel, withdrawMessage,
  type SendInput,
} from "@/server/services/messaging";
import {
  claimMention, completeMentionPrivate, completeMentionPublic, decideMentionProposal, dismissMention, failMention, getMention, mentionSettings, nextPendingMention,
  postMention, refuseMention, releaseMention, renewMentionLease, saveMentionSettings, setConversationAssistantReplies, settleMentionConfirms, staleMentions,
  visibleToReaders, withdrawMentionReply, type ConfirmProposal,
} from "@/server/services/mentions";
import { readMentionThread } from "@/server/services/catch-up";
import { withUser, withWorker } from "@/server/db";
import { schema0041Ready } from "@/server/lib/schema-0041";
import { signPayload } from "@/server/lib/crypto";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let b: CompanyFixture;
let ada: OrgContext, mary: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext;
let design: string, everyone: string, launch: string, oluBen: string;

const org = () => a.ownerCtx.org.id;
const id = (c: OrgContext) => c.membership.id;
const MAX = { kind: "assistant" as const, label: "@Max" };
const person = (c: OrgContext) => ({ kind: "person" as const, membershipId: id(c), label: `@${c.user.displayName}` });
const send = (c: OrgContext, conversationId: string, body: string, mentions?: SendInput["mentions"], extra: Partial<SendInput> = {}) =>
  sendMessage(c, { conversationId, body, mentions, ...extra }, { startMention: false });
async function tag(c: OrgContext, conv: string, words = "what's left on the landing page?", label = "@Max") {
  const r = await send(c, conv, `${label} ${words}`, [{ kind: "assistant", label }]);
  expect(r.mentionId).toBeTruthy();
  return { messageId: r.id, mentionId: r.mentionId! };
}
const row = async (mid: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_mentions WHERE id = $1", [mid]))[0];
const priv = async (mid: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_mention_private WHERE mention_id = $1", [mid]))[0];
const notes = (c: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null; deduplication_key: string; read_at: string | null }>(
    "SELECT title, body, href, resource_id, deduplication_key, read_at FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [id(c), type]);
const messagesIn = async (conv: string) => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1", [conv]))[0].n;
const rejects = async (p: Promise<unknown>) => { await expect(p).rejects.toBeTruthy(); };
/** Claims and answers privately (no model). */
async function answerPrivately(mid: string, text: string | null, proposals: ConfirmProposal[] = []) {
  expect(await claimMention(mid)).not.toBeNull();
  return completeMentionPrivate(mid, { text, noteCode: null, proposals, engine: "builtin" });
}
async function answerPublicly(mid: string, text: string, fullText: string | null = null) {
  expect(await claimMention(mid)).not.toBeNull();
  return completeMentionPublic(mid, { text, fullText, noteCode: null, engine: "builtin" });
}
/** A Confirm token for Olu, as the assistant prepares them (signed, bound to her). */
const confirmFor = (c: OrgContext, tool: string, input: Record<string, unknown>, summary: string): ConfirmProposal =>
  ({ kind: "confirm", token: signPayload({ k: "brenda", o: c.org.id, m: c.membership.id, tool, input }, 3600), summary, tool });
/**
 * Seeds `n` mentions already handled (started_at set) by `tagger` in `conv`, `ago` back, through the admin connection,
 * for the limits.
 */
async function seedHandled(tagger: OrgContext, conv: string, n: number, ago: string) {
  await adminQuery(
    `WITH m AS (INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body) SELECT $1, $2, $3, 'seed ' || g FROM generate_series(1, $4) g RETURNING id)
     INSERT INTO assistant_mentions(organisation_id, conversation_id, message_id, tagger_membership_id, status, started_at, finished_at)
     SELECT $1, $2, m.id, $3, 'answered', now() - $5::interval, now() - $5::interval FROM m`, [org(), conv, id(tagger), n, ago]);
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  b = await buildCompany("b");
  ada = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  // Mary is HR and on the Design team too (not its lead), so she reads #design.
  await setTeamMember(ada, a.teamId, id(mary), { isManager: false });
  design = await openChannel(olu, a.teamId);
  everyone = await openChannel(olu, null);
  launch = (await createChannel(olu, { title: "launch", memberIds: [id(ben)] })).id;
  oluBen = await openDirect(olu, id(ben));
});

// Every test starts with nothing in flight and nothing counted against today's limits (the limits count started_at).
beforeEach(async () => {
  flags.off = false;
  await adminQuery(`UPDATE assistant_mentions SET status = 'failed', lease_until = NULL WHERE status IN ('pending', 'thinking')`);
  await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
});

// ---- 0. The migration -----------------------------------------------------------------------------------------------------

describe("migration 0041", () => {
  it("applies twice more cleanly, is ready, and the ledger takes the mention purpose", async () => {
    const sql = readFileSync(join(process.cwd(), "db/migrations/0041_assistant_mentions.sql"), "utf8");
    await adminQuery(sql);
    await adminQuery(sql);
    expect(await withUser(olu.user.profileId, (db) => schema0041Ready(db))).toBe(true);
    await withWorker((db) => db.query("INSERT INTO ai_usage(organisation_id, membership_id, purpose, model) VALUES ($1, $2, 'mention', 'claude-test')", [org(), id(olu)]));
    expect(await adminQuery("SELECT 1 FROM ai_usage WHERE organisation_id = $1 AND purpose = 'mention'", [org()])).toHaveLength(1);
    // Both switches on by default.
    expect(await withUser(ben.user.profileId, (db) => mentionSettings(db, org()))).toEqual({ ready: true, enabled: true });
    expect((await thread(olu, design))!.assistantReplies).toEqual({ ready: true, workspaceOn: true, here: true, canChange: false });
    expect((await thread(david, design))!.assistantReplies.canChange).toBe(true);
  });
});

// ---- 1. Storage and validation ---------------------------------------------------------------------------------------------

describe("mentions on a message", () => {
  it("stores only the valid tokens, as the body spells them, and the thread carries them", async () => {
    const body = "@max can you check with @ben okafor and @Ada Owner, or @Brenda?";
    const r = await send(olu, design, body, [
      MAX,
      { kind: "assistant", label: "@Brenda" },                                  // someone else's assistant
      { kind: "person", membershipId: id(ben), label: "@Ben Okafor" },
      { kind: "person", membershipId: id(ada), label: "@Ada Owner" },           // not in #design
      { kind: "person", membershipId: id(olu), label: "@Olu Adeyemi" },         // herself
      { kind: "person", membershipId: id(david), label: "@David Manager" },     // not in the body
      { kind: "person", membershipId: id(b.employee2Ctx), label: "@Ben Employee" }, // another workspace
    ]);
    expect(r.mentioned).toEqual([id(ben)]);
    expect(r.mentionId).toBeTruthy();
    const stored = await adminQuery<{ kind: string; membership_id: string; label: string }>("SELECT kind, membership_id, label FROM message_mentions WHERE message_id = $1 ORDER BY kind", [r.id]);
    expect(stored).toEqual([{ kind: "assistant", membership_id: id(olu), label: "@max" }, { kind: "person", membership_id: id(ben), label: "@ben okafor" }]);
    expect(await row(r.mentionId!)).toMatchObject({ status: "pending", tagger_membership_id: id(olu), conversation_id: design, message_id: r.id, attempts: 0, started_at: null });
    const m = (await thread(ben, design))!.messages.find((x) => x.id === r.id)!;
    expect(m.mentions).toEqual(expect.arrayContaining([{ kind: "assistant", membershipId: id(olu), label: "@max" }, { kind: "person", membershipId: id(ben), label: "@ben okafor" }]));
    expect(m.mentions).toHaveLength(2);
    expect(m.mention_reply).toBeNull();
    // A plain message carries none; a typed "@Max" without a token is plain text.
    const plain = await send(olu, design, "@Max is a name I like");
    expect(plain).toMatchObject({ mentionId: null, mentioned: [] });
    expect((await thread(olu, design))!.messages.find((x) => x.id === plain.id)!.mentions).toEqual([]);
  });

  it("refuses by row-level security a mention on an old, edited or someone else's message, or of a non-reader; nobody changes one", async () => {
    const fresh = await send(olu, design, "Fresh one for @Ben Okafor");
    const ins = (c: OrgContext, messageId: string, kind: string, member: string, label: string, conv = design) => appQueryAs(c.user.profileId,
      "INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, $4, $5, $6)", [messageId, conv, org(), kind, member, label]);
    // A non-reader of #design, someone else's assistant, and as someone else: refused.
    await rejects(ins(olu, fresh.id, "person", id(ada), "@Ada Owner"));
    await rejects(ins(olu, fresh.id, "assistant", id(ben), "@Brenda"));
    await rejects(ins(ben, fresh.id, "person", id(david), "@David Manager"));
    // Her own fresh message and a reader: allowed (the control).
    await ins(olu, fresh.id, "person", id(ben), "@Ben Okafor");
    // Edited, or more than a minute old: refused.
    const edited = await send(olu, design, "will edit");
    await editMessage(olu, edited.id, "edited @Ben Okafor");
    await rejects(ins(olu, edited.id, "person", id(ben), "@Ben Okafor"));
    const old = await send(olu, design, "old @Ben Okafor");
    await adminQuery("UPDATE messages SET created_at = created_at - interval '2 minutes' WHERE id = $1", [old.id]);
    await rejects(ins(olu, old.id, "person", id(ben), "@Ben Okafor"));
    // Nobody updates or deletes them.
    await rejects(appQueryAs(olu.user.profileId, "UPDATE message_mentions SET label = '@Someone' WHERE message_id = $1", [fresh.id]));
    await rejects(appQueryAs(olu.user.profileId, "DELETE FROM message_mentions WHERE message_id = $1", [fresh.id]));
    expect(await adminQuery("SELECT label FROM message_mentions WHERE message_id = $1", [fresh.id])).toEqual([{ label: "@Ben Okafor" }]);
    // Only readers of the conversation read them.
    expect(await appQueryAs(ada.user.profileId, "SELECT * FROM message_mentions WHERE conversation_id = $1", [design])).toEqual([]);
    expect((await appQueryAs(ben.user.profileId, "SELECT * FROM message_mentions WHERE message_id = $1", [fresh.id])).length).toBe(1);
  });
});

// ---- 2. People's notifications ----------------------------------------------------------------------------------------------

describe("mentioning people", () => {
  it("notifies Ben with the snippet and a link, even in a channel he muted; never the sender; never a non-reader", async () => {
    await setConversationPrefs(ben, design, { muted: true });
    const r = await send(olu, design, "@Ben Okafor can you check the hero image before 3?", [person(ben), person(olu)]);
    expect(r.mentioned).toEqual([id(ben)]);
    const n = (await notes(ben, "message.mention")).find((x) => x.deduplication_key === `mention:${r.id}:${id(ben)}`)!;
    expect(n).toMatchObject({ title: "Olu Adeyemi mentioned you in #Design", body: "@Ben Okafor can you check the hero image before 3?", href: `/app/company-a/messages?c=${design}#m-${r.id}`, resource_id: design });
    expect(await notes(olu, "message.mention")).toEqual([]);
    await setConversationPrefs(ben, design, { muted: false });
    // David is not in #launch: not stored, not notified.
    const l = await send(olu, launch, "@David Manager are you around?", [person(david)]);
    expect(l.mentioned).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [l.id])).toEqual([]);
    expect(await notes(david, "message.mention")).toEqual([]);
    // A long message is clamped to 120 characters.
    const long = await send(olu, everyone, `@Ben Okafor ${"word ".repeat(40)}`, [person(ben)]);
    const ln = (await notes(ben, "message.mention")).find((x) => x.deduplication_key === `mention:${long.id}:${id(ben)}`)!;
    expect(ln.title).toBe("Olu Adeyemi mentioned you in Everyone");
    expect(ln.body!.length).toBeLessThanOrEqual(120);
    expect(ln.body!.endsWith("…")).toBe(true);
  });

  it("in a direct thread: the usual notification when Ben listens, the mention only when he muted it", async () => {
    const one = await send(olu, oluBen, "@Ben Okafor lunch?", [person(ben)]);
    expect(one.mentioned).toEqual([id(ben)]);
    expect((await notes(ben, "message.direct")).some((n) => n.deduplication_key === `message:${one.id}`)).toBe(true);
    expect((await notes(ben, "message.mention")).some((n) => n.deduplication_key === `mention:${one.id}:${id(ben)}`)).toBe(false);
    await setConversationPrefs(ben, oluBen, { muted: true });
    const two = await send(olu, oluBen, "@Ben Okafor lunch now?", [person(ben)]);
    expect((await notes(ben, "message.direct")).some((n) => n.deduplication_key === `message:${two.id}`)).toBe(false);
    expect((await notes(ben, "message.mention")).find((n) => n.deduplication_key === `mention:${two.id}:${id(ben)}`)).toMatchObject({ title: "Olu Adeyemi mentioned you in your chat" });
    await setConversationPrefs(ben, oluBen, { muted: false });
  });

  it("an edit that adds a mention stores nothing and notifies nobody", async () => {
    const before = (await notes(ben, "message.mention")).length;
    const m = await send(olu, design, "Morning all");
    await editMessage(olu, m.id, "Morning all, @Ben Okafor and @Max");
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [m.id])).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM assistant_mentions WHERE message_id = $1", [m.id])).toEqual([]);
    expect((await notes(ben, "message.mention")).length).toBe(before);
  });

  it("opening the conversation reads its mention notifications", async () => {
    // Olu's earlier mentions of Ben here are an hour old (the notification throttle counts the last hour).
    await adminQuery("UPDATE message_mentions SET created_at = created_at - interval '2 hours' WHERE conversation_id = $1 AND kind = 'person'", [design]);
    const r = await send(olu, design, "@Ben Okafor see this", [person(ben)]);
    expect((await notes(ben, "message.mention")).find((n) => n.deduplication_key === `mention:${r.id}:${id(ben)}`)!.read_at).toBeNull();
    await thread(ben, design);
    expect((await notes(ben, "message.mention")).find((n) => n.deduplication_key === `mention:${r.id}:${id(ben)}`)!.read_at).not.toBeNull();
  });
});

// ---- 3. The queue ----------------------------------------------------------------------------------------------------------------

describe("the queue", () => {
  it("is one 'pending' row per tagging message, inserted only as the tagger for a fresh text message of theirs", async () => {
    const t = await tag(olu, design);
    expect(await adminQuery("SELECT status FROM assistant_mentions WHERE message_id = $1", [t.messageId])).toEqual([{ status: "pending" }]);
    const insert = (c: OrgContext, messageId: string, tagger: string, extra = "") => appQueryAs(c.user.profileId,
      `INSERT INTO assistant_mentions(organisation_id, conversation_id, message_id, tagger_membership_id${extra ? ", status" : ""}) VALUES ($1, $2, $3, $4${extra ? `, '${extra}'` : ""})`,
      [org(), design, messageId, tagger]);
    // A second row for the same message.
    await rejects(insert(olu, t.messageId, id(olu)));
    // A fresh message with her own assistant's mention, inserted by hand: any status but 'pending' refused, 'pending' allowed.
    const fresh = await send(olu, design, "@Max hello");
    await appQueryAs(olu.user.profileId, "INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, 'assistant', $4, '@Max')", [fresh.id, design, org(), id(olu)]);
    await rejects(insert(olu, fresh.id, id(olu), "thinking"));
    await rejects(insert(olu, fresh.id, id(olu), "answered"));
    await insert(olu, fresh.id, id(olu));
    // Someone else's message, as them or as the sender.
    const bens = await send(ben, design, "@Brenda hi", [{ kind: "assistant", label: "@Brenda" }]);
    await rejects(insert(olu, bens.id, id(olu)));
    await rejects(insert(olu, bens.id, id(ben)));
    // An edited message, and a voice note.
    const edited = await send(olu, design, "@Max soon");
    await editMessage(olu, edited.id, "@Max later");
    await rejects(insert(olu, edited.id, id(olu)));
    const voice = await sendVoiceMessage(olu, { conversationId: design, type: "audio/webm", bytes: Buffer.from([1, 2, 3, 4]), seconds: 3 });
    await rejects(insert(olu, voice.id, id(olu)));
    // Only the worker changes a row: a person's update matches nothing, and nobody deletes one.
    const changed = await appQueryAs(olu.user.profileId, "UPDATE assistant_mentions SET status = 'answered' WHERE id = $1 RETURNING id", [t.mentionId]);
    expect(changed).toEqual([]);
    await rejects(appQueryAs(olu.user.profileId, "DELETE FROM assistant_mentions WHERE id = $1", [t.mentionId]));
    expect((await row(t.mentionId)).status).toBe("pending");
    // Readers of the conversation read the status; others do not.
    expect((await appQueryAs(ben.user.profileId, "SELECT status FROM assistant_mentions WHERE id = $1", [t.mentionId]))).toEqual([{ status: "pending" }]);
    expect(await appQueryAs(ada.user.profileId, "SELECT status FROM assistant_mentions WHERE id = $1", [t.mentionId])).toEqual([]);
  });

  it("never comes from a message her assistant sent for her", async () => {
    const via = await sendMessage(olu, { conversationId: design, body: "@Max via me", mentions: [MAX] }, { via: "assistant", startMention: false });
    expect(via).toMatchObject({ authorKind: "via_assistant", mentionId: null, mentioned: [] });
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [via.id])).toEqual([]);
  });
});

// ---- 4. What only the tagger sees ------------------------------------------------------------------------------------------

describe("the private part", () => {
  it("is Olu's alone: Ben and David read no row, the thread shows them only the status, Olu the text and the cards without tokens", async () => {
    const t = await tag(olu, launch, "remind me at 3 to call Ben");
    const p = confirmFor(olu, "remind_me", { body: "Call Ben", at: new Date(Date.now() + 3 * 3600_000).toISOString() }, "Remind you at 15:00: Call Ben");
    expect(await answerPrivately(t.mentionId, "I can set that reminder when you confirm.", [p])).toBe("waiting_confirm");
    for (const c of [ben, david, ada]) expect(await appQueryAs(c.user.profileId, "SELECT * FROM assistant_mention_private")).toEqual([]);
    const forBen = (await thread(ben, launch))!.mentions.find((m) => m.id === t.mentionId)!;
    expect(forBen).toMatchObject({ status: "waiting_confirm", waiting: true, thinking: false, private: null, tagger: { name: "Olu Adeyemi", firstName: "Olu", isYou: false }, assistant: { name: "Max" } });
    const forOlu = (await thread(olu, launch))!.mentions.find((m) => m.id === t.mentionId)!;
    expect(forOlu.private).toMatchObject({
      kind: "answer", text: "I can set that reminder when you confirm.", note: null, canPost: true,
      proposals: [{ index: 0, tool: "remind_me", summary: "Remind you at 15:00: Call Ben", detail: null, state: "open", result: null }],
    });
    expect(JSON.stringify(forOlu)).not.toContain(p.token);
    expect(JSON.stringify(await getMention(olu, t.mentionId))).not.toContain(p.token);
    expect(await getMention(david, t.mentionId)).toBeNull();
    expect((await getMention(ben, t.mentionId))!.private).toBeNull();
    // Her notification says Max needs her.
    expect((await notes(olu, "brenda.mention_confirm")).find((n) => n.deduplication_key === `mention.confirm:${t.mentionId}`)).toMatchObject({
      title: "Max needs you to confirm in #launch", body: "Remind you at 15:00: Call Ben", href: `/app/company-a/messages?c=${launch}#m-${t.messageId}`,
    });
    // Another workspace sees nothing.
    expect(await getMention(b.ownerCtx, t.mentionId)).toBeNull();
    expect(await appQueryAs(b.ownerCtx.user.profileId, "SELECT * FROM assistant_mentions WHERE id = $1", [t.mentionId])).toEqual([]);
  });

  it("stops being hers to read once she leaves the conversation", async () => {
    const side = (await createChannel(ben, { title: "side", memberIds: [id(olu)] })).id;
    const t = await tag(olu, side, "how many of us are here?");
    expect(await answerPrivately(t.mentionId, "Two of you.")).toBe("private");
    expect(await appQueryAs(olu.user.profileId, "SELECT body FROM assistant_mention_private WHERE mention_id = $1", [t.mentionId])).toEqual([{ body: "Two of you." }]);
    await updateChannel(ben, side, { memberIds: [] });
    expect(await appQueryAs(olu.user.profileId, "SELECT * FROM assistant_mention_private WHERE mention_id = $1", [t.mentionId])).toEqual([]);
    expect(await appQueryAs(olu.user.profileId, "SELECT * FROM assistant_mentions WHERE id = $1", [t.mentionId])).toEqual([]);
    expect(await getMention(olu, t.mentionId)).toBeNull();
    await expect(postMention(olu, t.mentionId)).rejects.toMatchObject({ status: 404 });
  });
});

// ---- 5. Transitions ----------------------------------------------------------------------------------------------------------------

describe("transitions", () => {
  it("claims once, one run at a time per conversation, and the next one after the first completes", async () => {
    const first = await tag(olu, design, "first");
    const second = await tag(olu, design, "second");
    const job = await claimMention(first.mentionId);
    expect(job).toMatchObject({
      id: first.mentionId, conversationId: design, messageId: first.messageId, taggerMembershipId: id(olu), attempts: 1,
      conversation: { id: design, kind: "team", name: "#Design", archived: false }, assistant: { name: "Max", colour: "blue" },
    });
    expect(job!.ctx.membership.id).toBe(id(olu));
    expect(await claimMention(first.mentionId)).toBeNull();          // its lease is live
    expect(await claimMention(second.mentionId)).toBeNull();         // the conversation is busy
    expect((await row(second.mentionId)).status).toBe("pending");
    expect(await nextPendingMention(design)).toBe(second.mentionId);
    expect(await renewMentionLease(first.mentionId)).toBe(true);
    expect(await completeMentionPublic(first.mentionId, { text: "Two tasks are left.", fullText: null, noteCode: null, engine: "builtin" })).toBe("answered");
    expect(await renewMentionLease(first.mentionId)).toBe(false);
    expect(await claimMention(second.mentionId)).not.toBeNull();
    // The thread shows "Max is thinking…" to everyone while it runs.
    const forBen = (await thread(ben, design))!.mentions.find((m) => m.id === second.mentionId)!;
    expect(forBen).toMatchObject({ status: "thinking", thinking: true });
    await completeMentionPrivate(second.mentionId, { text: null, noteCode: "no_ai", proposals: [], engine: "builtin" });
    expect((await thread(olu, design))!.mentions.find((m) => m.id === second.mentionId)!.private).toMatchObject({
      kind: "note", text: null, note: { code: "no_ai", words: "Max can't answer that here without the AI connected." }, canPost: false,
    });
  });

  it("posts one public reply, as the assistant, replying to the tagging message, whatever is called twice", async () => {
    const t = await tag(olu, design);
    const before = await messagesIn(design);
    expect(await answerPublicly(t.mentionId, "Two tasks are left: the hero image and the copy.", "Two tasks are left: the hero image and the copy. The full list…")).toBe("answered");
    expect(await completeMentionPublic(t.mentionId, { text: "again", fullText: null, noteCode: null, engine: "builtin" })).toBe("answered");
    expect(await messagesIn(design)).toBe(before + 1);
    const r = await row(t.mentionId);
    expect(r).toMatchObject({ status: "answered", engine: "builtin", lease_until: null });
    const reply = (await adminQuery<Record<string, unknown>>("SELECT * FROM messages WHERE id = $1", [r.reply_message_id]))[0];
    expect(reply).toMatchObject({ author_kind: "assistant", sender_membership_id: id(olu), reply_to_id: t.messageId, body: "Two tasks are left: the hero image and the copy." });
    // It carries no mentions and starts nothing.
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [reply.id])).toEqual([]);
    // In the thread: the assistant's own message, withdrawable by Olu and the lead, not by Ben; the full text Olu's only.
    const forOlu = (await thread(olu, design))!;
    expect(forOlu.messages.find((m) => m.id === reply.id)).toMatchObject({ author_kind: "assistant", mine: false, assistant: { name: "Max" }, mention_reply: { mentionId: t.mentionId, canWithdraw: true } });
    expect(forOlu.mentions.find((m) => m.id === t.mentionId)).toMatchObject({ status: "answered", replyMessageId: reply.id, private: { kind: "full_answer", text: "Two tasks are left: the hero image and the copy. The full list…", canPost: false } });
    expect((await thread(ben, design))!.messages.find((m) => m.id === reply.id)!.mention_reply).toEqual({ mentionId: t.mentionId, canWithdraw: false });
    expect((await thread(david, design))!.messages.find((m) => m.id === reply.id)!.mention_reply).toEqual({ mentionId: t.mentionId, canWithdraw: true });
    // Olu hears about it; her activity says so; the audit has ids only.
    expect((await notes(olu, "brenda.mention_reply")).find((n) => n.deduplication_key === `mention.reply:${t.mentionId}`)).toMatchObject({ title: "Max replied in #Design", body: "Two tasks are left: the hero image and the copy." });
    expect(await adminQuery("SELECT tool, summary, detail->>'personalSummary' AS personal FROM brenda_actions WHERE membership_id = $1 AND tool = 'mention_reply' AND detail->>'mentionId' = $2", [id(olu), t.mentionId]))
      .toEqual([{ tool: "mention_reply", summary: "Answered a mention in Messages", personal: "Answered you in #Design" }]);
    const au = await adminQuery<{ metadata: Record<string, unknown> }>("SELECT metadata FROM audit_events WHERE action = 'mention.answered' AND subject_id = $1", [t.mentionId]);
    expect(au).toHaveLength(1);
    expect(JSON.stringify(au[0].metadata)).not.toContain("Two tasks");
  });

  it("in a direct thread notifies the other person as Olu's assistant", async () => {
    const t = await tag(olu, oluBen, "when is Ben free?");
    await answerPublicly(t.mentionId, "Ben said he's free after 2.");
    const reply = (await row(t.mentionId)).reply_message_id as string;
    expect((await notes(ben, "message.direct")).find((n) => n.deduplication_key === `message:${reply}`)).toMatchObject({ title: "Olu's assistant Max replied in your chat", body: "Ben said he's free after 2." });
    expect((await notes(olu, "brenda.mention_reply")).find((n) => n.deduplication_key === `mention.reply:${t.mentionId}`)!.title).toBe("Max replied in your chat with Ben Okafor");
  });

  it("ends 'withdrawn' with nothing posted when the tagging message is withdrawn, pending or thinking", async () => {
    const pending = await tag(olu, design, "never mind");
    await withdrawMessage(olu, pending.messageId);
    expect((await row(pending.mentionId)).status).toBe("withdrawn");
    expect(await claimMention(pending.mentionId)).toBeNull();
    const thinking = await tag(olu, design, "never mind either");
    expect(await claimMention(thinking.mentionId)).not.toBeNull();
    await withdrawMessage(olu, thinking.messageId);
    const before = await messagesIn(design);
    expect(await completeMentionPublic(thinking.mentionId, { text: "Too late.", fullText: null, noteCode: null, engine: "builtin" })).toBe("withdrawn");
    expect(await messagesIn(design)).toBe(before);
    expect(await priv(thinking.mentionId)).toBeUndefined();
  });

  it("refuses with the right note when a switch is off or the channel archived, and keeps a late answer private", async () => {
    const expectRefused = async (mid: string, code: string) => {
      expect(await claimMention(mid)).toBeNull();
      expect((await row(mid)).status).toBe("refused");
      expect(await priv(mid)).toMatchObject({ kind: "note", note_code: code, body: null });
    };
    await saveMentionSettings(ada, { enabled: false });
    const w = await tag(olu, design);
    await expectRefused(w.mentionId, "off_workspace");
    expect((await notes(olu, "brenda.mention_private")).find((n) => n.deduplication_key === `mention.private:${w.mentionId}`)).toMatchObject({
      title: "Max couldn't answer in #Design", body: "Assistant replies in Messages are off in this workspace. Ask Max in your own chat instead.",
    });
    await saveMentionSettings(ada, { enabled: true });
    await setConversationAssistantReplies(david, design, false);
    await expectRefused((await tag(olu, design)).mentionId, "off_conversation");
    // Switched off while it was thinking: the answer is kept for Olu.
    await setConversationAssistantReplies(david, design, true);
    const late = await tag(olu, design);
    expect(await claimMention(late.mentionId)).not.toBeNull();
    await setConversationAssistantReplies(david, design, false);
    expect(await completeMentionPublic(late.mentionId, { text: "Short.", fullText: "Short, and longer.", noteCode: null, engine: "builtin" })).toBe("private");
    expect(await priv(late.mentionId)).toMatchObject({ kind: "answer", body: "Short, and longer.", note_code: "off_conversation" });
    await setConversationAssistantReplies(david, design, true);
    // Archived after it was asked.
    const arch = await tag(olu, launch);
    await updateChannel(olu, launch, { archived: true });
    await expectRefused(arch.mentionId, "archived");
    await updateChannel(olu, launch, { archived: false });
  });

  it("refuses past each limit, counting only mentions that were handled", async () => {
    const expectLimit = async (code: string, conv = design) => {
      const t = await tag(olu, conv);
      expect(await claimMention(t.mentionId)).toBeNull();
      expect(await priv(t.mentionId)).toMatchObject({ kind: "note", note_code: code });
    };
    await seedHandled(olu, everyone, 5, "10 seconds");
    await expectLimit("limit_minute");
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
    await seedHandled(olu, everyone, 60, "2 minutes");
    await expectLimit("limit_day");
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
    await seedHandled(ben, design, 30, "10 minutes");
    await expectLimit("limit_conversation");
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
    await seedHandled(ben, everyone, 1000, "2 minutes");
    await expectLimit("limit_workspace");
    await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
    // Refused mentions never count: after four refusals, the next one goes through.
    const ok = await tag(olu, design);
    expect(await claimMention(ok.mentionId)).not.toBeNull();
  });

  it("releases a run that failed, retries it, and fails it with a private note after three attempts", async () => {
    const t = await tag(olu, design);
    for (let i = 1; i <= 2; i++) {
      expect((await claimMention(t.mentionId))!.attempts).toBe(i);
      expect(await releaseMention(t.mentionId, "model unreachable")).toBe("thinking");
      expect((await staleMentions()).map((s) => s.id)).toContain(t.mentionId);
    }
    expect((await claimMention(t.mentionId))!.attempts).toBe(3);
    expect(await releaseMention(t.mentionId, "model unreachable")).toBe("failed");
    expect(await priv(t.mentionId)).toMatchObject({ kind: "note", note_code: "failed" });
    expect((await notes(olu, "brenda.mention_private")).find((n) => n.deduplication_key === `mention.private:${t.mentionId}`)!.body).toBe("Max couldn't answer this time. Ask again, or ask in your own chat.");
    // Never a public error: nothing in the thread but the tagging message.
    expect((await row(t.mentionId)).reply_message_id).toBeNull();
    // failMention silent writes no note; refuseMention from pending writes its note.
    const s = await tag(olu, design);
    expect(await failMention(s.mentionId, { silent: true })).toBe("failed");
    expect(await priv(s.mentionId)).toBeUndefined();
    const r = await tag(olu, design);
    expect(await refuseMention(r.mentionId, "not_allowed")).toBe("refused");
    expect(await refuseMention(r.mentionId, "failed")).toBe("refused");
    expect(await priv(r.mentionId)).toMatchObject({ note_code: "not_allowed" });
  });

  it("finds stuck rows and settles Confirms past their time", async () => {
    const stuck = await tag(olu, everyone);
    await adminQuery("UPDATE assistant_mentions SET created_at = now() - interval '1 minute' WHERE id = $1", [stuck.mentionId]);
    expect((await staleMentions()).map((s) => s.id)).toContain(stuck.mentionId);
    const fresh = await tag(olu, launch);
    expect((await staleMentions()).map((s) => s.id)).not.toContain(fresh.mentionId);
    const t = await tag(olu, oluBen, "remind me");
    await answerPrivately(t.mentionId, "Confirm and I'll remind you.", [confirmFor(olu, "remind_me", { body: "Call Ben", at: new Date(Date.now() + 3600_000).toISOString() }, "Remind you: Call Ben")]);
    expect((await row(t.mentionId)).status).toBe("waiting_confirm");
    await settleMentionConfirms();
    expect((await row(t.mentionId)).status).toBe("waiting_confirm");
    await adminQuery("UPDATE assistant_mentions SET confirm_until = now() - interval '1 second' WHERE id = $1", [t.mentionId]);
    expect(await settleMentionConfirms()).toBeGreaterThanOrEqual(1);
    expect(await row(t.mentionId)).toMatchObject({ status: "private", confirm_until: null });
    expect((await thread(ben, oluBen))!.mentions.find((m) => m.id === t.mentionId)!.waiting).toBe(false);
  });
});

// ---- 6. Post, dismiss, withdraw, decide ----------------------------------------------------------------------------------

describe("the tagger's choices", () => {
  it("Post to channel publishes exactly the text once, as Olu through Max; Dismiss puts it away", async () => {
    const t = await tag(olu, design, "what's Ben on?");
    const text = "Ben is on the hero image.\nIt is due Friday.";
    await answerPrivately(t.mentionId, text);
    await expect(postMention(ben, t.mentionId)).rejects.toMatchObject({ status: 404 });
    const { messageId } = await postMention(olu, t.mentionId);
    const m = (await adminQuery<Record<string, unknown>>("SELECT * FROM messages WHERE id = $1", [messageId]))[0];
    expect(m).toMatchObject({ body: text, author_kind: "via_assistant", sender_membership_id: id(olu), reply_to_id: t.messageId });
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [messageId])).toEqual([]);
    await expect(postMention(olu, t.mentionId)).rejects.toMatchObject({ status: 409, code: "ALREADY_POSTED" });
    expect((await thread(olu, design))!.mentions.find((x) => x.id === t.mentionId)!.private).toMatchObject({ postedMessageId: messageId, canPost: false });
    expect(await adminQuery("SELECT 1 FROM audit_events WHERE action = 'mention.posted' AND subject_id = $1", [t.mentionId])).toHaveLength(1);

    const d = await tag(olu, design, "and David?");
    await answerPrivately(d.mentionId, "David is reviewing.");
    expect(await dismissMention(olu, d.mentionId)).toEqual({ id: d.mentionId });
    expect(await dismissMention(olu, d.mentionId)).toEqual({ id: d.mentionId });
    expect((await thread(olu, design))!.mentions.find((x) => x.id === d.mentionId)!.private).toMatchObject({ canPost: false });
    expect((await thread(olu, design))!.mentions.find((x) => x.id === d.mentionId)!.private!.dismissedAt).not.toBeNull();
    await expect(postMention(olu, d.mentionId)).rejects.toMatchObject({ status: 409 });
    await expect(dismissMention(ben, d.mentionId)).rejects.toMatchObject({ status: 404 });
  });

  it("Post to chat in a direct thread tells Ben as any message through her assistant", async () => {
    const t = await tag(olu, oluBen, "draft a reply");
    await answerPrivately(t.mentionId, "Thanks Ben, I'll send it by 4.");
    const { messageId } = await postMention(olu, t.mentionId);
    expect((await notes(ben, "message.direct")).find((n) => n.deduplication_key === `message:${messageId}`)).toMatchObject({ title: "Olu Adeyemi sent you a message via Max", body: "Thanks Ben, I'll send it by 4." });
  });

  it("is not posted into an archived channel", async () => {
    const t = await tag(olu, launch, "sum up");
    await answerPrivately(t.mentionId, "Launch is on track.");
    await updateChannel(olu, launch, { archived: true });
    await expect(postMention(olu, t.mentionId)).rejects.toMatchObject({ status: 409, code: "CONVERSATION_ARCHIVED" });
    expect((await thread(olu, launch))!.mentions.find((x) => x.id === t.mentionId)!.private!.canPost).toBe(false);
    await updateChannel(olu, launch, { archived: false });
    expect((await postMention(olu, t.mentionId)).messageId).toBeTruthy();
  });

  it("a reply is withdrawn by Olu, by the team lead, by HR, by either person in a direct thread; not by Ben in #design", async () => {
    const replyIn = async (conv: string) => { const t = await tag(olu, conv); await answerPublicly(t.mentionId, "An answer."); return t.mentionId; };
    const byOlu = await replyIn(design);
    expect(await withdrawMentionReply(olu, byOlu)).toEqual({ id: byOlu });
    const r = await row(byOlu);
    expect(r.status).toBe("withdrawn");
    expect((await adminQuery<{ deleted_at: string | null; body: string }>("SELECT deleted_at, body FROM messages WHERE id = $1", [r.reply_message_id]))[0].deleted_at).not.toBeNull();
    expect((await thread(ben, design))!.messages.find((m) => m.id === r.reply_message_id)).toMatchObject({ body: "", mention_reply: null });
    await expect(withdrawMentionReply(olu, byOlu)).rejects.toMatchObject({ status: 409 });
    expect(await withdrawMentionReply(david, await replyIn(design))).toBeTruthy();
    expect(await withdrawMentionReply(mary, await replyIn(design))).toBeTruthy();
    const notBen = await replyIn(design);
    await expect(withdrawMentionReply(ben, notBen)).rejects.toMatchObject({ status: 403, message: "Only the person who asked or someone who runs this conversation can withdraw it." });
    await expect(withdrawMentionReply(ada, notBen)).rejects.toMatchObject({ status: 404 });
    expect(await withdrawMentionReply(ben, await replyIn(oluBen))).toBeTruthy();
    // Nobody but the worker touches an assistant's message directly.
    const still = (await row(notBen)).reply_message_id as string;
    await rejects(appQueryAs(olu.user.profileId, "UPDATE messages SET deleted_at = now() WHERE id = $1", [still]));
    const au = await adminQuery<{ actor_membership_id: string }>("SELECT actor_membership_id FROM audit_events WHERE action = 'mention.withdrawn' AND subject_id = $1", [byOlu]);
    expect(au).toEqual([{ actor_membership_id: id(olu) }]);
  });

  it("a Confirm card runs once by its index, a decline closes it, and the last decision makes it private", async () => {
    const t = await tag(olu, design, "add a to-do to call Ben and remind me at 3");
    const todo = confirmFor(olu, "create_todos", { items: [{ title: "Call Ben about the hero" }] }, "Add to-do: Call Ben about the hero");
    const remind = confirmFor(olu, "remind_me", { body: "Call Ben", at: new Date(Date.now() + 3 * 3600_000).toISOString() }, "Remind you: Call Ben");
    await answerPrivately(t.mentionId, "I can do both when you confirm.", [todo, remind]);
    await expect(decideMentionProposal(ben, t.mentionId, 0, "confirm")).rejects.toMatchObject({ status: 404 });
    const done = await decideMentionProposal(olu, t.mentionId, 0, "confirm");
    expect(done.error).toBeNull();
    expect(done.actions.length).toBeGreaterThan(0);
    expect(done.proposal).toMatchObject({ index: 0, state: "done" });
    expect(await adminQuery("SELECT 1 FROM tasks WHERE title = 'Call Ben about the hero' AND assignee_membership_id = $1", [id(olu)])).toHaveLength(1);
    await expect(decideMentionProposal(olu, t.mentionId, 0, "confirm")).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CLOSED" });
    expect(await adminQuery("SELECT 1 FROM tasks WHERE title = 'Call Ben about the hero'")).toHaveLength(1);
    expect((await row(t.mentionId)).status).toBe("waiting_confirm");
    const declined = await decideMentionProposal(olu, t.mentionId, 1, "decline");
    expect(declined).toMatchObject({ actions: [], error: null, proposal: { index: 1, state: "declined" } });
    expect(await row(t.mentionId)).toMatchObject({ status: "private", confirm_until: null });
    await expect(decideMentionProposal(olu, t.mentionId, 1, "confirm")).rejects.toMatchObject({ status: 409 });
    await expect(decideMentionProposal(olu, t.mentionId, 7, "confirm")).rejects.toMatchObject({ status: 404 });
    // Dismissing declines what is still open.
    const d = await tag(olu, design, "remind me later");
    await answerPrivately(d.mentionId, "Confirm to set it.", [confirmFor(olu, "remind_me", { body: "Later", at: new Date(Date.now() + 3600_000).toISOString() }, "Remind you: Later")]);
    await dismissMention(olu, d.mentionId);
    expect((await row(d.mentionId)).status).toBe("private");
    expect((await getMention(olu, d.mentionId))!.private!.proposals[0].state).toBe("declined");
  });
});

// ---- 7. Switches -------------------------------------------------------------------------------------------------------------

describe("the switches", () => {
  it("only whoever runs a conversation changes its switch", async () => {
    await expect(setConversationAssistantReplies(ben, design, false)).rejects.toMatchObject({ status: 403, message: "Only someone who runs this conversation can change this." });
    await expect(setConversationAssistantReplies(olu, everyone, false)).rejects.toMatchObject({ status: 403 });
    await expect(setConversationAssistantReplies(ada, design, false)).rejects.toMatchObject({ status: 404 }); // the owner does not read #design
    expect(await setConversationAssistantReplies(ben, oluBen, false)).toEqual({ assistantReplies: false });
    expect((await thread(olu, oluBen))!.assistantReplies).toEqual({ ready: true, workspaceOn: true, here: false, canChange: true });
    expect(await setConversationAssistantReplies(olu, oluBen, true)).toEqual({ assistantReplies: true });
    expect(await setConversationAssistantReplies(mary, everyone, false)).toEqual({ assistantReplies: false });
    expect(await setConversationAssistantReplies(ada, everyone, true)).toEqual({ assistantReplies: true });
    expect(await setConversationAssistantReplies(olu, launch, false)).toEqual({ assistantReplies: false });
    await expect(setConversationAssistantReplies(ben, launch, true)).rejects.toMatchObject({ status: 403 });
    await setConversationAssistantReplies(olu, launch, true);
    // Nobody updates the column directly: the app role's update matches no row (conversations have no update policy).
    expect(await appQueryAs(olu.user.profileId, "UPDATE conversations SET assistant_replies = false WHERE id = $1 RETURNING id", [launch])).toEqual([]);
    expect((await adminQuery<{ on: boolean }>("SELECT assistant_replies AS on FROM conversations WHERE id = $1", [launch]))[0].on).toBe(true);
  });

  it("only owners and HR change the workspace's; every member reads it", async () => {
    await expect(saveMentionSettings(ben, { enabled: false })).rejects.toMatchObject({ status: 403 });
    await expect(saveMentionSettings(david, { enabled: false })).rejects.toMatchObject({ status: 403 });
    expect(await saveMentionSettings(mary, { enabled: false })).toEqual({ ready: true, enabled: false });
    expect(await withUser(ben.user.profileId, (db) => mentionSettings(db, org()))).toEqual({ ready: true, enabled: false });
    expect((await thread(olu, design))!.assistantReplies.workspaceOn).toBe(false);
    expect(await saveMentionSettings(ada, { enabled: true })).toEqual({ ready: true, enabled: true });
    expect(await adminQuery("SELECT summary FROM brenda_actions WHERE organisation_id = $1 AND tool = 'settings' AND summary LIKE 'Mentions in Messages%' ORDER BY created_at", [org()]))
      .toEqual(expect.arrayContaining([{ summary: "Mentions in Messages: off" }, { summary: "Mentions in Messages: assistants may reply" }]));
  });
});

// ---- 8. Readers and visibility (SQL) -------------------------------------------------------------------------------------------

describe("who reads a conversation, item by item", () => {
  it("answers only the worker or a reader, and never through the internal functions", async () => {
    const readers = async (c: OrgContext | null, conv: string) =>
      (await appQueryAs(c?.user.profileId ?? null, "SELECT membership_id FROM app_conversation_readers($1)", [conv])).map((r) => r.membership_id).sort();
    expect(await readers(ada, launch)).toEqual([]);
    expect(await readers(olu, launch)).toEqual([id(olu), id(ben)].sort());
    expect(await readers(olu, design)).toEqual([id(david), id(olu), id(ben), id(mary)].sort());
    expect(await readers(b.ownerCtx, design)).toEqual([]);
    // Ben's own to-do sits in the Design team's project, so everyone in #design can open it; it is still his own data.
    const benTodo = (await quickTodo(ben, { title: "Ben's dentist" })).id;
    // A task in a project Olu is not in: Ben holds it, David checks it.
    const internal = await createProject(david, { name: "Internal", description: "Back office", requiresDueDate: false, requiresEstimate: false, memberIds: [id(ben)] });
    const payroll = (await createTask(david, { projectId: internal.id, title: "Payroll export", expectedOutput: "The export.", assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, captureRequirement: "none", addToMyDay: false })).id;
    const davidBen = await openDirect(david, id(ben));
    const vis = (c: OrgContext, conv: string, kind: string, item: string) =>
      appQueryAs(c.user.profileId, "SELECT app_visible_to_readers($1, $2, $3) AS ok", [conv, kind, item]).then((r) => r[0].ok);
    expect(await vis(olu, design, "task", a.taskIds.homepage)).toBe(true);
    expect(await vis(olu, design, "task", payroll)).toBe(false);    // Olu cannot see it: nothing is learnt
    expect(await vis(ben, design, "task", payroll)).toBe(false);    // Ben can, but not everyone here
    expect(await vis(david, davidBen, "task", payroll)).toBe(true); // both of them can
    expect(await vis(olu, design, "task", benTodo)).toBe(false);    // an own to-do is never public
    expect(await vis(ben, design, "task", benTodo)).toBe(false);
    expect(await vis(ada, design, "task", a.taskIds.homepage)).toBe(false); // the owner does not read #design
    expect(await vis(olu, design, "conversation", design)).toBe(true);
    expect(await vis(olu, design, "conversation", everyone)).toBe(true);
    expect(await vis(olu, design, "conversation", launch)).toBe(false);
    expect(await vis(olu, launch, "conversation", design)).toBe(true);  // Olu and Ben both read #design
    expect(await vis(b.ownerCtx, design, "conversation", design)).toBe(false);
    expect(await visibleToReaders(olu, design, "task", [a.taskIds.homepage, benTodo, "not-a-uuid"])).toEqual(new Set([a.taskIds.homepage]));
    await rejects(appQueryAs(olu.user.profileId, "SELECT app_member_can_read_conversation($1, $2)", [id(olu), launch]));
    await rejects(appQueryAs(olu.user.profileId, "SELECT app_member_can_view_task($1, $2)", [id(ada), benTodo]));
    await rejects(appQueryAs(olu.user.profileId, "SELECT app_member_can_read_doc($1, $2)", [id(ada), benTodo]));
    expect((await appQueryAs(ben.user.profileId, "SELECT app_conversation_has_reader($1, $2) AS ok", [launch, id(olu)]))[0].ok).toBe(true);
    expect((await appQueryAs(ada.user.profileId, "SELECT app_conversation_has_reader($1, $2) AS ok", [launch, id(olu)]))[0].ok).toBe(false);
  });
});

// ---- 9. The thread the assistant reads ------------------------------------------------------------------------------------------

describe("readMentionThread", () => {
  it("reads up to the tagging message, newest kept, the replied-to message first when older, withdrawn left out", async () => {
    const quiet = (await createChannel(olu, { title: "quiet", memberIds: [id(ben), id(david)] })).id;
    const asked = await send(ben, quiet, "Can we move the landing page review to 3?");
    for (let i = 1; i <= 3; i++) await send(ben, quiet, `filler ${i}`);
    const gone = await send(ben, quiet, "a withdrawn one");
    await withdrawMessage(ben, gone.id);
    const long = "long ".repeat(100).trim();
    await send(ben, quiet, long);
    const t = await send(olu, quiet, "@Max what's left on the landing page?", [MAX], { replyToId: asked.id, taskId: a.taskIds.homepage });
    await send(ben, quiet, "after the tag");
    const r = (await readMentionThread(olu, { conversationId: quiet, messageId: t.id, messages: 4 }))!;
    expect(r.tagging).toMatchObject({ id: t.id, author: { name: "Olu Adeyemi", isYou: true }, body: "@Max what's left on the landing page?" });
    expect(r.messages.map((m) => m.body)).toEqual(["Can we move the landing page review to 3?", "filler 2", "filler 3", long, "@Max what's left on the landing page?"]);
    expect(r.replyTo).toMatchObject({ id: asked.id, author: { name: "Ben Okafor", isYou: false } });
    expect(r.task).toEqual({ id: a.taskIds.homepage, title: "Homepage design" });
    expect(r.people[0]).toEqual({ membershipId: id(olu), name: "Olu Adeyemi" });
    expect(r.people).toHaveLength(3);
    expect(r.peopleCount).toBe(3);
    expect(r).toMatchObject({ mode: "last", nothingNew: false, omittedOlder: 1, conversation: { id: quiet, name: "#quiet", kind: "channel" }, window: { to: r.tagging.at } });
    // The character cap keeps the tagging message, then the newest that fit (the long one does not), and the replied-to one.
    const small = (await readMentionThread(olu, { conversationId: quiet, messageId: t.id, chars: 300 }))!;
    expect(small.messages.map((m) => m.id)).toEqual([asked.id, t.id]);
    expect(small.omittedOlder).toBe(4);
    // Not for someone who cannot read it, nor for a withdrawn tagging message.
    expect(await readMentionThread(ada, { conversationId: quiet, messageId: t.id })).toBeNull();
    await withdrawMessage(olu, t.id);
    expect(await readMentionThread(olu, { conversationId: quiet, messageId: t.id })).toBeNull();
  });
});

// ---- 10. Deleting a channel ---------------------------------------------------------------------------------------------

describe("deleting a channel", () => {
  it("takes its mentions, queue rows and private parts with it", async () => {
    const gone = (await createChannel(olu, { title: "temporary", memberIds: [id(ben)] })).id;
    const pub = await tag(olu, gone, "one");
    await answerPublicly(pub.mentionId, "Public.", "Public, in full.");
    const pri = await tag(olu, gone, "two");
    await answerPrivately(pri.mentionId, "Private.");
    await send(olu, gone, "@Ben Okafor bye", [person(ben)]);
    expect(await deleteConversation(olu, gone)).toEqual({ deleted: true, hidden: false });
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE conversation_id = $1", [gone])).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM assistant_mentions WHERE conversation_id = $1", [gone])).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM assistant_mention_private WHERE mention_id = ANY($1::uuid[])", [[pub.mentionId, pri.mentionId]])).toEqual([]);
  });
});

// ---- 11. Before 0041 ------------------------------------------------------------------------------------------------------------

describe("before migration 0041", () => {
  it("sends without mentions, shows none, and the routes' services answer not ready", async () => {
    const t = await tag(olu, design, "before");
    flags.off = true;
    try {
      const r = await send(olu, design, "@Max @Ben Okafor hi", [MAX, person(ben)]);
      expect(r).toMatchObject({ mentionId: null, mentioned: [] });
      expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [r.id])).toEqual([]);
      const th = (await thread(olu, design))!;
      expect(th.mentions).toEqual([]);
      expect(th.assistantReplies).toEqual({ ready: false, workspaceOn: true, here: true, canChange: false });
      expect(th.messages.every((m) => m.mentions.length === 0 && m.mention_reply === null)).toBe(true);
      expect(await withUser(olu.user.profileId, (db) => mentionSettings(db, org()))).toEqual({ ready: false, enabled: true });
      await expect(getMention(olu, t.mentionId)).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
      await expect(setConversationAssistantReplies(david, design, false)).rejects.toMatchObject({ status: 503 });
      await expect(saveMentionSettings(ada, { enabled: false })).rejects.toMatchObject({ status: 503 });
      expect(await claimMention(t.mentionId)).toBeNull();
      expect(await visibleToReaders(olu, design, "task", [a.taskIds.homepage])).toEqual(new Set());
      expect(await readMentionThread(olu, { conversationId: design, messageId: t.messageId })).toBeNull();
    } finally {
      flags.off = false;
    }
    expect((await row(t.mentionId)).status).toBe("pending");
  });
});

