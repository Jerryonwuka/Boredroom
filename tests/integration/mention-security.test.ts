/**
 * Security review of @mentions in Messages (personal assistants, phase 5): the audience rule's edges. Each case here
 * was a way a PUBLIC assistant reply could carry something not every current reader of the conversation can see, or a
 * way mention notifications could be abused; each now checks the fix (fixer pass, 8 October 2026). They run against the local test database only and never call the model
 * (shared-mode tools through runBrendaTool, and the built-in helper with `useModel: false`).
 *
 * Company A: Ada Owner (owner), Mary HR, David Manager (leads Design: Olu and Ben), Olu Adeyemi (her assistant is Max),
 * Ben Okafor, and Ifeoma Nwosu (staff, no team, no project).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { quickTodo } from "@/server/services/tasks";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { createChannel, openChannel, openDirect, sendMessage, setConversationPrefs, thread } from "@/server/services/messaging";
import { claimMention, completeMentionPrivate, completeMentionPublic, getMention, mentionReaders, postMention, withdrawMentionReply } from "@/server/services/mentions";
import { readMentionThread } from "@/server/services/catch-up";
import { answerMention, runBrendaTool, type SharedScope } from "@/server/services/copilot";
import { plainReply } from "@/server/services/copilot-excerpt";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let olu: OrgContext, ben: OrgContext, mary: OrgContext, ifeoma: OrgContext;
let design: string, everyone: string, oluBen: string;
let secretTodo: string;
const SECRET = "Interview at Rivalco Friday";

const id = (c: OrgContext) => c.membership.id;
const tool = (c: OrgContext, conv: string, name: string, input: Record<string, unknown> = {}) => runBrendaTool(c, name, input, "chat", { shared: { conversationId: conv } });

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Ada Owner", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  await buildCompany("b");
  olu = a.employeeCtx; ben = a.employee2Ctx; mary = a.hrCtx;
  ifeoma = await joinViaInvitation(mary, await createVerifiedUser("ifeoma@company-a.test", "Ifeoma Nwosu"), "employee", null, "EMP-003");
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(olu, a.teamId);
  everyone = await openChannel(olu, null);
  oluBen = await openDirect(olu, id(ben));
  // Olu's own to-do: Ben cannot view it (David, her lead, can).
  secretTodo = (await quickTodo(olu, { title: SECRET })).id;
});

describe("a message's attached task inside read_conversation / search_messages", () => {
  // Everyone: Ifeoma (no team, no project) reads it but cannot view the Homepage design task Olu attaches there.
  it("Ifeoma does not see the task on Olu's message in Everyone", async () => {
    const sent = await sendMessage(olu, { conversationId: everyone, body: "Booked the afternoon off", taskId: a.taskIds.homepage }, { startMention: false });
    const seen = (await thread(ifeoma, everyone))!.messages.find((m) => m.id === sent.id)!;
    expect(seen.task_title).toBeNull();
    expect(await appQueryAs(ifeoma.user.profileId, "SELECT 1 FROM tasks WHERE id = $1", [a.taskIds.homepage])).toEqual([]);
    // The audience rule knows it: the task alone is private in Everyone.
    expect((await tool(olu, everyone, "get_task", { taskId: a.taskIds.homepage })).exposure).toBe("private");
  });

  it("read_conversation of this very conversation stays public and leaves the hidden task out", async () => {
    const r = await tool(olu, everyone, "read_conversation", { conversation: everyone, mode: "last", last: 10 });
    expect(r.exposure).toBe("public");
    expect(JSON.stringify(r.out)).toContain("Booked the afternoon off");
    expect(JSON.stringify(r.out)).not.toContain("Homepage design");
  });

  it("search_messages leaves the hidden task out of its results", async () => {
    const r = await tool(olu, everyone, "search_messages", { q: "afternoon off" });
    expect(r.exposure).toBe("public");
    expect(JSON.stringify(r.out)).toContain("Booked the afternoon off");
    expect(JSON.stringify(r.out)).not.toContain("Homepage design");
  });

  it("an own to-do (never public in a thread) is left out the same way", async () => {
    await sendMessage(olu, { conversationId: design, body: "Out on Friday", taskId: secretTodo }, { startMention: false });
    expect((await tool(olu, design, "get_task", { taskId: secretTodo })).exposure).toBe("private");
    const r = await tool(olu, design, "read_conversation", { conversation: design, mode: "last", last: 10 });
    expect(r.exposure).toBe("public");
    expect(JSON.stringify(r.out)).not.toContain(SECRET);
    // In her own chat the task is still named (only the thread is filtered).
    const own = await runBrendaTool(olu, "read_conversation", { conversation: design, mode: "last", last: 10 }, "chat");
    expect(JSON.stringify(own.out)).toContain(SECRET);
  });

  it("a task every reader can see stays named", async () => {
    // #design: Olu, Ben and David all see the Homepage design task (their project).
    await sendMessage(olu, { conversationId: design, body: "Hero images ready", taskId: a.taskIds.homepage }, { startMention: false });
    const r = await tool(olu, design, "read_conversation", { conversation: design, mode: "last", last: 10 });
    expect(r.exposure).toBe("public");
    expect(JSON.stringify(r.out)).toContain("Homepage design");
  });
});

describe("search_messages' total in a thread", () => {
  it("is left out: it would count matches in conversations not every reader can see", async () => {
    // One older match in Olu's direct thread with Ben (Ifeoma and David cannot read it), then 30 newer in Everyone.
    await sendMessage(olu, { conversationId: oluBen, body: "quokka plan: the layoffs list" }, { startMention: false });
    for (let i = 0; i < 30; i++) await sendMessage(ben, { conversationId: everyone, body: `quokka sighting ${i}` }, { startMention: false });
    const r = await tool(olu, everyone, "search_messages", { q: "quokka" });
    expect(r.exposure).toBe("public");
    const out = r.out as { total?: number; results: string };
    expect(out.total).toBeUndefined();
    expect(out.results).not.toContain("found=");
    expect(out.results).not.toContain("layoffs");
  });
});

describe("a reader who joins while the assistant works", () => {
  it("keeps the answer with the tagger: it was checked against the readers when the run started", async () => {
    const launch = (await createChannel(olu, { title: "launch", memberIds: [id(ben)] })).id;
    const sent = await sendMessage(olu, { conversationId: launch, body: "@Max status of Homepage design", mentions: [{ kind: "assistant", label: "@Max" }] }, { startMention: false });
    const job = (await claimMention(sent.mentionId!))!;
    expect(job).toBeTruthy();
    const th = (await readMentionThread(job.ctx, { conversationId: launch, messageId: sent.id }))!;
    const readers = await mentionReaders(launch);
    const scope: SharedScope = { conversationId: launch, mentionId: job.id, exposure: "public", reasons: [] };
    const answer = await answerMention(job.ctx, { conn: null, scope, thread: th, conversation: job.conversation, assistant: job.assistant });
    // Every reader (Olu, the assignee; Ben, on the project) can view the task: public.
    expect(answer.exposure).toBe("public");
    expect(answer.text).toContain("Homepage design");
    // Meanwhile Ifeoma (no team, no project) is added to #launch by whoever runs it.
    await adminQuery("INSERT INTO conversation_participants(conversation_id, organisation_id, membership_id) VALUES ($1, $2, $3)", [launch, a.ownerCtx.org.id, id(ifeoma)]);
    expect(await completeMentionPublic(job.id, { text: plainReply(answer.text), fullText: null, noteCode: null, engine: "builtin", readers })).toBe("private");
    // Nothing was posted: Ifeoma reads no assistant reply; Olu has it privately.
    const hers = (await thread(ifeoma, launch))!.messages.find((m) => m.author_kind === "assistant");
    expect(hers).toBeUndefined();
    const oluView = (await thread(olu, launch))!.mentions.find((v) => v.id === job.id);
    expect(oluView?.private?.text).toContain("Homepage design");
    expect(await appQueryAs(ifeoma.user.profileId, "SELECT 1 FROM tasks WHERE id = $1", [a.taskIds.homepage])).toEqual([]);
  });
});

describe("mention notifications", () => {
  it("are throttled per sender and person (they still reach a muted conversation, as decided)", async () => {
    await setConversationPrefs(ben, everyone, { muted: true });
    const before = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'message.mention'", [id(ben)]))[0].n;
    for (let i = 0; i < 25; i++) {
      const r = await sendMessage(olu, { conversationId: everyone, body: `@Ben Okafor ping ${i}`, mentions: [{ kind: "person", membershipId: id(ben), label: "@Ben Okafor" }] }, { startMention: false });
      expect(r.mentioned).toEqual([id(ben)]);
    }
    const after = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'message.mention' AND read_at IS NULL", [id(ben)]))[0].n;
    expect(after - before).toBe(3);
  });
});

describe("the per-person limits under concurrency", () => {
  it("claims in different conversations take turns: no more than 5 a minute get through", async () => {
    // Nothing of Olu's counts yet this minute.
    await adminQuery("UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE tagger_membership_id = $1 AND started_at IS NOT NULL", [id(olu)]);
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const conv = (await createChannel(olu, { title: `burst ${i}`, memberIds: [id(ben)] })).id;
      const r = await sendMessage(olu, { conversationId: conv, body: "@Max who's here?", mentions: [{ kind: "assistant", label: "@Max" }] }, { startMention: false });
      ids.push(r.mentionId!);
    }
    // Warm the pool so every claim starts on an open connection at the same moment.
    const { withWorker } = await import("@/server/db");
    await Promise.all(ids.map(() => withWorker((db) => db.query("SELECT pg_sleep(0.05)"))));
    const jobs = await Promise.all(ids.map((m) => claimMention(m)));
    const claimed = jobs.filter(Boolean).length;
    const refused = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM assistant_mentions WHERE id = ANY($1::uuid[]) AND status = 'refused'", [ids]))[0].n;
    console.log(`[security] concurrent claims: ${claimed} claimed, ${refused} refused (limit ${5} a minute)`);
    expect(claimed).toBe(5);
    expect(refused).toBe(4);
  });
});


describe("search_messages with no hits", () => {
  it("is private: \"nothing in #x\" would say #x exists", async () => {
    // #design: Olu, Ben and David. #leadership-exits: Olu and Ben only (David is not in it and cannot read it).
    const exits = (await createChannel(olu, { title: "leadership-exits", memberIds: [id(ben)] })).id;
    const david = a.managerCtx;
    expect(await appQueryAs(david.user.profileId, "SELECT 1 FROM conversations WHERE id = $1", [exits])).toEqual([]);
    const r = await tool(olu, design, "search_messages", { q: "zzzz-nothing", conversation: "leadership-exits" });
    expect(r.exposure).toBe("private");
  });
});

describe("drawing a message's mentions", () => {
  it("one stored message with 20 mentions and an @-padded body is cheap to draw", async () => {
    // Twenty readers of Everyone besides Olu (the fixture has five: Ada, Mary, David, Ben, Ifeoma).
    const people: OrgContext[] = [];
    for (let i = 0; i < 15; i++) people.push(await joinViaInvitation(mary, await createVerifiedUser(`dos${i}@company-a.test`, `Dos Person${String(i).padStart(2, "0")}`), "employee", null, `EMP-${100 + i}`));
    const others = (await adminQuery<{ id: string; name: string }>(
      `SELECT m.id, p.display_name AS name FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2 ORDER BY p.display_name LIMIT 20`,
      [olu.org.id, id(olu)]));
    expect(others.length).toBe(20);
    const head = others.map((p) => `@${p.name}`).join(" ") + " ";
    const body = head + "@".repeat(4000 - head.length);
    const t0 = performance.now();
    const sent = await sendMessage(olu, { conversationId: everyone, body, mentions: others.map((p) => ({ kind: "person" as const, membershipId: p.id, label: `@${p.name}` })) }, { startMention: false });
    const sendMs = performance.now() - t0;
    expect(sent.mentioned.length).toBe(20);
    // What the thread hands MentionText (a client component, rendered on the server too) for that one message.
    const m = (await thread(ben, everyone))!.messages.find((x) => x.id === sent.id)!;
    expect(m.mentions.length).toBe(20);
    const { splitMentions } = await import("@/lib/mentions");
    const t1 = performance.now();
    splitMentions(m.body, m.mentions);
    const renderMs = performance.now() - t1;
    console.log(`[security] hostile mention body: send ${sendMs.toFixed(0)} ms, one render ${renderMs.toFixed(0)} ms (a thread draws up to 200 such messages)`);
    expect(renderMs).toBeLessThan(20);
  });
});

describe("a withdrawn reply (fixer pass, 8 October 2026)", () => {
  it("stops being quoted in the tagger's notification and Activity line (migration 0042)", async () => {
    const room = (await createChannel(olu, { title: "withdraw-room", memberIds: [id(ben)] })).id;
    const sent = await sendMessage(olu, { conversationId: room, body: "@Max status of Homepage design", mentions: [{ kind: "assistant", label: "@Max" }] }, { startMention: false });
    await adminQuery("UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE tagger_membership_id = $1 AND started_at IS NOT NULL", [id(olu)]);
    const job = (await claimMention(sent.mentionId!))!;
    expect(job).toBeTruthy();
    expect(await completeMentionPublic(job.id, { text: "Homepage design: to do, Olu Adeyemi.", fullText: null, noteCode: null, engine: "builtin", readers: await mentionReaders(room) })).toBe("answered");
    const note = async () => (await adminQuery<{ body: string | null; read: boolean }>(
      "SELECT body, read_at IS NOT NULL AS read FROM notifications WHERE recipient_membership_id = $1 AND deduplication_key = $2", [id(olu), `mention.reply:${job.id}`]))[0];
    expect((await note()).body).toContain("Homepage design");
    await withdrawMentionReply(olu, job.id);
    expect(await note()).toEqual({ body: "This reply was withdrawn.", read: true });
    const line = (await adminQuery<{ s: string }>("SELECT detail->>'personalSummary' AS s FROM brenda_actions WHERE tool = 'mention_reply' AND detail->>'mentionId' = $1", [job.id]))[0];
    expect(line.s).toMatch(/\(withdrawn\)$/);
  });
});

describe("Post to channel while assistant replies are off", () => {
  it("is not offered and is refused", async () => {
    const room = (await createChannel(olu, { title: "switch-room", memberIds: [id(ben)] })).id;
    const sent = await sendMessage(olu, { conversationId: room, body: "@Max who's off today?", mentions: [{ kind: "assistant", label: "@Max" }] }, { startMention: false });
    await adminQuery("UPDATE assistant_mentions SET started_at = started_at - interval '3 days' WHERE tagger_membership_id = $1 AND started_at IS NOT NULL", [id(olu)]);
    const job = (await claimMention(sent.mentionId!))!;
    expect(await completeMentionPrivate(job.id, { text: "Everyone is in today.", noteCode: null, proposals: [], engine: "builtin" })).toBe("private");
    expect((await getMention(olu, job.id))?.private?.canPost).toBe(true);
    await adminQuery("UPDATE conversations SET assistant_replies = false WHERE id = $1", [room]);
    expect((await getMention(olu, job.id))?.private?.canPost).toBe(false);
    await expect(postMention(olu, job.id)).rejects.toMatchObject({ status: 409 });
  });
});
