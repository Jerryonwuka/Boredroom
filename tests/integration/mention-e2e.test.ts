/**
 * @mentions in Messages, end to end (owner decision, 8 October 2026: personal assistants, phase 5; integration review).
 * Each case goes the whole way a person's press goes: the composer's tokens through sendMessage, the queue row, the
 * processor (or, for the model's path, copilot's answerMention with a scripted model and the processor's own completion
 * steps), what every reader's thread shows, and the tagger's choices (Post, Confirm, Withdraw). Local test database only;
 * the real model is never reached: processMention runs with `useModel: false` (and NODE_ENV "test" refuses it anyway),
 * and the model's path below talks to a fake Anthropic client.
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (her assistant is Max),
 * Ben Okafor (kept Brenda). #design is the Design team channel, #launch a named channel Olu made with Ben only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted model: each call takes the next answer (no network, no key).
const model = vi.hoisted(() => ({ script: [] as Record<string, unknown>[], calls: 0 }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        model.calls++;
        const next = model.script.shift();
        if (!next) throw new Error("the fake model has nothing more to say");
        return next;
      },
    };
  },
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { createChannel, openChannel, sendMessage, thread, withdrawMessage, type SendInput } from "@/server/services/messaging";
import {
  claimMention, completeMentionPrivate, completeMentionPublic, decideMentionProposal, postMention, saveMentionSettings, setConversationAssistantReplies,
  withdrawMentionReply, type ConfirmProposal,
} from "@/server/services/mentions";
import { processMention } from "@/server/services/mention-processor";
import { readMentionThread } from "@/server/services/catch-up";
import { answerMention, type SharedScope } from "@/server/services/copilot";
import { plainReply, shortReply } from "@/server/services/copilot-excerpt";
import { MENTION_LIMITS } from "@/lib/mentions";
import type { AssistantConnection } from "@/server/services/assistant";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let ada: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext;
let design: string, launch: string;

const NO_MODEL = { useModel: false } as const;
const FAKE: AssistantConnection = { apiKey: "test-key-not-real", model: "claude-test", source: "environment" };
const org = () => a.ownerCtx.org.id;
const id = (c: OrgContext) => c.membership.id;
const MAX = { kind: "assistant" as const, label: "@Max" };
const person = (c: OrgContext) => ({ kind: "person" as const, membershipId: id(c), label: `@${c.user.displayName}` });
const send = (c: OrgContext, conversationId: string, body: string, mentions?: SendInput["mentions"]) =>
  sendMessage(c, { conversationId, body, mentions }, { startMention: false });
const row = async (mid: string) => (await adminQuery<Record<string, unknown>>("SELECT * FROM assistant_mentions WHERE id = $1", [mid]))[0];
const notes = (c: OrgContext, type: string) =>
  adminQuery<{ title: string; body: string | null; href: string | null }>("SELECT title, body, href FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [id(c), type]);
const viewIn = async (c: OrgContext, conv: string, mentionId: string) => (await thread(c, conv))!.mentions.find((m) => m.id === mentionId);
const tool = (name: string, input: Record<string, unknown>, n = 1) => ({
  content: [{ type: "tool_use", id: `tu_${name}_${n}`, name, input }], stop_reason: "tool_use", model: "claude-test",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const say = (text: string) => ({
  content: [{ type: "text", text }], stop_reason: "end_turn", model: "claude-test",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

/**
 * The model's path, as the processor runs it: claim, read the thread as the tagger, answer with the scripted model, then
 * the processor's completion (plain text, shortened when public; kept for the tagger with its Confirm cards otherwise).
 */
async function answerWithModel(mentionId: string, script: Record<string, unknown>[]) {
  model.script = [...script];
  const job = await claimMention(mentionId);
  expect(job).not.toBeNull();
  const t = (await readMentionThread(job!.ctx, { conversationId: job!.conversationId, messageId: job!.messageId }))!;
  const scope: SharedScope = { conversationId: job!.conversationId, mentionId, exposure: "public", reasons: [] };
  const answer = await answerMention(job!.ctx, { conn: FAKE, scope, thread: t, conversation: job!.conversation, assistant: job!.assistant });
  const text = plainReply(answer.text);
  const status = answer.exposure === "public" && !answer.proposals.length
    ? await completeMentionPublic(mentionId, { text: shortReply(text).text, fullText: shortReply(text).truncated ? text : null, noteCode: answer.noteCode, engine: answer.engine })
    : await completeMentionPrivate(mentionId, { text: text || null, noteCode: answer.noteCode, proposals: answer.proposals as ConfirmProposal[], engine: answer.engine });
  return { answer, status };
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  ada = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(olu, a.teamId);
  launch = (await createChannel(olu, { title: "launch", memberIds: [id(ben)] })).id;
});

beforeEach(async () => {
  model.script = []; model.calls = 0;
  await adminQuery(`UPDATE assistant_mentions SET status = 'failed', lease_until = NULL WHERE status IN ('pending', 'thinking')`);
  await adminQuery(`UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE started_at > now() - interval '2 days'`);
});

describe("a public answer", () => {
  it("built-in: Olu asks Max who's here and mentions Ben; Ben sees Max's reply under her message and gets the mention", async () => {
    const sent = await send(olu, design, "@Max who's here? @Ben Okafor fyi", [MAX, person(ben)]);
    expect(sent.mentionId).toBeTruthy();
    expect(sent.mentioned).toEqual([id(ben)]);
    // Before the run: everyone sees "Max is thinking…", nobody but Olu any private part.
    const before = await viewIn(ben, design, sent.mentionId!);
    expect(before).toMatchObject({ status: "pending", thinking: true, private: null, tagger: { isYou: false, firstName: "Olu" } });
    expect(before!.assistant.name).toBe("Max");

    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("answered");
    const r = await row(sent.mentionId!);
    const benThread = (await thread(ben, design))!;
    const reply = benThread.messages.find((m) => m.id === r.reply_message_id)!;
    expect(reply).toMatchObject({ author_kind: "assistant", sender_membership_id: id(olu), reply_to_id: sent.id, mentions: [] });
    expect(reply.body).toContain("Ben Okafor");
    expect(reply.mention_reply).toEqual({ mentionId: sent.mentionId, canWithdraw: false });
    expect(benThread.mentions.find((m) => m.id === sent.mentionId)).toMatchObject({ status: "answered", thinking: false, waiting: false, private: null });
    // Ben's mention notification; Olu's "Max replied in #…".
    expect(await notes(ben, "message.mention")).toEqual([expect.objectContaining({ title: expect.stringMatching(/^Olu Adeyemi mentioned you in #/), href: expect.stringContaining(`#m-${sent.id}`) })]);
    expect((await notes(olu, "brenda.mention_reply")).at(-1)).toMatchObject({ title: expect.stringMatching(/^Max replied in #/) });
    // Olu may withdraw her assistant's reply; the thread says so for her.
    expect((await thread(olu, design))!.messages.find((m) => m.id === r.reply_message_id)!.mention_reply).toEqual({ mentionId: sent.mentionId, canWithdraw: true });
  });

  it("model: a task every reader can view stays public; Markdown and links come out plain; a long answer is shortened with the full text kept for Olu", async () => {
    const sent = await send(olu, design, "@Max where are we on the homepage?", [MAX]);
    const long = [
      "**Homepage design** is in progress, assigned to Olu Adeyemi, due this week.",
      ...Array.from({ length: 8 }, (_, i) => `- Step ${i + 1}: see [the task](/tasks/${a.taskIds.homepage}) and https://evil.example/${i}`),
    ].join("\n");
    const { answer, status } = await answerWithModel(sent.mentionId!, [tool("get_task", { taskId: a.taskIds.homepage }), say(long)]);
    expect(answer).toMatchObject({ exposure: "public", engine: "claude", proposals: [] });
    expect(status).toBe("answered");
    const r = await row(sent.mentionId!);
    const body = (await adminQuery<{ body: string }>("SELECT body FROM messages WHERE id = $1", [r.reply_message_id]))[0].body;
    expect(body.length).toBeLessThanOrEqual(MENTION_LIMITS.publicChars + 1);
    expect(body.split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(MENTION_LIMITS.publicLines);
    expect(body).not.toMatch(/\*\*|\]\(/);
    expect(body.startsWith("Homepage design is in progress")).toBe(true);
    // The full text is Olu's alone ("Read the full answer"); Ben's view of the same mention has no private part.
    expect((await viewIn(olu, design, sent.mentionId!))!.private).toMatchObject({ kind: "full_answer", canPost: false });
    expect((await viewIn(olu, design, sent.mentionId!))!.private!.text).toContain("Step 8");
    expect((await viewIn(ben, design, sent.mentionId!))!.private).toBeNull();
    // One mention is one request in Olu's ledger, however many model calls it took.
    expect((await adminQuery<{ n: number }>("SELECT count(DISTINCT request_id)::int AS n FROM ai_usage WHERE purpose = 'mention' AND request_id = $1", [sent.mentionId]))[0].n).toBe(1);
  });
});

describe("a private answer", () => {
  it("model: attendance makes it private; Ben sees nothing; Olu posts it and it becomes her message through Max, exactly that text", async () => {
    const sent = await send(olu, design, "@Max is everyone in today?", [MAX]);
    const { answer, status } = await answerWithModel(sent.mentionId!, [tool("get_attendance", {}), say("Everyone on Design is in except Ben.")]);
    expect(answer.exposure).toBe("private");
    expect(answer.reasons).toContain("get_attendance");
    expect(status).toBe("private");
    const r = await row(sent.mentionId!);
    expect(r.reply_message_id).toBeNull();
    expect((await viewIn(ben, design, sent.mentionId!))).toMatchObject({ status: "private", thinking: false, private: null });
    const mine = (await viewIn(olu, design, sent.mentionId!))!.private!;
    expect(mine).toMatchObject({ kind: "answer", text: "Everyone on Design is in except Ben.", canPost: true });
    expect((await notes(olu, "brenda.mention_private")).at(-1)).toMatchObject({ body: "Only visible to you. Everyone on Design is in except Ben." });

    const before = (await thread(ben, design))!.messages.length;
    const { messageId } = await postMention(olu, sent.mentionId!);
    const posted = (await thread(ben, design))!.messages;
    expect(posted.length).toBe(before + 1);
    expect(posted.find((m) => m.id === messageId)).toMatchObject({ author_kind: "via_assistant", sender_membership_id: id(olu), body: mine.text, reply_to_id: sent.id, mentions: [] });
    expect((await viewIn(olu, design, sent.mentionId!))!.private).toMatchObject({ postedMessageId: messageId, canPost: false });
    await expect(postMention(olu, sent.mentionId!)).rejects.toMatchObject({ status: 409 });
    await expect(postMention(ben, sent.mentionId!)).rejects.toMatchObject({ status: 404 });
  });
});

describe("an action", () => {
  it("model: \"remind me\" only prepares a Confirm for Olu; others see that she must confirm; only Olu's press runs it, once", async () => {
    const sent = await send(olu, design, "@Max remind me at 3 to call Ben", [MAX]);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const reminders = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [id(olu)]))[0].n;
    const before = await reminders();
    const { answer, status } = await answerWithModel(sent.mentionId!, [tool("remind_me", { body: "Call Ben", at }), say("I'll remind you to call Ben once you confirm.")]);
    expect(answer.exposure).toBe("private");
    expect(answer.proposals).toHaveLength(1);
    expect(status).toBe("waiting_confirm");
    expect(await reminders()).toBe(before);

    // Ben and David: "Waiting for Olu to confirm", and no card, no token, no words.
    for (const c of [ben, david]) expect(await viewIn(c, design, sent.mentionId!)).toMatchObject({ status: "waiting_confirm", waiting: true, private: null });
    const card = (await viewIn(olu, design, sent.mentionId!))!.private!;
    expect(card.proposals).toEqual([expect.objectContaining({ index: 0, tool: "remind_me", state: "open", summary: expect.stringMatching(/^Remind you .*: Call Ben$/) })]);
    expect(JSON.stringify(card)).not.toMatch(/token/i);
    expect((await notes(olu, "brenda.mention_confirm")).at(-1)).toMatchObject({ title: expect.stringMatching(/^Max needs you to confirm in #/) });

    await expect(decideMentionProposal(david, sent.mentionId!, 0, "confirm")).rejects.toMatchObject({ status: 404 });
    await expect(decideMentionProposal(ben, sent.mentionId!, 0, "confirm")).rejects.toMatchObject({ status: 404 });
    const done = await decideMentionProposal(olu, sent.mentionId!, 0, "confirm");
    expect(done.error).toBeNull();
    expect(done.proposal.state).toBe("done");
    expect(await reminders()).toBe(before + 1);
    await expect(decideMentionProposal(olu, sent.mentionId!, 0, "confirm")).rejects.toMatchObject({ status: 409 });
    expect(await reminders()).toBe(before + 1);
    expect((await row(sent.mentionId!)).status).toBe("private");
  });
});

describe("withdrawing a reply", () => {
  it("Ben cannot; David, who leads the team, can; the reply is gone for everyone and the mention reads withdrawn", async () => {
    const sent = await send(olu, design, "@Max who's here?", [MAX]);
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("answered");
    const replyId = (await row(sent.mentionId!)).reply_message_id as string;
    await expect(withdrawMentionReply(ben, sent.mentionId!)).rejects.toMatchObject({ status: 403 });
    await withdrawMentionReply(david, sent.mentionId!);
    const reply = (await thread(ben, design))!.messages.find((m) => m.id === replyId)!;
    expect(reply.deleted_at).toBeTruthy();
    expect(reply.mention_reply).toBeNull();
    expect((await viewIn(olu, design, sent.mentionId!))!.status).toBe("withdrawn");
    await expect(withdrawMentionReply(olu, sent.mentionId!)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the switches", () => {
  it("off here or for the workspace: nothing posted, Olu alone gets the note; back on, it answers again", async () => {
    await setConversationAssistantReplies(olu, launch, false);
    const here = await send(olu, launch, "@Max who's here?", [MAX]);
    expect(await processMention(here.mentionId!, NO_MODEL)).toBe("refused");
    expect((await viewIn(olu, launch, here.mentionId!))!.private!.note).toEqual({ code: "off_conversation", words: "Assistants can't reply in this conversation. Ask Max in your own chat instead." });
    expect((await viewIn(ben, launch, here.mentionId!))!.private).toBeNull();
    expect((await thread(olu, launch))!.assistantReplies).toMatchObject({ ready: true, here: false, canChange: true });
    await setConversationAssistantReplies(olu, launch, true);

    await saveMentionSettings(ada, { enabled: false });
    const workspace = await send(olu, launch, "@Max who's here?", [MAX]);
    expect(await processMention(workspace.mentionId!, NO_MODEL)).toBe("refused");
    expect((await viewIn(olu, launch, workspace.mentionId!))!.private!.note!.code).toBe("off_workspace");
    await saveMentionSettings(ada, { enabled: true });

    const again = await send(olu, launch, "@Max who's here?", [MAX]);
    expect(await processMention(again.mentionId!, NO_MODEL)).toBe("answered");
    expect(await adminQuery("SELECT 1 FROM messages WHERE reply_to_id = ANY($1::uuid[]) AND author_kind = 'assistant'", [[here.id, workspace.id]])).toEqual([]);
  });
});

describe("the limits", () => {
  it("past the per-minute limit the next mention is refused privately, and nothing is posted", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MENTION_LIMITS.perTaggerPerMinute; i++) {
      const s = await send(olu, launch, `@Max who's here? (${i})`, [MAX]);
      expect(await processMention(s.mentionId!, NO_MODEL)).toBe("answered");
      ids.push(s.mentionId!);
    }
    const over = await send(olu, launch, "@Max who's here? (one too many)", [MAX]);
    expect(await processMention(over.mentionId!, NO_MODEL)).toBe("refused");
    expect((await viewIn(olu, launch, over.mentionId!))!.private!.note!.code).toBe("limit_minute");
    expect((await row(over.mentionId!)).reply_message_id).toBeNull();
  });
});

describe("mentioning people", () => {
  it("only someone who reads the conversation is stored and notified; David is not in #launch", async () => {
    const sent = await send(olu, launch, "@Ben Okafor and @David Manager, see this", [person(ben), person(david)]);
    expect(sent.mentioned).toEqual([id(ben)]);
    expect(sent.mentionId).toBeNull();
    expect((await thread(ben, launch))!.messages.find((m) => m.id === sent.id)!.mentions).toEqual([{ kind: "person", membershipId: id(ben), label: "@Ben Okafor" }]);
    expect((await notes(ben, "message.mention")).at(-1)).toMatchObject({ title: "Olu Adeyemi mentioned you in #launch" });
    expect(await adminQuery("SELECT 1 FROM notifications WHERE recipient_membership_id = $1 AND type = 'message.mention' AND href LIKE $2", [id(david), `%${sent.id}%`])).toEqual([]);
    // Withdrawn, the message no longer says whom it named.
    await withdrawMessage(olu, sent.id);
    expect((await thread(ben, launch))!.messages.find((m) => m.id === sent.id)!.mentions).toEqual([]);
  });

  it("Ben can't make Olu's assistant answer, nor tag 'Max' as his own", async () => {
    const sent = await send(ben, launch, "@Max what's Olu doing?", [MAX]);
    expect(sent.mentionId).toBeNull();
    expect((await thread(olu, launch))!.messages.find((m) => m.id === sent.id)!.mentions).toEqual([]);
  });
});

describe("no loops", () => {
  it("a reply that says \"@Max\" and \"@Ben Okafor\" starts nothing and notifies nobody; a posted answer carries no mentions", async () => {
    const sent = await send(olu, design, "@Max is everyone in today?", [MAX]);
    await answerWithModel(sent.mentionId!, [say("Ask @Max again later, or @Ben Okafor.")]);
    const r = await row(sent.mentionId!);
    expect(r.status).toBe("answered");
    const queued = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM assistant_mentions WHERE organisation_id = $1", [org()]))[0].n;
    const mentionsOf = (msg: unknown) => adminQuery("SELECT 1 FROM message_mentions WHERE message_id = $1", [msg]);
    expect(await mentionsOf(r.reply_message_id)).toEqual([]);
    expect(await adminQuery("SELECT 1 FROM notifications WHERE type = 'message.mention' AND href LIKE $1", [`%${r.reply_message_id}%`])).toEqual([]);
    const n = await queued();
    // Running it again, from anywhere, does nothing more.
    expect(await processMention(sent.mentionId!, NO_MODEL)).toBe("answered");
    expect(await queued()).toBe(n);
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE reply_to_id = $1", [sent.id]))[0].n).toBe(1);
    expect(model.calls).toBe(1);
  });
});
