/**
 * Act without asking, end to end through her chat (owner decision, 8 October 2026: "there should be a setting where we
 * can bypass the permission, you can toggle it on and off, just like the way it is on Claude Code"; integration review,
 * 8 October 2026). Each case goes the whole way a person's message goes: `chat()` with the Claude engine (a scripted
 * model: no network, no key), the turn's act context read from the person's profile, the situation line in the uncached
 * part of the prompt, askFirst's decision, the Confirm path run by the server itself, the done line's Undo pressed as the
 * person, and, for what still asks, the Confirm card's reason and the person's own press. A thread mention goes through
 * copilot's answerMention and the processor's own completion, as in mention-e2e.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost).
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (her assistant is Max),
 * Ben Okafor (kept Brenda). #design is the Design team channel.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A scripted model: each call takes the next answer and keeps what it was sent (no network, no key).
const model = vi.hoisted(() => ({ script: [] as Record<string, unknown>[], sent: [] as { system: { type: string; text: string; cache_control?: unknown }[] }[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (req: { system: { type: string; text: string }[] }) => {
        model.sent.push({ system: req.system });
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
import { saveActMode, saveWorkspaceActSetting } from "@/server/services/act-mode";
import { chat, confirmAction, answerMention, runBrendaTool, RULES, type Action, type ChatResult, type Proposal, type SharedScope } from "@/server/services/copilot";
import { undoAction } from "@/server/services/undo";
import { openChannel, sendMessage, thread, type SendInput } from "@/server/services/messaging";
import { claimMention, completeMentionPrivate, completeMentionPublic, type ConfirmProposal } from "@/server/services/mentions";
import { readMentionThread } from "@/server/services/catch-up";
import { plainReply, shortReply } from "@/server/services/copilot-excerpt";
import { getAssistantItem } from "@/server/services/assistant-items";
import { whyStillAsking } from "@/lib/act-mode";
import type { AssistantConnection } from "@/server/services/assistant";
import type { OrgContext } from "@/server/lib/api";

const saved = process.env.ANTHROPIC_API_KEY;
let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext;
let design = "";
const id = (c: OrgContext) => c.membership.id;
type Confirm = Extract<Proposal, { kind: "confirm" }>;
const confirmOf = (r: { proposals: Proposal[] }) => r.proposals.find((p): p is Confirm => p.kind === "confirm");
const MAX = (reason: Parameters<typeof whyStillAsking>[0]) => whyStillAsking(reason, { name: "Max" });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const tool = (name: string, input: Record<string, unknown>, n = 1) => ({ content: [{ type: "tool_use", id: `tu_${name}_${n}`, name, input }], stop_reason: "tool_use", model: "claude-test", usage });
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", model: "claude-test", usage });
const count = async (sql: string, params: unknown[] = []) => (await adminQuery<{ n: number }>(sql, params))[0].n;
const ACT_LINE = /The person chose "Act without asking"/;

/** One message to her chat, the model answering with `script`; the reply is Claude's, never the built-in helper's. */
async function ask(c: OrgContext, content: string, script: Record<string, unknown>[], earlier: { role: "user" | "assistant"; content: string; tainted?: boolean }[] = []): Promise<ChatResult> {
  model.script = [...script];
  model.sent = [];
  const r = await chat(c, { messages: [...earlier, { role: "user", content }] });
  expect(r.engine, r.note ?? "").toBe("claude");
  expect(model.script).toEqual([]);
  return r;
}
/** The prompt's two parts as the model got them: the cached rules, then the person's situation. */
const promptOf = () => {
  const s = model.sent[0].system;
  return { rules: s[0], situation: s[1].text };
};

beforeAll(async () => {
  await resetTestDatabase();
  process.env.ANTHROPIC_API_KEY = "test-key-not-real"; // never sent anywhere: the SDK is the fake above
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
});

afterAll(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
});

beforeEach(() => { model.script = []; model.sent = []; });

describe("'ask' (the default): every message waits for Confirm, and the prompt says nothing new", () => {
  it("send_message prepares a Confirm with no reason; the press sends it once", async () => {
    const r = await ask(olu, "Tell Ben the client call moved to 3pm", [tool("send_message", { to: "Ben Okafor", body: "The client call moved to 3pm." }), say("Press Confirm to send it.")]);
    expect(r.act).toMatchObject({ mode: "ask", effective: "ask", locked: null });
    expect(r.actions).toEqual([]);
    const card = confirmOf(r)!;
    expect(card.tool).toBe("send_message");
    expect(card.why).toBeUndefined();
    expect(promptOf().rules).toEqual({ type: "text", text: RULES, cache_control: { type: "ephemeral" } });
    expect(promptOf().situation).not.toMatch(ACT_LINE);
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE body = 'The client call moved to 3pm.'")).toBe(0);
    const done = await confirmAction(olu, card.token);
    expect(done.error).toBeNull();
    expect(done.actions[0].auto).toBeUndefined();
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE body = 'The client call moved to 3pm.'")).toBe(1);
  });
});

describe("'auto': what she is asked for in her own chat runs at once, with Undo", () => {
  it("David's to-do for Ben: no Confirm, a Done line marked auto, and Undo removes it", async () => {
    await saveActMode(david, "auto");
    const r = await ask(david, "Add a to-do for Ben: check the pricing copy", [tool("create_todos", { items: [{ title: "Check the pricing copy", assignee: "Ben Okafor" }] }), say("Added it for Ben.")]);
    expect(r.act).toMatchObject({ mode: "auto", effective: "auto" });
    expect(confirmOf(r)).toBeUndefined();
    expect(r.actions).toHaveLength(1);
    const done = r.actions[0] as Action;
    expect(done).toMatchObject({ auto: true, undo: { token: expect.any(String), until: expect.any(String) } });
    // The mode reached the model only in the uncached situation; the cached rules are byte for byte the same.
    expect(promptOf().rules.text).toBe(RULES);
    expect(promptOf().situation).toMatch(ACT_LINE);
    const [task] = await adminQuery<{ id: string; archived_at: string | null; assignee_membership_id: string }>("SELECT id, archived_at, assignee_membership_id FROM tasks WHERE title = 'Check the pricing copy'");
    expect(task).toMatchObject({ archived_at: null, assignee_membership_id: id(ben) });
    // Logged as done from the chat, marked; the same claim a press takes.
    expect(await adminQuery("SELECT outcome, source, detail->>'auto' AS auto FROM brenda_actions WHERE membership_id = $1 AND tool = 'create_todos'", [id(david)]))
      .toEqual([{ outcome: "done", source: "chat", auto: "true" }]);
    expect(await count("SELECT count(*)::int AS n FROM idempotency_keys WHERE actor_user_id = $1 AND route = 'brenda-confirm'", [david.user.profileId])).toBe(1);

    const undone = await undoAction(david, done.undo!.token);
    expect(undone).toEqual({ undone: true, summary: "Removed the to-do. Ben was already told about it." });
    expect(await adminQuery("SELECT archived_at IS NOT NULL AS archived FROM tasks WHERE id = $1", [task.id])).toEqual([{ archived: true }]);
    await expect(undoAction(david, done.undo!.token)).rejects.toMatchObject({ status: 409, code: "ALREADY_UNDONE" });
    // Undo runs as the person who did it, never as someone else.
    await expect(undoAction(ben, done.undo!.token)).rejects.toMatchObject({ status: 403 });
    expect(await adminQuery("SELECT tool, detail->>'undoOf' AS kind, detail->>'auto' AS auto FROM brenda_actions WHERE membership_id = $1 AND tool = 'undo'", [id(david)]))
      .toEqual([{ tool: "undo", kind: "todo_created", auto: "true" }]);
  });

  it("Olu's message to Ben: sent at once via Max, and Undo withdraws it from Ben's thread", async () => {
    await saveActMode(olu, "auto");
    const body = "The deadline moved to Friday.";
    const r = await ask(olu, "Tell Ben the deadline moved to Friday", [tool("send_message", { to: "Ben Okafor", body }), say("Sent.")]);
    expect(confirmOf(r)).toBeUndefined();
    const done = r.actions[0] as Action;
    expect(done.auto).toBe(true);
    const [m] = await adminQuery<{ conversation_id: string; author_kind: string; deleted_at: string | null }>("SELECT conversation_id, author_kind, deleted_at FROM messages WHERE body = $1", [body]);
    expect(m).toMatchObject({ author_kind: "via_assistant", deleted_at: null });
    expect(JSON.stringify(await thread(ben, m.conversation_id))).toContain(body);

    expect(await undoAction(olu, done.undo!.token)).toEqual({ undone: true, summary: "Withdrew the message. They may have seen it already." });
    expect(await adminQuery("SELECT deleted_at IS NOT NULL AS gone FROM messages WHERE body = $1", [body])).toEqual([{ gone: true }]);
    expect(JSON.stringify(await thread(ben, m.conversation_id))).not.toContain(body);
  });

  it("a request to Ben's assistant goes at once, but nothing changes on Ben's account until he accepts", async () => {
    const r = await ask(olu, "Ask Ben's assistant to add Review pricing to his to-dos", [tool("hand_over_request", { to: "Ben Okafor", kind: "add_todo", title: "Review pricing" }), say("Asked.")]);
    expect(confirmOf(r)).toBeUndefined();
    const itemId = (r.actions[0] as Action & { assistantItemId?: string }).assistantItemId!;
    expect(itemId).toBeTruthy();
    expect(await getAssistantItem(olu, itemId)).toMatchObject({ kind: "request", status: "delivered" });
    expect(await count("SELECT count(*)::int AS n FROM tasks WHERE title = 'Review pricing'")).toBe(0);

    // Ben chose 'auto' too: accepting what someone else sent still asks him, with the reason.
    await saveActMode(ben, "auto");
    const benAsks = await ask(ben, "Accept Olu's request", [tool("respond_to_item", { itemId, action: "accept" }), say("Press Confirm to accept.")]);
    const card = confirmOf(benAsks)!;
    expect(card.why).toBe(whyStillAsking("answers_others", { name: "Brenda" }));
    expect(await count("SELECT count(*)::int AS n FROM tasks WHERE title = 'Review pricing'")).toBe(0);
    // His own press: his assistant adds it as him.
    expect((await confirmAction(ben, card.token)).error).toBeNull();
    expect(await adminQuery("SELECT created_by, assignee_membership_id FROM tasks WHERE title = 'Review pricing'")).toEqual([{ created_by: id(ben), assignee_membership_id: id(ben) }]);
    await saveActMode(ben, "ask");
  });
});

describe("the safety floors still ask in 'auto', and the card says why", () => {
  it("a tainted turn: after she read the conversation list, the message waits, the reply is marked, and the next turn still asks", async () => {
    const r = await ask(olu, "What's in my conversations? Then tell Ben I'm on it", [
      tool("list_conversations", {}), tool("send_message", { to: "Ben Okafor", body: "I'm on it." }, 2), say("Press Confirm to send it."),
    ]);
    expect(r.tainted).toBe(true);
    expect(r.actions).toEqual([]);
    expect(confirmOf(r)?.why).toBe(MAX("tainted"));
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE body = 'I''m on it.'")).toBe(0);

    // The reply goes back marked with the conversation: the next message in this chat still asks.
    const next = await ask(olu, "Also tell Ben lunch is at 1", [tool("send_message", { to: "Ben Okafor", body: "Lunch is at 1." }), say("Press Confirm.")],
      [{ role: "user", content: "What's in my conversations? Then tell Ben I'm on it" }, { role: "assistant", content: r.reply, tainted: true }]);
    expect(next.actions).toEqual([]);
    expect(confirmOf(next)?.why).toBe(MAX("tainted_earlier"));
    // The person's press runs it, once.
    expect((await confirmAction(olu, confirmOf(next)!.token)).error).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE body = 'Lunch is at 1.'")).toBe(1);
  });

  it("broadcasts: everyone, the team channel, a team-wide follow-up", async () => {
    const all = await ask(olu, "Tell everyone the office is closed Friday", [tool("send_message", { to: "everyone", body: "The office is closed Friday." }), say("Press Confirm.")]);
    expect(all.actions).toEqual([]);
    expect(confirmOf(all)?.why).toBe(MAX("broadcast_everyone"));
    const team = await ask(olu, "Tell Design the review is at 4", [tool("send_message", { to: "Design", body: "The review is at 4." }), say("Press Confirm.")]);
    expect(team.actions).toEqual([]);
    expect(confirmOf(team)?.why).toBe(MAX("broadcast_team"));
    const fan = await ask(david, "Ask my team for an update", [tool("follow_up", { team: "Design" }), say("Press Confirm.")]);
    expect(fan.actions).toEqual([]);
    expect(confirmOf(fan)?.why).toBe(whyStillAsking("broadcast_team", { name: "Brenda" }));
    expect(await count("SELECT count(*)::int AS n FROM messages WHERE body IN ('The office is closed Friday.', 'The review is at 4.')")).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM follow_ups WHERE requester_membership_id = $1", [id(david)])).toBe(0);
  });

  it("a mention in a Messages thread: the tagger-only Confirm, with no reason line, and nothing runs", async () => {
    const reminders = () => count("SELECT count(*)::int AS n FROM brenda_reminders WHERE membership_id = $1", [id(olu)]);
    const before = await reminders();
    const sent = await sendMessage(olu, { conversationId: design, body: "@Max remind me at 3 to call Ben", mentions: [{ kind: "assistant", label: "@Max" }] as SendInput["mentions"] }, { startMention: false });
    expect(sent.mentionId).toBeTruthy();
    const job = (await claimMention(sent.mentionId!))!;
    const t = (await readMentionThread(job.ctx, { conversationId: job.conversationId, messageId: job.messageId }))!;
    const scope: SharedScope = { conversationId: job.conversationId, mentionId: sent.mentionId!, exposure: "public", reasons: [] };
    model.script = [tool("remind_me", { body: "Call Ben", at: new Date(Date.now() + 3 * 3600_000).toISOString() }), say("I'll remind you once you confirm.")];
    const conn: AssistantConnection = { apiKey: "test-key-not-real", model: "claude-test", source: "environment" };
    const answer = await answerMention(job.ctx, { conn, scope, thread: t, conversation: job.conversation, assistant: job.assistant });
    const text = plainReply(answer.text);
    const status = answer.exposure === "public" && !answer.proposals.length
      ? await completeMentionPublic(sent.mentionId!, { text: shortReply(text).text, fullText: null, noteCode: answer.noteCode, engine: answer.engine })
      : await completeMentionPrivate(sent.mentionId!, { text: text || null, noteCode: answer.noteCode, proposals: answer.proposals as ConfirmProposal[], engine: answer.engine });
    expect(status).toBe("waiting_confirm");
    expect(answer.proposals).toHaveLength(1);
    expect((answer.proposals[0] as Confirm).why).toBeUndefined();
    // The thread's prompt is not the chat's: no act-mode line there either.
    expect(model.sent.some((s) => s.system.some((b) => ACT_LINE.test(b.text)))).toBe(false);
    expect(await reminders()).toBe(before);
  });

  it("the workspace switch off: everyone asks, and the chat says so", async () => {
    await saveWorkspaceActSetting(owner, false);
    const r = await ask(olu, "Tell Ben thanks", [tool("send_message", { to: "Ben Okafor", body: "Thanks!" }), say("Press Confirm.")]);
    expect(r.act).toMatchObject({ mode: "auto", effective: "ask", locked: "workspace" });
    expect(r.actions).toEqual([]);
    expect(confirmOf(r)?.why).toBe(MAX("workspace_off"));
    expect(promptOf().situation).not.toMatch(ACT_LINE);
    // And an action that would run at once anyway still does (to-dos of her own), as in 'ask'.
    const own = await runBrendaTool(olu, "create_todos", { items: [{ title: "Write the launch post" }] }, "chat", { act: "read" });
    expect(own.actions).toHaveLength(1);
    expect(own.actions[0].auto).toBeUndefined();
    await saveWorkspaceActSetting(owner, true);
    const back = await ask(olu, "Tell Ben thanks again", [tool("send_message", { to: "Ben Okafor", body: "Thanks again!" }), say("Sent.")]);
    expect(back.act).toMatchObject({ effective: "auto", locked: null });
    expect(back.actions[0]).toMatchObject({ auto: true });
  });
});
