/**
 * Tagging someone else's assistant in Messages (owner decision, 8 October 2026: personal assistants, phase 6). "@Ben's
 * Brenda, where is the pricing page?" in #Design: Ben's assistant answers IN THE THREAD as Ben's assistant, under the
 * follow-up rules (facts the TAGGER may see, Ben's own preference, and only what every reader can see; otherwise the
 * tagger alone gets it), or asks Ben once and posts his reply; anything that would change Ben's account becomes a request
 * Ben must accept, offered to the tagger as a Confirm. No model anywhere on this path, and no loops.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). `startMention: false` on every send;
 * runs are driven here with `useModel: false`.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (Max), Ben Okafor
 * (Brenda). #design is the Design team channel (David, Olu, Ben read it); #launch a named channel Olu made with David.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { addComment, createProject, createTask } from "@/server/services/tasks";
import { createChannel, openChannel, sendMessage, thread, withdrawMessage, type SendInput } from "@/server/services/messaging";
import { decideMentionProposal, withdrawMentionReply } from "@/server/services/mentions";
import { processMention, syncThreadFollowUp } from "@/server/services/mention-processor";
import { processFollowUp, replyToFollowUp, saveFollowUpPreference } from "@/server/services/follow-ups";
import { acceptItem, saveAssistantTalkPreferences, setMute } from "@/server/services/assistant-items";
import { withWorker } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let david: OrgContext, olu: OrgContext, ben: OrgContext;
let design: string, launch: string;

const NO_MODEL = { useModel: false } as const;
const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
type Token = NonNullable<SendInput["mentions"]>[number];
/** Ben's assistant as the composer sends it (phase 6 token). */
const BENS = (label = "@Ben's Brenda") => ({ kind: "others_assistant", membershipId: id(ben), label }) as unknown as Token;
const MAX = { kind: "assistant", label: "@Max" } as Token;
const send = (c: OrgContext, conversationId: string, body: string, mentions?: Token[]) => sendMessage(c, { conversationId, body, mentions }, { startMention: false });
const row = async (mid: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_mentions WHERE id = $1", [mid]))[0];
const privateOf = async (mid: string) => (await adminQuery<{ kind: string; body: string | null; note_code: string | null; proposals: { tool: string }[] }>("SELECT kind, body, note_code, proposals FROM assistant_mention_private WHERE mention_id = $1", [mid]))[0] ?? null;
const messageOf = async (mid: string) => (await adminQuery<{ id: string; body: string; sender_membership_id: string; author_kind: string; reply_to_id: string | null; deleted_at: string | null }>(
  "SELECT id, body, sender_membership_id, author_kind, reply_to_id, deleted_at FROM messages WHERE id = $1", [mid]))[0] ?? null;
const notes = (c: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null }>("SELECT title, body FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [id(c), type]);
const followUpOf = async (mid: string) => (await row(mid)).follow_up_id as string;
/** Ben did something on his task just now, so his work answers questions about it. */
const touch = (taskId: string, words: string) => addComment(ben, taskId, words);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
  launch = (await createChannel(olu, { title: "launch", memberIds: [id(david)] })).id;
});

beforeEach(async () => {
  // Every case starts with no open run and a fresh day for the per-person limits (as mention-e2e), and with the day's
  // asks to Ben spent elsewhere (a follow-up asks the same person once a day per asker).
  await adminQuery(`UPDATE assistant_mentions SET status = 'failed', lease_until = NULL WHERE status IN ('pending', 'thinking')`);
  await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
  await adminQuery(`UPDATE follow_ups SET asked_at = asked_at - interval '3 days', created_at = created_at - interval '3 days' WHERE status NOT IN ('pending', 'asking', 'answering') AND created_at > now() - interval '2 days'`);
});

describe("the token", () => {
  it("is kept when Ben reads the conversation and lets people tag his assistant; one assistant per message", async () => {
    const sent = await send(david, design, "@Ben's Brenda where is the pricing page?", [BENS()]);
    expect(sent.mentionId).toBeTruthy();
    expect(await row(sent.mentionId!)).toMatchObject({ tagger_membership_id: id(david), owner_membership_id: id(ben), status: "pending", follow_up_id: null, holding_message_id: null });
    expect(await adminQuery("SELECT kind, membership_id, label FROM message_mentions WHERE message_id = $1", [sent.id])).toEqual([{ kind: "assistant", membership_id: id(ben), label: "@Ben's Brenda" }]);
    // Two assistants in one message: the first token wins, the other is dropped.
    const two = await send(olu, design, "@Ben's Brenda and @Max, are we on track?", [BENS(), MAX]);
    expect(await adminQuery("SELECT kind, membership_id FROM message_mentions WHERE message_id = $1 AND kind = 'assistant'", [two.id])).toEqual([{ kind: "assistant", membership_id: id(ben) }]);
    expect(await row(two.mentionId!)).toMatchObject({ tagger_membership_id: id(olu), owner_membership_id: id(ben) });
  });

  it("is dropped where Ben does not read the conversation, or once he switched tags off", async () => {
    const away = await send(olu, launch, "@Ben's Brenda hello", [BENS()]);
    expect(away.mentionId).toBeNull();
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: false });
    const off = await send(david, design, "@Ben's Brenda hello", [BENS()]);
    expect(off.mentionId).toBeNull();
    expect(await adminQuery("SELECT 1 FROM message_mentions WHERE message_id = ANY($1::uuid[]) AND kind = 'assistant'", [[away.id, off.id]])).toEqual([]);
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: true });
    // Nor can it be forced in as the app while the switch is off.
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: false });
    const plain = await send(david, design, "@Ben's Brenda again");
    await expect(appQueryAs(david.user.profileId,
      `INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, 'assistant', $4, '@Ben''s Brenda')`, [plain.id, design, org(), id(ben)]))
      .rejects.toThrow(/row-level security/);
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: true });
  });
});

describe("refused at the claim, with a note for the tagger", () => {
  it("off_owner: Ben switched tags off after the message was sent", async () => {
    const sent = await send(david, design, "@Ben's Brenda where is the pricing page?", [BENS()]);
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: false });
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("refused");
    expect(await privateOf(sent.mentionId!)).toMatchObject({ kind: "note", note_code: "off_owner" });
    await saveAssistantTalkPreferences(ben, { allowThreadReplies: true });
  });

  it("owner_muted: Ben muted David's assistant", async () => {
    await setMute(ben, id(david), true);
    const sent = await send(david, design, "@Ben's Brenda where is the pricing page?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("refused");
    expect(await privateOf(sent.mentionId!)).toMatchObject({ note_code: "owner_muted" });
    await setMute(ben, id(david), false);
  });

  it("not_followable: Olu may not follow up on Ben (they share no work)", async () => {
    const sent = await send(olu, design, "@Ben's Brenda where is the pricing page?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("refused");
    expect(await privateOf(sent.mentionId!)).toMatchObject({ note_code: "not_followable" });
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE requester_membership_id = $1", [id(olu)])).toEqual([]);
  });

  it("limit_owner: ten tags of Ben's assistant by David today", async () => {
    await adminQuery(
      `WITH m AS (INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body) SELECT $1, $2, $3, 'seeded ' || g FROM generate_series(1, 10) g RETURNING id)
       INSERT INTO assistant_mentions(organisation_id, conversation_id, message_id, tagger_membership_id, owner_membership_id, status, started_at, finished_at)
       SELECT $1, $2, m.id, $3, $4, 'answered', now() - interval '2 hours', now() - interval '2 hours' FROM m`, [org(), design, id(david), id(ben)]);
    const sent = await send(david, design, "@Ben's Brenda one more?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("refused");
    expect(await privateOf(sent.mentionId!)).toMatchObject({ note_code: "limit_owner" });
  });
});

describe("answers in the thread", () => {
  let publicMention = "";

  it("fresh facts every reader can see: Ben's assistant answers in public, as Ben's assistant", async () => {
    await touch(a.taskIds.second, "Draft is in the shared folder.");
    const sent = await send(david, design, "@Ben's Brenda where is the pricing page copy?", [BENS()]);
    publicMention = sent.mentionId!;
    expect(await processMention(publicMention, NO_MODEL)).toBe("answered");
    const r = await row(publicMention);
    expect(r.follow_up_id).toBeTruthy();
    const reply = await messageOf(r.reply_message_id as string);
    expect(reply).toMatchObject({ sender_membership_id: id(ben), author_kind: "assistant", reply_to_id: sent.id, deleted_at: null });
    expect(reply.body).toContain("Pricing page copy");
    // Everyone in #design sees it, with no mentions on it (nothing loops), "asked by David".
    const forOlu = (await thread(olu, design))!.messages.find((m) => m.id === reply.id) as unknown as { mentions: unknown[]; mention_reply: { askedBy: { firstName: string } | null } | null };
    expect(forOlu.mentions).toEqual([]);
    expect(forOlu.mention_reply?.askedBy).toMatchObject({ firstName: "David" });
    expect((await notes(ben, "assistant.tagged")).at(-1)).toMatchObject({ title: "David asked your Brenda in #Design" });
    expect((await notes(david, "assistant.thread_reply")).at(-1)).toMatchObject({ title: "Ben's Brenda replied in #Design" });
  });

  it("facts narrower than the audience: a line in public, the answer only for David", async () => {
    const hidden = await createProject(david, { name: "Vendors", description: "Contracts", requiresDueDate: false, requiresEstimate: false, memberIds: [id(ben)] });
    const task = await createTask(david, { projectId: hidden.id, title: "Vendor contract", expectedOutput: "Signed contract.", assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, captureRequirement: "none", addToMyDay: false });
    await touch(task.id, "Waiting on legal.");
    const sent = await send(david, design, "@Ben's Brenda where is the vendor contract?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("answered");
    const reply = await messageOf((await row(sent.mentionId!)).reply_message_id as string);
    expect(reply.body).toBe("I've answered David privately: not everyone here can see Ben's work on this.");
    expect(reply.body).not.toContain("Vendor contract");
    const mine = await privateOf(sent.mentionId!);
    expect(mine).toMatchObject({ kind: "answer" });
    expect(mine!.body).toContain("Vendor contract");
    expect(await appQueryAs(olu.user.profileId, "SELECT body FROM assistant_mention_private WHERE mention_id = $1", [sent.mentionId])).toEqual([]);
    const view = (await thread(david, design))!.mentions.find((m) => m.id === sent.mentionId) as unknown as { private: { canPost: boolean } | null };
    expect(view.private).toMatchObject({ canPost: false });
    expect((await notes(ben, "assistant.tagged")).at(-1)).toMatchObject({ body: "Brenda shared an update about your work with David privately." });
  });

  it("Ben chose 'Always ask me first': a holding line, then his reply, quoted", async () => {
    await saveFollowUpPreference(ben, "ask_first");
    const sent = await send(david, design, "@Ben's Brenda what are you working on?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("asked");
    const r = await row(sent.mentionId!);
    const holding = await messageOf(r.holding_message_id as string);
    expect(holding).toMatchObject({ sender_membership_id: id(ben), author_kind: "assistant", reply_to_id: sent.id });
    expect(holding.body).toMatch(/^I've asked Ben\. I'll reply here( by .+)?\.$/);
    const f = r.follow_up_id as string;
    await replyToFollowUp(ben, f, { choice: "on_track", note: "Images land tomorrow" }, { start: false });
    await processFollowUp(f, NO_MODEL);
    await syncThreadFollowUp(f);
    const done = await row(sent.mentionId!);
    expect(done.status).toBe("answered");
    expect((await messageOf(done.reply_message_id as string)).body).toBe("Ben replied: On track. “Images land tomorrow”");
    // The same sync again posts nothing more.
    const count = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE reply_to_id = $1", [sent.id]))[0].n;
    const n = await count();
    await syncThreadFollowUp(f);
    expect(await count()).toBe(n);
  });

  it("no reply by the deadline: “No reply from Ben by …”", async () => {
    const sent = await send(david, design, "@Ben's Brenda what are you working on today?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("asked");
    const f = await followUpOf(sent.mentionId!);
    const [{ deadline_at }] = await adminQuery<{ deadline_at: string }>("SELECT deadline_at FROM follow_ups WHERE id = $1", [f]);
    await processFollowUp(f, { useModel: false, now: new Date(Date.parse(deadline_at) + 60_000) });
    await syncThreadFollowUp(f);
    const r = await row(sent.mentionId!);
    expect(r.status).toBe("answered");
    expect((await messageOf(r.reply_message_id as string)).body).toMatch(/^No reply from Ben by .+\.$/);
  });

  it("the tagging message withdrawn while Ben is asked: the follow-up is cancelled and nothing more is posted", async () => {
    const sent = await send(david, design, "@Ben's Brenda what's next for you?", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("asked");
    const f = await followUpOf(sent.mentionId!);
    await withdrawMessage(david, sent.id);
    await syncThreadFollowUp(f);
    expect((await adminQuery<{ status: string }>("SELECT status FROM follow_ups WHERE id = $1", [f]))[0].status).toBe("cancelled");
    const r = await row(sent.mentionId!);
    expect(r.status).toBe("withdrawn");
    expect(r.reply_message_id).toBeNull();
    const holding = await messageOf(r.holding_message_id as string);
    if (holding) expect(holding.deleted_at).toBeTruthy();
    await saveFollowUpPreference(ben, "auto");
  });

  it("the owner, the tagger and whoever runs the conversation may withdraw the reply; another reader may not", async () => {
    await expect(withdrawMentionReply(olu, publicMention)).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(withdrawMentionReply(ben, publicMention)).resolves.toMatchObject({ id: publicMention });
    expect((await row(publicMention)).status).toBe("withdrawn");
  });
});

describe("a change to Ben's account", () => {
  it("becomes a request offered to the tagger alone; Confirm sends it with the thread as its origin; nothing changes until Ben accepts", async () => {
    const tasks = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE assignee_membership_id = $1", [id(ben)]))[0].n;
    const before = await tasks();
    const sent = await send(olu, design, "@Ben's Brenda add Review the deck to his to-dos", [BENS()]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("waiting_confirm");
    const card = await privateOf(sent.mentionId!);
    expect(card!.proposals.map((p) => p.tool)).toEqual(["hand_over_request"]);
    expect(card!.body).toBe("That changes Ben's to-dos, so Ben has to accept it. Confirm and I'll ask Ben.");
    // Ben and David see only that Olu must confirm.
    for (const c of [ben, david]) {
      const v = (await thread(c, design))!.mentions.find((m) => m.id === sent.mentionId) as unknown as { private: unknown; waiting: boolean };
      expect(v).toMatchObject({ private: null, waiting: true });
    }
    const done = await decideMentionProposal(olu, sent.mentionId!, 0, "confirm");
    expect(done.error).toBeNull();
    const [item] = await adminQuery<{ id: string; kind: string; conversation_id: string; mention_id: string; status: string }>(
      "SELECT id, kind, conversation_id, mention_id, status FROM assistant_items WHERE sender_membership_id = $1 AND kind = 'request'", [id(olu)]);
    expect(item).toMatchObject({ kind: "request", conversation_id: design, mention_id: sent.mentionId, status: "delivered" });
    expect(await tasks()).toBe(before);
    const accepted = await acceptItem(ben, item.id);
    expect(accepted).toMatchObject({ status: "done", origin: { conversationId: design, name: "#Design" } });
    expect(await tasks()).toBe(before + 1);
  });
});

describe("no loops", () => {
  it("an assistant's message naming assistants starts nothing", async () => {
    const before = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM assistant_mentions"))[0].n;
    await withWorker((db) => db.query(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind) VALUES ($1, $2, $3, '@Max @Ben''s Brenda please both answer', 'assistant')`, [org(), design, id(ben)]));
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM assistant_mentions"))[0].n).toBe(before);
    // A person cannot attach an assistant tag to an assistant's message either.
    const [m] = await adminQuery<{ id: string }>("SELECT id FROM messages WHERE author_kind = 'assistant' AND body LIKE '@Max @Ben%' LIMIT 1");
    await expect(appQueryAs(olu.user.profileId,
      `INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, 'assistant', $4, '@Ben''s Brenda')`, [m.id, design, org(), id(ben)]))
      .rejects.toThrow(/row-level security/);
  });
});
