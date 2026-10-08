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
 */
import { after } from "next/server";
import { withWorker } from "@/server/db";
import { forget0041, isMissingSchema, schema0041Ready } from "@/server/lib/schema-0041";
import { enqueueJob } from "@/server/services/common";
import { resolveAssistant, type AssistantConnection } from "@/server/services/assistant";
import { aiAllowance } from "@/server/services/ai-usage";
import { readMentionThread } from "@/server/services/catch-up";
import { answerMention, type MentionAnswer, type SharedScope } from "@/server/services/copilot";
import { plainReply, shortReply } from "@/server/services/copilot-excerpt";
import {
  claimMention, completeMentionPrivate, completeMentionPublic, mentionReaders, nextPendingMention, refuseMention, releaseMention,
  renewMentionLease, settleMentionConfirms, staleMentions, type MentionJob,
} from "@/server/services/mentions";
import { MENTION_LIMITS, type MentionNoteCode, type MentionStatus } from "@/lib/mentions";

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
  const scope: SharedScope = { conversationId: job.conversationId, mentionId: job.id, exposure: "public", reasons: [] };
  const answer = await answerMention(job.ctx, {
    conn, scope, thread, conversation: job.conversation, assistant: job.assistant, noteCode,
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
 */
export async function sweepMentions(opts: { now?: Date; limit?: number } = {}): Promise<{ settled: number; queued: number }> {
  const now = opts.now ?? new Date();
  try {
    if (!(await withWorker((db) => schema0041Ready(db)))) return { settled: 0, queued: 0 };
    const settled = await settleMentionConfirms({ now });
    const stale = await staleMentions({ now, limit: opts.limit ?? 5 });
    if (stale.length) {
      const window = Math.floor(now.getTime() / 600_000);
      await withWorker(async (db) => {
        for (const r of stale) await enqueueJob(db, "mention.process", { id: r.id }, { dedupKey: `mention.process:${r.id}:${r.attempts}:${window}` });
      });
    }
    return { settled, queued: stale.length };
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); return { settled: 0, queued: 0 }; }
    throw err;
  }
}
