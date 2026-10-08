/**
 * The assistant answering in a thread (owner decision, 8 October 2026: personal assistants, phase 5). "@Max …" in a
 * conversation queues one row (assistant_mentions, written in the send's transaction, services/mentions.ts); this file
 * takes it from there:
 *
 * 1. Claim it (services/mentions: one run at a time per conversation, the switches, the limits, the tagger's permission;
 *    a refusal writes the tagger's private note itself).
 * 2. Read the thread as the tagger (catch-up's readMentionThread: the last 40 messages or about 8,000 characters).
 * 3. Answer as the tagger (copilot's answerMention, shared mode): Claude when the plan has the AI assistant, a connection
 *    exists and the tagger has allowance left; the built-in helper otherwise (with the note 'allowance' when that is why).
 * 4. Post it for everyone when Boredroom kept it public (at most 6 lines and 600 characters; a longer one is shortened
 *    and the full text kept for the tagger), else keep it for the tagger, with any Confirm cards.
 * 5. Then the next mention waiting in the same conversation.
 *
 * Where it runs: right after the response in the web process that sent the message (Next's `after()`, the fast path),
 * and in the worker for anything stuck (mention.sweep, mention.process; at most 4 model steps and one mention per job).
 * Every step is a guarded transition, so running it twice, from two places, does no harm. Failures never show in the
 * thread: a run that throws is released and retried, and after three attempts the tagger gets a private note.
 *
 * No test reaches the model: `useModel: false`, and NODE_ENV "test" refuses it whatever is passed. Before migration 0041
 * every entry point returns at once.
 *
 * Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6: "I want all the bots to be
 * able to communicate with each other"). "@Ben's Brenda, where is the deck?" is answered by Ben's assistant, and that
 * run calls NO model (`runOwner`): what the tagger asked is read by threadAskIntent (assistant-talk-intent.ts) and
 * - a change on Ben's account (a to-do, a reminder, moving a task, a comment) becomes a request: a Confirm card for the
 *   tagger alone (hand_over_request), and nothing changes until Ben accepts it in his inbox;
 * - "tell him …" is passed on: "I'll make sure Ben sees this." and Ben is told what was asked;
 * - anything else is a question under the follow-up rules, asked as the tagger (their permissions bound what is shared):
 *   a follow-up in thread mode ('facts' when it is about the state of his work, else 'ask'). When his work answers it,
 *   Ben's assistant posts only what every current reader can see (publicFacts, the audience rule), else it says it
 *   answered the tagger privately; when Ben is asked, it posts "I've asked Ben. I'll reply here." and later his reply,
 *   "can't answer right now" or "No reply from Ben by …" (syncThreadFollowUp, called by the follow-ups service after
 *   every transition of such a follow-up, by this run, and by the sweep).
 * Every post is a guarded step on the locked mention (services/mentions.ts, postOwnerThread), at most two per mention,
 * and none carries a mention, so no assistant ever starts another.
 */
import { after } from "next/server";
import { withWorker } from "@/server/db";
import { forget0041, isMissingSchema, schema0041Ready } from "@/server/lib/schema-0041";
import { enqueueJob } from "@/server/services/common";
import { resolveAssistant, type AssistantConnection } from "@/server/services/assistant";
import { aiAllowance } from "@/server/services/ai-usage";
import { readMentionThread } from "@/server/services/catch-up";
import { answerMention, prepareConfirm, requestWithout, type MentionAnswer, type SharedScope } from "@/server/services/copilot";
import { clamp, oneLine, plainReply, shortReply } from "@/server/services/copilot-excerpt";
import {
  claimMention, completeMentionPrivate, completeMentionPublic, linkMentionFollowUp, mentionReaders, nextPendingMention, ownerMentionsToSync, ownerThreadState,
  postOwnerThread, refuseMention, releaseMention, renewMentionLease, settleMentionConfirms, staleMentions, visibleToReaders, withdrawOwnerMention,
  type MentionJob, type OwnerThreadState,
} from "@/server/services/mentions";
import { cancelThreadFollowUp, createFollowUps, planFollowUps, processFollowUp } from "@/server/services/follow-ups";
import { composeTemplate } from "@/server/services/follow-up-compose";
import { threadAskIntent, whenOf, whenProblemWords, type RequestWords, type ThreadAskIntent } from "@/server/services/assistant-talk-intent";
import type { RequestInput } from "@/server/services/assistant-items";
import { readWorkspaceAssistant } from "@/server/services/assistant-profile";
import { memberContext } from "@/server/lib/member-context";
import { AppError } from "@/server/lib/errors";
import { withUser } from "@/server/db";
import { MENTION_LIMITS, otherAssistantLabels, publicFacts, type MentionNoteCode, type MentionStatus } from "@/lib/mentions";
import { NO_TASK_LIKE, OPEN_STATUSES, REPLY_LABELS, clip, deadlineLabel, factsOrNull, firstName, whenLabel, type FollowUpFacts } from "@/lib/follow-ups";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How many waiting mentions of the same conversation one run drains after its own (the rest wait for the next run). */
const DRAIN_MAX = 10;
const warn = (what: string) => (err: unknown) => console.warn(`[mentions] ${what}: ${(err as Error)?.message ?? String(err)}`);

type ProcessOpts = { useModel?: boolean; now?: Date; maxSteps?: number; drain?: boolean };
/** The row's place after one attempt; `conversationId` and `attempts` only when this call held the claim. */
type Outcome = { status: MentionStatus | null; conversationId: string | null; attempts: number };

/** The claim was lost while the model worked (the row moved on): stop quietly, without releasing it. */
class LeaseLost extends Error {
  constructor() { super("the mention is no longer being processed here"); }
}

/** A mention's status now, through the worker; null when there is no such row or 0041 is not applied. */
async function statusNow(id: string): Promise<MentionStatus | null> {
  try {
    return await withWorker(async (db) => {
      if (!(await schema0041Ready(db))) return null;
      return (await db.maybeOne<{ status: MentionStatus }>(`SELECT status FROM assistant_mentions WHERE id = $1`, [id]))?.status ?? null;
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); return null; }
    warn(`reading ${id}`)(err);
    return null;
  }
}

/** Whether the tagging message was withdrawn (or is gone): then nothing is said, to anyone. */
async function taggingGone(messageId: string): Promise<boolean> {
  const r = await withWorker((db) => db.maybeOne<{ gone: boolean }>(`SELECT deleted_at IS NOT NULL AS gone FROM messages WHERE id = $1`, [messageId]));
  return !r || r.gone;
}

/**
 * Which engine answers: Claude only when the model is allowed here (not `useModel: false`, never in tests), the plan
 * has the AI assistant, a connection exists and the tagger has requests left today; past the 150 a day the built-in
 * helper answers with the note 'allowance' (owner decision, 8 October 2026). A failed check falls back to the helper.
 */
async function engineFor(job: MentionJob, opts: ProcessOpts): Promise<{ conn: AssistantConnection | null; noteCode: MentionNoteCode | null }> {
  if (opts.useModel === false || process.env.NODE_ENV === "test" || !job.ctx.plan.features.AI_ASSISTANT) return { conn: null, noteCode: null };
  const conn = await resolveAssistant(job.organisationId).catch((err: unknown) => { warn("checking the AI connection")(err); return null; });
  if (!conn) return { conn: null, noteCode: null };
  const a = await aiAllowance(job.ctx).catch((err: unknown) => { warn("daily allowance unavailable")(err); return null; });
  if (a?.ready && a.remaining <= 0) return { conn: null, noteCode: "allowance" };
  return { conn, noteCode: null };
}

/**
 * Posts or keeps the answer. Public and nothing to confirm: plain text, at most 6 lines and 600 characters, the full
 * text kept for the tagger when it was shortened; an empty answer is never posted (the tagger gets a private note).
 * Anything else is kept for the tagger with its Confirm cards.
 */
async function complete(job: MentionJob, a: MentionAnswer, readers: string[] | null): Promise<MentionStatus | null> {
  // Only the model writes Markdown: the built-in helper's answers are plain already, and reading them as Markdown again
  // would drop the marks a task title really has ("Fix *urgent* bug"; review, 8 October 2026).
  const text = a.engine === "claude" ? plainReply(a.text) : a.text.trim();
  if (a.exposure === "public" && !a.proposals.length) {
    if (!text) return completeMentionPrivate(job.id, { text: null, noteCode: a.noteCode ?? "failed", proposals: [], engine: a.engine });
    const short = shortReply(text);
    return completeMentionPublic(job.id, { text: short.text, fullText: short.truncated ? text : null, noteCode: a.noteCode, engine: a.engine, readers });
  }
  return completeMentionPrivate(job.id, {
    text: text || null,
    // A private answer with nothing to show still says why.
    noteCode: text || a.proposals.length ? a.noteCode : (a.noteCode ?? "failed"),
    proposals: a.proposals, engine: a.engine,
  });
}

/** One claimed mention, start to finish. Throws when the run could not finish (the caller releases it). */
async function run(job: MentionJob, opts: ProcessOpts): Promise<MentionStatus | null> {
  // Someone else's assistant (phase 6): no model, the follow-up rules and requests instead.
  if (job.owner) return runOwner(job, job.owner, opts);
  const thread = await readMentionThread(job.ctx, { conversationId: job.conversationId, messageId: job.messageId, messages: MENTION_LIMITS.threadMessages, chars: MENTION_LIMITS.threadChars });
  if (!thread) {
    // The tagging message was withdrawn in the moment since the claim: the completion sees it and ends 'withdrawn', with
    // nothing said to anyone. Else the tagger can no longer read the conversation.
    if (await taggingGone(job.messageId)) return completeMentionPrivate(job.id, { text: null, noteCode: null, proposals: [], engine: "builtin" });
    return refuseMention(job.id, "not_allowed");
  }
  const { conn, noteCode } = await engineFor(job, opts);
  // Who reads the conversation as the run starts: the answer is checked against them, so it is posted only if nobody
  // else has joined by the time it is ready (security review, 8 October 2026).
  const readers = await mentionReaders(job.conversationId);
  // The workspace's own assistant by its name, for "put this in the team report" (phase 6); Brenda when it cannot be read.
  const workspace = await withWorker((db) => readWorkspaceAssistant(db, job.organisationId)).catch(() => null);
  const scope: SharedScope = { conversationId: job.conversationId, mentionId: job.id, exposure: "public", reasons: [] };
  const answer = await answerMention(job.ctx, {
    conn, scope, thread, conversation: job.conversation, assistant: job.assistant, noteCode, workspaceAssistantName: workspace?.name,
    maxSteps: opts.maxSteps ?? MENTION_LIMITS.maxSteps,
    onStep: async () => { if (!(await renewMentionLease(job.id))) throw new LeaseLost(); },
  });
  if (process.env.BRENDA_DEBUG) console.log("[brenda:mention]", job.id, answer.engine, answer.exposure, answer.reasons.join(","));
  return complete(job, answer, readers);
}

/** Claims and runs one mention. Never throws. */
async function processOne(id: string, opts: ProcessOpts): Promise<Outcome> {
  let job: MentionJob | null;
  try { job = await claimMention(id, { now: opts.now }); }
  catch (err) {
    if (isMissingSchema(err)) { forget0041(); return { status: null, conversationId: null, attempts: 0 }; }
    warn(`claiming ${id}`)(err);
    return { status: await statusNow(id), conversationId: null, attempts: 0 };
  }
  if (!job) return { status: await statusNow(id), conversationId: null, attempts: 0 };
  const held = { conversationId: job.conversationId, attempts: job.attempts };
  try {
    return { status: (await run(job, opts)) ?? (await statusNow(id)), ...held };
  } catch (err) {
    if (err instanceof LeaseLost) return { status: await statusNow(id), ...held };
    // The model unreachable, a timeout, a database hiccup: released, retried by the next claim (the sweep, or a page
    // that shows it); after three attempts the tagger gets the private note. Never a public error.
    const message = ((err as Error)?.message ?? String(err)).slice(0, 300);
    const status = await releaseMention(id, message).catch((e: unknown) => { warn(`releasing ${id}`)(e); return null; });
    return { status: status ?? (await statusNow(id)), ...held };
  }
}

/**
 * Takes one mention as far as it goes now; safe to call any number of times, from anywhere (the web process right after
 * the send, a page settling a stuck row, the worker). A row someone else holds is left alone. Then, unless `drain` is
 * false, the mentions waiting in the same conversation, one after another (one run at a time per conversation). Returns
 * the mention's status afterwards; null before 0041 or for no such row. Never throws.
 */
export async function processMention(id: string, opts: ProcessOpts = {}): Promise<MentionStatus | null> {
  if (!UUID.test(id)) return null;
  try {
    const first = await processOne(id, opts);
    if (opts.drain !== false && first.conversationId) await drain(first.conversationId, id, { ...opts, now: undefined });
    return first.status;
  } catch (err) {
    warn(`processing ${id}`)(err);
    return statusNow(id);
  }
}

/** The mentions waiting in a conversation after a run, oldest first, until none is left or one cannot be claimed. */
async function drain(conversationId: string, done: string, opts: ProcessOpts): Promise<void> {
  const seen = new Set([done]);
  for (let i = 0; i < DRAIN_MAX; i++) {
    const next = await nextPendingMention(conversationId).catch((err: unknown) => { warn("finding the next mention")(err); return null; });
    // The same row twice: it could not be claimed (another run holds the conversation); that run drains it.
    if (!next || seen.has(next)) return;
    seen.add(next);
    await processOne(next, { ...opts, drain: false });
  }
}

/**
 * The fast path: right after the response in this web process (Next's `after()`). Outside a request (a script, a test)
 * `after` throws, and the run is an un-awaited promise instead; the worker's sweep picks up anything either leaves.
 */
export function startMention(id: string): void {
  if (!UUID.test(id)) return;
  const go = () => processMention(id).then(() => undefined, warn(`processing ${id}`));
  try { after(go); } catch { void go(); }
}

/**
 * The worker's mention.process job: one mention, bounded (4 model steps), never draining the conversation inline (the
 * worker runs one job at a time). The next mention waiting in the same conversation gets a job of its own, so one that
 * could not be claimed while this ran is not left until the next sweep finds it (review, 8 October 2026: the sweep's
 * job key repeats while a row's attempts do not change).
 */
export async function processMentionJob(id: string, opts: { now?: Date; useModel?: boolean } = {}): Promise<MentionStatus | null> {
  if (!UUID.test(id)) return null;
  const r = await processOne(id, { ...opts, maxSteps: MENTION_LIMITS.workerMaxSteps, drain: false });
  if (r.conversationId) {
    const next = await nextPendingMention(r.conversationId).catch((err: unknown) => { warn("finding the next mention")(err); return null; });
    if (next && next !== id) {
      await withWorker((db) => enqueueJob(db, "mention.process", { id: next }, { dedupKey: `mention.process:${next}:after:${id}:${r.attempts}` }))
        .catch(warn(`queueing ${next}`));
    }
  }
  return r.status;
}

/**
 * The worker's sweep: Confirms past their time become private (the card shows them expired), then each stuck row (a
 * pending one nobody started after 30 seconds, or a thinking one whose lease ran out) gets a mention.process job. The
 * job's key is the row's attempt and a ten-minute window (review, 8 October 2026): one attempt is queued once in a
 * window, and a row whose job found its conversation busy (another run holding it) is tried again in the next window
 * instead of never (job keys are never freed). At most `limit` rows a run. Nothing before 0041.
 *
 * Phase 6: then the runs of someone else's assistant that asked its owner and whose follow-up has closed since (or
 * whose tagging message was withdrawn) are brought up to date in the thread, at most 10 a run: the follow-up's own sync
 * may have been lost to a restart. No model; nothing before 0043.
 */
export async function sweepMentions(opts: { now?: Date; limit?: number } = {}): Promise<{ settled: number; queued: number; synced: number }> {
  const now = opts.now ?? new Date();
  try {
    if (!(await withWorker((db) => schema0041Ready(db)))) return { settled: 0, queued: 0, synced: 0 };
    const settled = await settleMentionConfirms({ now });
    const stale = await staleMentions({ now, limit: opts.limit ?? 5 });
    if (stale.length) {
      const window = Math.floor(now.getTime() / 600_000);
      await withWorker(async (db) => {
        for (const r of stale) await enqueueJob(db, "mention.process", { id: r.id }, { dedupKey: `mention.process:${r.id}:${r.attempts}:${window}` });
      });
    }
    const toSync = await ownerMentionsToSync({ limit: 10 }).catch((err: unknown) => { warn("finding asked mentions to bring up to date")(err); return [] as string[]; });
    for (const id of toSync) await syncThreadFollowUp(id);
    return { settled, queued: stale.length, synced: toSync.length };
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); return { settled: 0, queued: 0, synced: 0 }; }
    throw err;
  }
}

// ---- Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6) ------------------------------

type Owner = NonNullable<MentionJob["owner"]>;
type MentionThreadRead = NonNullable<Awaited<ReturnType<typeof readMentionThread>>>;

/** Kept for the tagger alone, in these words (never postable: canPost is false for someone else's assistant). */
const keepFor = (job: MentionJob, text: string) => completeMentionPrivate(job.id, { text, noteCode: null, proposals: [], engine: "builtin" });

/** Words that are not a time the run can use (unreadable, already past, too far ahead), said back to the tagger privately. */
const whenProblem = (w: string, o: { timeZone: string; now: Date }) => whenProblemWords(w, o, (x) => clamp(oneLine(x), 80));

/**
 * A run of someone else's assistant. No model. A run retried after a restart goes on with the follow-up it already
 * asked, never a second one.
 */
async function runOwner(job: MentionJob, owner: Owner, opts: ProcessOpts): Promise<MentionStatus | null> {
  if (job.followUpId) return carryOn(job.id, job.followUpId, opts);
  const thread = await readMentionThread(job.ctx, { conversationId: job.conversationId, messageId: job.messageId, messages: MENTION_LIMITS.threadMessages, chars: MENTION_LIMITS.threadChars });
  if (!thread) {
    if (await taggingGone(job.messageId)) return completeMentionPrivate(job.id, { text: null, noteCode: null, proposals: [], engine: "builtin" });
    return refuseMention(job.id, "not_allowed");
  }
  // The request without the tag, whichever of the assistant's labels was used.
  const request = requestWithout(thread.tagging.body, otherAssistantLabels(owner.name, owner.assistant.name, true));
  const intent = threadAskIntent(request, { ownerFirst: owner.firstName, ownerName: owner.name });
  if (process.env.BRENDA_DEBUG) console.log("[brenda:mention]", job.id, "owner", intent.kind);
  if (intent.kind === "request") return handOver(job, owner, thread, intent.request);
  if (intent.kind === "relay") {
    // Ben reads this conversation (the claim checked it): the line says he will see it, and he is told what was asked.
    return postOwnerThread(job.id, {
      kind: "final", text: `I'll make sure ${owner.firstName} sees this.`,
      ownerBody: `“${clip(oneLine(thread.tagging.body), 120)}”`,
      activity: `Passed on what ${firstName(job.ctx.user.displayName)} asked in ${whereOf(job)}`,
    });
  }
  return askOwner(job, owner, thread, intent, opts);
}

/** "#Design", "Everyone", or for a direct thread "your chat with Olu Adeyemi" (the owner's words). */
const whereOf = (job: MentionJob) => (job.conversation.kind === "direct" ? `your chat with ${job.ctx.user.displayName}` : job.conversation.name);

/**
 * A change on the owner's account: planned as the tagger (who may ask for what, the owner's own permissions, the limits)
 * and offered to the tagger alone as a hand_over_request Confirm card that carries the thread as its origin. Nothing is
 * posted in the thread, and nothing changes for the owner until they accept the request in their inbox.
 */
async function handOver(job: MentionJob, owner: Owner, thread: MentionThreadRead, rq: RequestWords): Promise<MentionStatus | null> {
  const o = { timeZone: job.ctx.org.timezone, now: new Date() };
  const attached = thread.tagging.task?.id ?? thread.task?.id ?? null;
  // "Mark it done", "comment on this": the task attached to the tagging message.
  const taskOf = (words: string) => (attached && /^(?:it|this|that|this\s+one|that\s+one|the\s+task|this\s+task|that\s+task)$/i.test(words.trim()) ? attached : words);
  let request: RequestInput;
  if (rq.kind === "add_todo") {
    const due = rq.due ? whenOf(rq.due, o) : null;
    if (rq.due && !due) return keepFor(job, whenProblem(rq.due, o));
    request = { kind: "add_todo", title: rq.title, due };
  } else if (rq.kind === "set_reminder") {
    const at = whenOf(rq.when, o);
    if (!at) return keepFor(job, whenProblem(rq.when, o));
    request = { kind: "set_reminder", text: rq.text, at };
  } else if (rq.kind === "task_status") request = { kind: "task_status", task: taskOf(rq.task), status: rq.status, reason: rq.reason };
  else request = { kind: "task_comment", task: taskOf(rq.task), text: rq.text };
  const { planRequest } = await import("@/server/services/assistant-items");
  const plan = await planRequest(job.ctx, { to: owner.membershipId, request });
  if (!plan.ok) return keepFor(job, plan.error);
  const first = plan.recipient.firstName || owner.firstName;
  const what = rq.kind === "add_todo" ? "to-dos" : rq.kind === "set_reminder" ? "reminders" : "task";
  const proposal = prepareConfirm(job.ctx, "hand_over_request",
    { recipientMembershipId: owner.membershipId, payload: plan.payload, note: null, origin: { conversationId: job.conversationId, mentionId: job.id } },
    `Ask ${first} to accept: ${plan.summary}? Nothing changes until ${first} accepts.`, plan.lines.join("\n") || undefined, { thread: true });
  if ("error" in proposal) return keepFor(job, proposal.error);
  return completeMentionPrivate(job.id, {
    text: `That changes ${first}'s ${what}, so ${first} has to accept it. Confirm and I'll ask ${first}.`,
    noteCode: null, proposals: [proposal], engine: "builtin",
  });
}

/**
 * A question for the owner, under the follow-up rules, as the tagger. The tagger must be someone who may follow up on
 * the owner at all (else the note 'not_followable'); the plan's other refusals (a task they cannot see, asked twice
 * already) are said to the tagger privately. 'facts' when it asks about the state of the owner's work, else 'ask' (the
 * owner is always asked); task words that fit none of the owner's work make it a question for the owner too.
 */
async function askOwner(job: MentionJob, owner: Owner, thread: MentionThreadRead, intent: Extract<ThreadAskIntent, { kind: "question" }>, opts: ProcessOpts): Promise<MentionStatus | null> {
  const refusal = await withUser(job.ctx.user.profileId, (db) => db.one<{ reason: string | null }>(
    `SELECT app_follow_up_refusal($1, $2, NULL::uuid) AS reason`, [job.organisationId, owner.membershipId]));
  if (refusal.reason) return refuseMention(job.id, "not_followable");
  const attached = thread.tagging.task?.id ?? thread.task?.id ?? null;
  let threadMode: "facts" | "ask" = intent.status ? "facts" : "ask";
  let plan = await planFollowUps(job.ctx, { people: [owner.membershipId], taskId: attached, task: attached ? null : intent.task, question: intent.question });
  if (!plan.ok && !attached && intent.task && plan.error.startsWith(NO_TASK_LIKE)) {
    plan = await planFollowUps(job.ctx, { people: [owner.membershipId], taskId: null, task: null, question: intent.question });
    threadMode = "ask";
  }
  if (!plan.ok) return keepFor(job, plan.error);
  let followUpId: string | null = null;
  try {
    const r = await createFollowUps(job.ctx, { subjectMembershipIds: [owner.membershipId], taskId: plan.task?.id ?? null, question: plan.question }, { threadMode, reuse: false });
    followUpId = r.created[0]?.id ?? null;
    if (!followUpId) return keepFor(job, r.skipped[0] ? `I couldn't ask ${owner.firstName}: ${r.skipped[0].reason}.` : `I couldn't ask ${owner.firstName} just now.`);
  } catch (err) {
    if (err instanceof AppError && (err.status < 500 || err.status === 503)) return keepFor(job, err.message);
    throw err;
  }
  if (!(await linkMentionFollowUp(job.id, followUpId))) {
    // The mention moved on meanwhile (its message withdrawn): the follow-up is not needed, and the owner is not asked.
    await cancelThreadFollowUp(followUpId, `${firstName(job.ctx.user.displayName)} withdrew the question.`).catch(warn("closing an unneeded follow-up"));
    return statusNow(job.id);
  }
  return carryOn(job.id, followUpId, opts);
}

/** The follow-up taken as far as it goes now (templates only), then the thread brought up to date with it. */
async function carryOn(mentionId: string, followUpId: string, opts: ProcessOpts): Promise<MentionStatus | null> {
  await processFollowUp(followUpId, { useModel: false, now: opts.now });
  await syncThreadFollowUp(followUpId);
  return statusNow(mentionId);
}

/**
 * Brings the thread up to date with a follow-up asked by someone else's assistant (D.2's table). Called by the run, by
 * the follow-ups service after every transition of a follow-up in thread mode, and by the sweep; every post is guarded
 * on the mention's status, so calling it any number of times, from anywhere, posts each line once. Never throws.
 */
export async function syncThreadFollowUp(followUpId: string): Promise<void> {
  if (!UUID.test(followUpId)) return;
  try {
    await sync(followUpId);
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); return; }
    warn(`bringing the thread up to date for follow-up ${followUpId}`)(err);
  }
}

async function sync(followUpId: string): Promise<void> {
  const st = await ownerThreadState(followUpId);
  if (!st) return;
  const { mention: m, followUp: f } = st;
  if (m.status !== "thinking" && m.status !== "asked") return;
  const first = firstName(m.ownerName);
  const taggerFirst = firstName(m.taggerName);
  const open = OPEN_STATUSES.includes(f.status);
  const withdrew = `${taggerFirst} withdrew the question.`;
  // The tagging message withdrawn: nothing more is said, the "I've asked" line goes, and the owner is not asked any more.
  if (m.messageWithdrawn) {
    await withdrawOwnerMention(m.id);
    if (open) await cancelThreadFollowUp(f.id, withdrew);
    return;
  }
  let s: MentionStatus | null = null;
  switch (f.status) {
    case "pending": case "answering": return;
    case "asking": {
      if (m.status !== "thinking" || m.holding) return;
      const by = f.deadlineAt ? ` by ${deadlineLabel(f.deadlineAt, m.timezone)}` : "";
      s = await postOwnerThread(m.id, { kind: "holding", text: `I've asked ${first}. I'll reply here${by}.` });
      break;
    }
    case "answered":
      if (f.answeredFrom === "person" && f.replyChoice) {
        const note = f.replyNote?.trim() ? ` “${clip(oneLine(f.replyNote), 280)}”` : "";
        s = await postOwnerThread(m.id, { kind: "final", text: `${first} replied: ${REPLY_LABELS[f.replyChoice] ?? f.replyChoice}.${note}` });
      } else if (f.threadMode === "ask") {
        // The question was not about the state of the work, and the owner was not asked (asked enough today).
        s = await postOwnerThread(m.id, { kind: "final", text: `${first} has been asked a lot today, so I didn't ask again. Ask ${first} here.` });
      } else {
        s = await answerFromFacts(st);
      }
      break;
    case "declined": s = await postOwnerThread(m.id, { kind: "final", text: `${first} can't answer right now.` }); break;
    case "expired": s = await postOwnerThread(m.id, { kind: "final", text: f.deadlineAt ? `No reply from ${first} by ${whenLabel(f.deadlineAt, m.timezone)}.` : `No reply from ${first}.` }); break;
    default:
      // failed or cancelled: a closing line after "I've asked", else only the tagger's private note.
      s = m.holding ? await postOwnerThread(m.id, { kind: "final", text: `I couldn't get an answer from ${first}.` }) : await postOwnerThread(m.id, { kind: "fail" });
  }
  // Withdrawn in the moment between the read and the post: close the follow-up too.
  if (s === "withdrawn" && OPEN_STATUSES.includes(f.status)) await cancelThreadFollowUp(f.id, withdrew);
  // The thread can no longer take the answer (archived, switched off, the tagger or the owner gone): the mention went
  // private, refused or failed without its final line, so the owner's ask closes too; a reply would reach nobody
  // (review, 8 October 2026).
  else if ((s === "private" || s === "refused" || s === "failed") && OPEN_STATUSES.includes(f.status)) {
    await cancelThreadFollowUp(f.id, `${taggerFirst}'s question can't be answered in ${m.whereForOwner} any more, so you don't need to reply.`);
  }
}

/** The task ids a follow-up's facts name: the task asked about, and the owner's open and finished shared work. */
function taskIdsOf(facts: FollowUpFacts): string[] {
  return [...new Set([facts.task?.id, ...(facts.openTasks ?? []).map((t) => t.id), ...(facts.completedToday ?? []).map((t) => t.id)].filter((x): x is string => !!x))];
}

/**
 * Answered from the owner's work: only what every current reader may see is posted (publicFacts against
 * app_visible_to_readers as the tagger, with the readers taken now; anyone who joins before it is posted makes it
 * private), in the template's words and at most 6 lines and 600 characters. Otherwise the thread reads "I've answered
 * Olu privately" and the tagger alone gets the follow-up's answer. When the check cannot be made: private.
 */
async function answerFromFacts(st: OwnerThreadState): Promise<MentionStatus | null> {
  const { mention: m, followUp: f } = st;
  const first = firstName(m.ownerName);
  const taggerFirst = firstName(m.taggerName);
  const facts = factsOrNull(f.facts);
  const now = new Date();
  const compose = (x: FollowUpFacts) => composeTemplate({
    question: "", kind: x.kind, answeredFrom: "facts", facts: x, capped: f.capped, reply: null,
    subject: { name: m.ownerName, firstName: first, assistantName: m.ownerAssistant.name }, requester: null, deadlineAt: null, timeZone: m.timezone, now,
  });
  const privateText = f.answer?.trim() || (facts ? compose(facts) : null);
  const activity = `Answered ${taggerFirst} in ${m.whereForOwner} from your work`;
  const fallback = {
    text: `I've answered ${taggerFirst} privately: not everyone here can see ${first}'s work on this.`,
    privateText, ownerBody: `${m.ownerAssistant.name} shared an update about your work with ${taggerFirst} privately.`,
  };
  let text: string | null = null;
  let readers: string[] | null = null;
  if (facts) {
    try {
      const ctx = await withWorker((db) => memberContext(db, m.organisationId, m.taggerMembershipId));
      readers = await mentionReaders(m.conversationId);
      const ids = taskIdsOf(facts);
      if (ctx && readers && ids.length) {
        const pub = publicFacts(facts, await visibleToReaders(ctx, m.conversationId, "task", ids));
        if (pub) {
          // The latest update is never public: the template's "nothing recorded lately" would then be untrue.
          let words = compose(pub);
          if (facts.lastUpdate) words = words.replace(`Nothing has been recorded on it by ${oneLine(first)} lately.`, "").replace(/\s+/g, " ").trim();
          text = words ? shortReply(words).text : null;
        }
      }
    } catch (err) {
      warn("checking who may read the answer")(err);
      text = null;
    }
  }
  if (!text) return postOwnerThread(m.id, { kind: "final", ...fallback, activity });
  return postOwnerThread(m.id, { kind: "final", text, ownerBody: text, activity, readers, fallback });
}
