import { describe, it, expect, vi, beforeEach } from "vitest";

// Personal assistants, phase 5 (owner decision, 8 October 2026): what the assistant's answer to a mention looks like in a
// thread (plain text, at most 6 lines and 600 characters), what the built-in helper understands there, and how the
// processor takes a mention from its claim to a public reply, a private answer or a retry. The database, the model and
// the mention transitions are replaced below; foundation's integration tests run the real ones.

const db = vi.hoisted(() => ({ gone: false, status: "answered" as string | null, jobs: [] as { type: string; payload: unknown; dedupKey?: string }[] }));
vi.mock("@/server/db", () => {
  const fake = {
    maybeOne: async (sql: string) => (/deleted_at IS NOT NULL AS gone/.test(sql) ? { gone: db.gone } : /SELECT status FROM assistant_mentions/.test(sql) ? (db.status ? { status: db.status } : null) : null),
    query: async () => [], one: async () => ({}),
  };
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withWorker: async (fn: (d: typeof fake) => unknown) => fn(fake), withUser: refuse, withSystem: refuse };
});
vi.mock("@/server/lib/schema-0041", () => ({ schema0041Ready: async () => true, forget0041: () => undefined, isMissingSchema: () => false }));
vi.mock("@/server/services/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/common")>()),
  enqueueJob: async (_db: unknown, type: string, payload: unknown, opts: { dedupKey?: string } = {}) => { db.jobs.push({ type, payload, dedupKey: opts.dedupKey }); },
}));
vi.mock("@/server/services/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/assistant")>()),
  resolveAssistant: async () => ({ apiKey: "test-key", model: "fake-model", source: "environment" }),
}));
const m = vi.hoisted(() => ({
  claimMention: vi.fn(), renewMentionLease: vi.fn(async () => true), releaseMention: vi.fn(async () => "thinking"),
  completeMentionPublic: vi.fn(async () => "answered"), completeMentionPrivate: vi.fn(async () => "private"),
  refuseMention: vi.fn(async () => "refused"), failMention: vi.fn(async () => "failed"), nextPendingMention: vi.fn(async () => null as string | null),
  staleMentions: vi.fn(async () => [] as { id: string; attempts: number }[]), settleMentionConfirms: vi.fn(async () => 0),
  readMentionThread: vi.fn(), answerMention: vi.fn(), mentionReaders: vi.fn(async () => ["00000000-0000-4000-8000-0000000000aa"] as string[] | null),
}));
vi.mock("@/server/services/mentions", () => ({
  claimMention: m.claimMention, renewMentionLease: m.renewMentionLease, releaseMention: m.releaseMention,
  completeMentionPublic: m.completeMentionPublic, completeMentionPrivate: m.completeMentionPrivate, refuseMention: m.refuseMention,
  failMention: m.failMention, mentionReaders: m.mentionReaders, nextPendingMention: m.nextPendingMention, staleMentions: m.staleMentions, settleMentionConfirms: m.settleMentionConfirms,
  visibleToReaders: async () => new Set<string>(),
  // Phase 6: someone else's assistant (none in these tests; the sweep finds nothing to bring up to date).
  linkMentionFollowUp: async () => false, ownerThreadState: async () => null, postOwnerThread: async () => null, withdrawOwnerMention: async () => false,
  ownerMentionsToSync: async () => [] as string[],
}));
vi.mock("@/server/services/catch-up", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/catch-up")>()),
  readMentionThread: m.readMentionThread,
}));
vi.mock("@/server/services/copilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/copilot")>()),
  answerMention: m.answerMention,
}));

import { plainReply, shortReply } from "@/server/services/copilot-excerpt";
import { mentionIntent, requestOf, type MentionAnswer } from "@/server/services/copilot";
import { processMention, processMentionJob, startMention, sweepMentions } from "@/server/services/mention-processor";
import { DEFAULT_ASSISTANT } from "@/lib/assistant-look";
import type { OrgContext } from "@/server/lib/api";

// ---- Plain text for a bubble ----------------------------------------------------------------------------------------------

describe("plainReply: her answer as a bubble shows it", () => {
  it("drops bold, headings, quotes and code marks; bullets become dashes", () => {
    expect(plainReply("**Landing page** is *nearly* done.")).toBe("Landing page is nearly done.");
    expect(plainReply("## Status\n__Done__\n> quoted")).toBe("Status\nDone\nquoted");
    expect(plainReply("* one\n+ two\n- three\n  * nested")).toBe("- one\n- two\n- three\n  - nested");
    expect(plainReply("Run `pnpm test` first.\n```ts\nconst a = 1;\n```")).toBe("Run pnpm test first.\nconst a = 1;");
    expect(plainReply("~~old~~ new\n---\nend")).toBe("old new\n\nend");
  });

  it("turns links into words: a Boredroom page by its name, anything else with its address beside it", () => {
    expect(plainReply("See [Tasks](/app/acme/tasks) for more.")).toBe("See Tasks for more.");
    expect(plainReply("Read [the brief](https://evil.example/x?d=secret).")).toBe("Read the brief (https://evil.example/x?d=secret).");
    expect(plainReply("[https://a.example](https://a.example)")).toBe("https://a.example");
    expect(plainReply("[](//evil.example)")).toBe("//evil.example");
  });

  it("keeps escaped characters as typed, a lone asterisk, and snake_case", () => {
    expect(plainReply("5 \\* 3 and a\\_b and \\[x\\]")).toBe("5 * 3 and a_b and [x]");
    expect(plainReply("2 * 3 = 6, see file_name_here")).toBe("2 * 3 = 6, see file_name_here");
  });

  it("collapses blank lines, trims, and clamps to 4,000 characters without splitting an emoji", () => {
    expect(plainReply("\n\nOne\n\n\n\nTwo   \n\n")).toBe("One\n\nTwo");
    const long = plainReply("a".repeat(3998) + "😀😀");
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith("…")).toBe(true);
    expect(/[\uD800-\uDBFF]…$/.test(long)).toBe(false);
    expect(plainReply("x".repeat(5000))).toHaveLength(4000);
  });
});

describe("shortReply: at most 6 lines and 600 characters in public", () => {
  it("leaves a reply within both alone", () => {
    const r = "Yes, the review moved to 3.\n- Ben confirmed\n- David too";
    expect(shortReply(r)).toEqual({ text: r, truncated: false });
    const six = Array.from({ length: 6 }, (_, i) => `Line ${i + 1}`).join("\n\n");
    expect(shortReply(six)).toEqual({ text: six, truncated: false });
  });

  it("keeps the first 6 non-empty lines", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `- Item ${i + 1}`).join("\n");
    const r = shortReply(seven);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("- Item 1\n- Item 2\n- Item 3\n- Item 4\n- Item 5\n- Item 6…");
  });

  it("cuts a long reply at the last sentence end that fits", () => {
    const sentence = "The landing page copy is with Ben for a check. ";
    const r = shortReply(sentence.repeat(20).trim()); // about 940 characters on one line
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(600);
    expect(r.text.endsWith("check. …")).toBe(true);
  });

  it("cuts at the last space when there is no sentence end, and never inside an emoji", () => {
    const words = shortReply("word ".repeat(200).trim());
    expect(words.text.length).toBeLessThanOrEqual(600);
    expect(words.text).toMatch(/word…$/);
    const emoji = shortReply("😀".repeat(400));
    expect(emoji.truncated).toBe(true);
    expect(emoji.text.length).toBeLessThanOrEqual(600);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji.text)).toBe(false);
    expect(emoji.text.endsWith("😀…")).toBe(true);
  });
});

// ---- What the built-in helper understands in a thread -----------------------------------------------------------------

describe("requestOf: the request without the assistant's tag", () => {
  it("takes out the tag and the punctuation after it", () => {
    expect(requestOf("@Max who's here?", "Max")).toBe("who's here?");
    expect(requestOf("@max, what time do we start?", "Max")).toBe("what time do we start?");
    expect(requestOf("Morning! @assistant where do I find Docs?", "Max")).toBe("Morning! where do I find Docs?");
    expect(requestOf("@Brenda: who's here", "Brenda")).toBe("who's here");
  });

  it("leaves other words that only start the same way alone", () => {
    expect(requestOf("@Maxine and mail@Max are not tags", "Max")).toBe("@Maxine and mail@Max are not tags");
  });
});

describe("mentionIntent", () => {
  it("who is here: public", () => {
    for (const q of ["who's here?", "Who is in this channel?", "who are the people here", "who's in this chat", "can you tell me who's on this thread"]) {
      expect(mentionIntent(q), q).toEqual({ kind: "people" });
    }
  });

  it("the organisation's hours and rules: public", () => {
    expect(mentionIntent("what are our working hours?")).toEqual({ kind: "policy", topics: ["hours"] });
    expect(mentionIntent("What are the working days?")).toEqual({ kind: "policy", topics: ["days"] });
    expect(mentionIntent("what's the grace period before you count as late?")).toEqual({ kind: "policy", topics: ["late"] });
    expect(mentionIntent("what time zone are we on?")).toEqual({ kind: "policy", topics: ["zone"] });
    expect(mentionIntent("are we recorded? what's the monitoring policy")).toEqual({ kind: "policy", topics: ["recording"] });
    // Phase 8 (owner decisions, 8 October 2026): the topic stays; its answer says screens and calls are never recorded.
    expect(mentionIntent("are our calls recorded?")).toEqual({ kind: "policy", topics: ["recording"] });
    expect(mentionIntent("does Boredroom record calls")).toEqual({ kind: "policy", topics: ["recording"] });
    expect(mentionIntent("when do we start")).toEqual({ kind: "policy", topics: ["hours"] });
  });

  it("which page: public", () => {
    expect(mentionIntent("where do I change my working hours?")).toEqual({ kind: "page" });
    expect(mentionIntent("Which page has the timesheets?")).toEqual({ kind: "page" });
  });

  it("a task by name: public only when everyone can see it", () => {
    expect(mentionIntent("what's the status of the landing page?")).toEqual({ kind: "task", q: "landing page" });
    expect(mentionIntent("Any update on the pricing page task?")).toEqual({ kind: "task", q: "pricing page" });
    expect(mentionIntent("where are we on the homepage redesign")).toEqual({ kind: "task", q: "homepage redesign" });
    expect(mentionIntent("how far along is the invoice export?")).toEqual({ kind: "task", q: "invoice export" });
    expect(mentionIntent("how is the onboarding flow going?")).toEqual({ kind: "task", q: "onboarding flow" });
  });

  it("the tagger's own day, briefing, attendance and catch-up: private", () => {
    expect(mentionIntent("what did I miss?")).toEqual({ kind: "private", what: "catch_up" });
    expect(mentionIntent("what's waiting for me?")).toEqual({ kind: "private", what: "briefing" });
    expect(mentionIntent("what's on my day?")).toEqual({ kind: "private", what: "my_day" });
    expect(mentionIntent("who's late today?")).toEqual({ kind: "private", what: "attendance" });
    expect(mentionIntent("who is working right now")).toEqual({ kind: "private", what: "attendance" });
    expect(mentionIntent("what's on my plate?")).toEqual({ kind: "private", what: "my_day" });
  });

  it("clocking in or out is an action: answered privately with words, never a button it cannot show", () => {
    for (const q of ["clock me in", "clock in", "please clock me out", "can you clock me in?"]) expect(mentionIntent(q)).toEqual({ kind: "private", what: "clock" });
    // Asking about the clock is attendance, as before.
    expect(mentionIntent("who clocked in today?")).toEqual({ kind: "private", what: "attendance" });
  });

  it("actions, follow-ups and anything else: nothing (the private note)", () => {
    for (const q of ["remind me to call Ben at 3", "follow up with Ben on the landing page", "where is Ben on the landing page?", "send the deck to Ada", "summarise the roadmap please", "", "thanks!"]) {
      expect(mentionIntent(q), q).toEqual({ kind: "none" });
    }
  });
});

// ---- The processor ------------------------------------------------------------------------------------------------------

const ORG = "00000000-0000-4000-8000-0000000000a1";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const M1 = "00000000-0000-4000-8000-0000000000e1";
/** The one reader mentionReaders returns (the mock above). */
const READER = "00000000-0000-4000-8000-0000000000aa";
const M2 = "00000000-0000-4000-8000-0000000000e2";
const MSG = "00000000-0000-4000-8000-000000000101";
const ctx = {
  user: { profileId: "p1", authUserId: "u1", email: "olu@example.test", displayName: "Olu Adeyemi", emailVerified: true, sessionId: "followup" },
  org: { id: ORG, slug: "acme", name: "Acme", timezone: "Africa/Lagos", current_policy_id: null, status: "active" },
  membership: { id: "00000000-0000-4000-8000-0000000000b1", role: "employee", employee_code: "E1" },
  plan: { features: { AI_ASSISTANT: true } },
} as unknown as OrgContext;
const job = (id = M1, attempts = 1) => ({
  id, organisationId: ORG, conversationId: CONV, messageId: MSG, taggerMembershipId: ctx.membership.id, attempts, createdAt: "2026-10-08T10:00:00Z", ctx,
  conversation: { id: CONV, kind: "team", name: "#Design", archived: false }, assistant: { ...DEFAULT_ASSISTANT, name: "Max" },
});
const answer = (o: Partial<MentionAnswer>): MentionAnswer => ({ exposure: "public", text: "", proposals: [], engine: "builtin", noteCode: null, reasons: [], ...o });
const THREAD = { tagging: { id: MSG, body: "@Max who's here?" } };

beforeEach(() => {
  vi.clearAllMocks();
  db.gone = false; db.status = "answered"; db.jobs = [];
  m.claimMention.mockImplementation(async (id: string) => job(id));
  m.readMentionThread.mockResolvedValue(THREAD);
  m.nextPendingMention.mockResolvedValue(null);
  m.renewMentionLease.mockResolvedValue(true);
});

describe("processMention", () => {
  it("posts a public answer as plain text, as it is when it is short", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "**3 people** are here.", engine: "claude" }));
    expect(await processMention(M1, { useModel: false })).toBe("answered");
    expect(m.completeMentionPublic).toHaveBeenCalledWith(M1, { text: "3 people are here.", fullText: null, noteCode: null, engine: "claude", readers: [READER] });
    expect(m.completeMentionPrivate).not.toHaveBeenCalled();
  });

  it("keeps the built-in helper's plain answer as it is: a task title's own marks are not read as Markdown", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "Fix *urgent* `user_id` bug: to do, Ben.", engine: "builtin" }));
    await processMention(M1, { useModel: false });
    expect(m.completeMentionPublic).toHaveBeenCalledWith(M1, { text: "Fix *urgent* `user_id` bug: to do, Ben.", fullText: null, noteCode: null, engine: "builtin", readers: [READER] });
  });

  it("shortens a long public answer and keeps the full text for the tagger", async () => {
    const full = Array.from({ length: 9 }, (_, i) => `- Task ${i + 1}: in progress`).join("\n");
    m.answerMention.mockResolvedValue(answer({ text: full, noteCode: "allowance" }));
    await processMention(M1);
    const [, r] = m.completeMentionPublic.mock.calls[0] as unknown as [string, { text: string; fullText: string | null; noteCode: string | null }];
    expect(r.text.split("\n")).toHaveLength(6);
    expect(r.text.endsWith("…")).toBe(true);
    expect(r.fullText).toBe(full);
    expect(r.noteCode).toBe("allowance");
  });

  it("keeps a private answer and its Confirm cards for the tagger", async () => {
    const proposals = [{ kind: "confirm" as const, token: "t", summary: "Set your status to away", tool: "set_status" }];
    m.answerMention.mockResolvedValue(answer({ exposure: "private", text: "Press **Confirm**.", proposals, engine: "claude", reasons: ["set_status", "proposal"] }));
    expect(await processMention(M1)).toBe("private");
    expect(m.completeMentionPrivate).toHaveBeenCalledWith(M1, { text: "Press Confirm.", noteCode: null, proposals, engine: "claude" });
    expect(m.completeMentionPublic).not.toHaveBeenCalled();
  });

  it("never posts an empty answer: the tagger gets a note instead", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "   " }));
    await processMention(M1);
    expect(m.completeMentionPrivate).toHaveBeenLastCalledWith(M1, { text: null, noteCode: "failed", proposals: [], engine: "builtin" });
    m.answerMention.mockResolvedValue(answer({ exposure: "private", text: "", noteCode: "no_ai", reasons: ["no_answer"] }));
    await processMention(M1);
    expect(m.completeMentionPrivate).toHaveBeenLastCalledWith(M1, { text: null, noteCode: "no_ai", proposals: [], engine: "builtin" });
    expect(m.completeMentionPublic).not.toHaveBeenCalled();
  });

  it("never reaches the model in tests, whatever is passed", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "Hi." }));
    await processMention(M1, { useModel: true });
    expect(m.answerMention.mock.calls[0][1]).toMatchObject({ conn: null, noteCode: null, maxSteps: 6, scope: { conversationId: CONV, mentionId: M1, exposure: "public", reasons: [] } });
  });

  it("releases a run that throws, for the next claim to retry; nothing is said in public", async () => {
    m.answerMention.mockRejectedValue(new Error("model timeout"));
    db.status = "thinking";
    expect(await processMention(M1)).toBe("thinking");
    expect(m.releaseMention).toHaveBeenCalledWith(M1, "model timeout");
    expect(m.completeMentionPublic).not.toHaveBeenCalled();
    expect(m.completeMentionPrivate).not.toHaveBeenCalled();
  });

  it("stops quietly when its claim was lost while the model worked", async () => {
    m.renewMentionLease.mockResolvedValue(false);
    m.answerMention.mockImplementation(async (_c: unknown, i: { onStep: () => Promise<unknown> }) => { await i.onStep(); return answer({ text: "never" }); });
    db.status = "withdrawn";
    expect(await processMention(M1)).toBe("withdrawn");
    expect(m.releaseMention).not.toHaveBeenCalled();
    expect(m.completeMentionPublic).not.toHaveBeenCalled();
  });

  it("does nothing with a row it cannot claim", async () => {
    m.claimMention.mockResolvedValue(null);
    db.status = "refused";
    expect(await processMention(M1)).toBe("refused");
    expect(m.answerMention).not.toHaveBeenCalled();
    expect(await processMention("not-a-uuid")).toBeNull();
  });

  it("refuses when the tagger can no longer read the thread, and says nothing when the message was withdrawn", async () => {
    m.readMentionThread.mockResolvedValue(null);
    await processMention(M1);
    expect(m.refuseMention).toHaveBeenCalledWith(M1, "not_allowed");
    db.gone = true;
    await processMention(M1);
    expect(m.completeMentionPrivate).toHaveBeenLastCalledWith(M1, { text: null, noteCode: null, proposals: [], engine: "builtin" });
    expect(m.answerMention).not.toHaveBeenCalled();
  });

  it("then answers the mentions waiting in the same conversation, and stops at one it cannot claim", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "Done." }));
    m.nextPendingMention.mockResolvedValueOnce(M2).mockResolvedValueOnce(null);
    await processMention(M1);
    expect(m.claimMention.mock.calls.map((c) => c[0])).toEqual([M1, M2]);
    expect(m.answerMention).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    m.answerMention.mockResolvedValue(answer({ text: "Done." }));
    m.claimMention.mockImplementation(async (id: string) => (id === M1 ? job(M1) : null));
    m.nextPendingMention.mockResolvedValue(M2);
    await processMention(M1);
    expect(m.claimMention.mock.calls.map((c) => c[0])).toEqual([M1, M2]);

    vi.clearAllMocks();
    m.claimMention.mockImplementation(async (id: string) => job(id));
    m.answerMention.mockResolvedValue(answer({ text: "Done." }));
    await processMention(M1, { drain: false });
    expect(m.nextPendingMention).not.toHaveBeenCalled();
  });
});

describe("the worker's jobs", () => {
  it("mention.process: one mention, 4 model steps, the next one waiting gets its own job", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "Done." }));
    m.claimMention.mockResolvedValue(job(M1, 2));
    m.nextPendingMention.mockResolvedValue(M2);
    await processMentionJob(M1);
    expect(m.answerMention).toHaveBeenCalledTimes(1);
    expect(m.answerMention.mock.calls[0][1]).toMatchObject({ maxSteps: 4 });
    expect(db.jobs).toEqual([{ type: "mention.process", payload: { id: M2 }, dedupKey: `mention.process:${M2}:after:${M1}:2` }]);
  });

  it("mention.sweep: settles expired Confirms, then queues each stuck mention once per attempt and window", async () => {
    m.settleMentionConfirms.mockResolvedValue(2);
    m.staleMentions.mockResolvedValue([{ id: M1, attempts: 0 }, { id: M2, attempts: 1 }]);
    const now = new Date("2026-10-08T10:17:00Z");
    const window = Math.floor(now.getTime() / 600_000);
    expect(await sweepMentions({ limit: 5, now })).toEqual({ settled: 2, queued: 2, synced: 0 });
    expect(m.staleMentions).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    // Once per attempt in a ten-minute window: a row whose conversation was busy is tried again in the next window.
    expect(db.jobs.map((j) => j.dedupKey)).toEqual([`mention.process:${M1}:0:${window}`, `mention.process:${M2}:1:${window}`]);
  });
});

describe("startMention", () => {
  it("runs outside a request as a promise of its own, without throwing", async () => {
    m.answerMention.mockResolvedValue(answer({ text: "Hi." }));
    expect(() => startMention(M1)).not.toThrow();
    await vi.waitFor(() => expect(m.completeMentionPublic).toHaveBeenCalled());
    expect(() => startMention("nope")).not.toThrow();
  });
});
