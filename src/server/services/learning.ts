/**
 * "What Brenda has learned" (owner decision, 28 October 2026: "I want her to learn from the person's usage and
 * interaction with her and interact with the person based on that"). Three parts, all the person's own:
 *
 * 1. Signals (`assistant_signals`, migration 0067): short records of the person's OWN use of their assistant, written
 *    after the answer (Next's `after()`): their own request words (web and Mac chat, a look's words, the Mac front desk;
 *    never the pictures), at most 200 characters, a correction marked as one ("shorter", "don't…"); which tools ran and
 *    which waited for Confirm; Confirm cards confirmed or declined (the web's "Not now"); and, for what they asked their
 *    Mac to do, its kind, the apps and the output formats (never a file's name or a page's address). Never other people's
 *    messages, connected apps' content or screen pictures. Kept 30 days (the worker's system.purge_expired), and nothing
 *    from before "Forget everything" is read again. Nothing at all with "Learn from how I use Brenda" off, while someone
 *    else is signed in as the person, or in a session that is not them at the keyboard (a routine, a follow-up, a standup).
 *    Chat requests were not stored server-side before (the browser sends the conversation; `brenda_actions` holds tool
 *    names but owners and HR read it, and `mac_requests` only the Mac's), so this is the one minimal record.
 * 2. Learning: when due (15 of their turns since the last run and an hour gone, or 5 and a day gone), right after the
 *    turn that made it due, in the same `after()` (the background worker is often not running in production): a cheap
 *    model (claude-haiku-5-5, BRENDA_LEARNING_MODEL; Boredroom's own ANTHROPIC_API_KEY through resolveAssistant) reads
 *    their newest 150 signals, what is learned now, their stated preferences and what they removed, and returns at most
 *    12 habits; the server keeps only what passes lib/learning's second guard. One claim per run (the row's
 *    last_run_at), so two turns at once never learn twice. Its tokens go to `ai_usage` as purpose 'learning' for the
 *    workspace with no person (the Control Center's AI usage counts it; owners never see who has learning on), and it
 *    is not one of the person's 150 requests a day. No model call when there is nothing new to read.
 * 3. Control: listLearned / deleteLearned / forgetAllLearned / setLearning for Settings › Your assistant, and
 *    learnedForModel for her uncached situation. A deleted habit stays as a hidden "dismissed" row (its words only) so it
 *    is not learned again; "Forget everything" deletes every row and signal and starts again from now.
 *
 * Private like preferences (migration 0067's row security; owners, HR and leads read nothing). While someone else is
 * signed in as the person the list is hidden, nothing changes and nothing is recorded. Before 0067 the list reads
 * `ready: false`, changes answer 503 NOT_READY and nothing is recorded or learned (server/lib/schema-0067).
 */
import { after } from "next/server";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden, notFound } from "@/server/lib/errors";
import { verifyPayload } from "@/server/lib/crypto";
import { forget0067, isMissingSchema, retryWithout0067, schema0067Ready } from "@/server/lib/schema-0067";
import { LEARNING_LIMITS, LEARNING_WORDS as W, isLearnedKind, type LearnedHabit, type LearnedList } from "@/lib/learning";
import {
  LEARNING_SYSTEM, SAVE_HABITS_TOOL, acceptHabits, isCorrection, learningModel, learningUserMessage, localStamp, signalWords,
  type CurrentHabit,
} from "@/server/services/learning-prompt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notReady = () => new AppError(503, "NOT_READY", W.errors.notReady);
const msg = (err: unknown) => String((err as { message?: string } | null)?.message ?? err ?? "");
/** Contexts that are never the person at the keyboard (copilot's NON_INTERACTIVE_SESSIONS): nothing is recorded for them. */
const NOT_THEM: ReadonlySet<string> = new Set(["followup", "routine", "brenda.daily_report", "standup"]);
const recordsFor = (ctx: OrgContext) => !ctx.user.impersonation && !NOT_THEM.has(ctx.user.sessionId);

type Signal = { kind: "request" | "correction" | "ran" | "asked" | "confirmed" | "declined" | "mac"; detail: string };
export type Channel = "chat" | "look" | "mac";

// ---- After the answer -----------------------------------------------------------------------------------------------

const pending = new Set<Promise<unknown>>();
/** Runs `fn` after the response (Next's `after`); outside a request (tests, scripts) at once, `settleLearning` waits. */
function later(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((err: unknown) => { console.warn(`[learning] ${(err as { code?: string })?.code ?? msg(err).slice(0, 120)}`); });
  try { after(run); }
  catch {
    const p = run();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
}
/** Waits for every write and run `later` started outside a request (tests). */
export async function settleLearning(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
/** In tests the learning run after a turn only happens when a test asks for it (it would take a scripted model's answer). */
const autoRun = () => process.env.NODE_ENV !== "test" || process.env.BRENDA_LEARNING_AUTORUN === "1";

// ---- Signals --------------------------------------------------------------------------------------------------------

type State = { enabled: boolean; turns_since: number; last_run_at: string | null };

/** Whether a run is due from the person's state (owner decision, 28 October 2026: every ~15 turns, or once a day). */
export function learningDue(s: Pick<State, "turns_since" | "last_run_at">, now = Date.now()): boolean {
  const since = s.last_run_at ? now - Date.parse(s.last_run_at) : Infinity;
  if (s.turns_since >= LEARNING_LIMITS.everyTurns && since >= LEARNING_LIMITS.minGapMinutes * 60_000) return true;
  return s.turns_since >= LEARNING_LIMITS.dailyMinTurns && since >= LEARNING_LIMITS.dailyHours * 3_600_000;
}

/**
 * Writes the signals as the person, counting `turns` towards the next run, when 0067 is applied and their switch is on
 * (a person without a row is on). Returns the state after it, or null when nothing was written.
 */
async function writeSignals(ctx: OrgContext, channel: Channel, signals: Signal[], turns: number): Promise<State | null> {
  const rows = signals.map((s) => ({ ...s, detail: signalWords(s.detail) })).filter((s) => s.detail).slice(0, 20);
  if (!rows.length && !turns) return null;
  try {
    return await retryWithout0067(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0067Ready(db))) return null;
      const s = await db.maybeOne<State>(
        `INSERT INTO assistant_learning AS l (membership_id, organisation_id, turns_since) VALUES ($1, $2, $3)
         ON CONFLICT (membership_id) DO UPDATE SET turns_since = l.turns_since + EXCLUDED.turns_since WHERE l.enabled
         RETURNING enabled, turns_since, last_run_at`, [ctx.membership.id, ctx.org.id, turns]);
      if (!s?.enabled) return null;
      if (rows.length) {
        await db.query(
          `INSERT INTO assistant_signals(organisation_id, membership_id, kind, channel, detail)
           SELECT $1, $2, x.kind, $3, x.detail FROM jsonb_to_recordset($4::jsonb) AS x(kind text, detail text)`,
          [ctx.org.id, ctx.membership.id, channel, JSON.stringify(rows)]);
      }
      return s;
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0067(); return null; }
    throw err;
  }
}

/** The turn's signals: the person's words (or a correction), what ran, what waits for Confirm. */
export function turnSignals(o: { words?: string | null; actions?: readonly { kind: string }[]; proposals?: readonly { kind: string; tool?: string }[]; extra?: readonly Signal[] }): Signal[] {
  const out: Signal[] = [];
  const words = signalWords(o.words ?? "");
  if (words) out.push({ kind: isCorrection(words) ? "correction" : "request", detail: words });
  for (const k of new Set((o.actions ?? []).map((a) => a.kind).filter(Boolean))) out.push({ kind: "ran", detail: k });
  for (const t of new Set((o.proposals ?? []).filter((p) => p.kind === "confirm" && p.tool).map((p) => p.tool as string))) out.push({ kind: "asked", detail: t });
  out.push(...(o.extra ?? []));
  return out;
}

/**
 * One turn of the person's own (owner decision, 28 October 2026), recorded after the answer and, when it made a run due,
 * learning right after it. Never throws, never delays the reply.
 */
export function noteTurn(ctx: OrgContext, o: { channel: Channel; words?: string | null; actions?: readonly { kind: string }[]; proposals?: readonly { kind: string; tool?: string }[]; extra?: readonly Signal[] }): void {
  if (!recordsFor(ctx)) return;
  const signals = turnSignals(o);
  later(async () => {
    const s = await writeSignals(ctx, o.channel, signals, 1);
    if (s && autoRun() && learningDue(s)) await learnNow(ctx);
  });
}

/** A Confirm card answered: confirmed (the press ran it) or declined ("Not now"). Not a turn. */
export function noteAnswer(ctx: OrgContext, tool: string, answer: "confirmed" | "declined", channel: Channel = "chat"): void {
  if (!recordsFor(ctx) || !/^[a-z_]{1,60}$/.test(tool)) return;
  later(() => writeSignals(ctx, channel, [{ kind: answer, detail: tool }], 0));
}

/**
 * "Not now" on a Confirm card in the web chat: the card's own token says which tool it was and that it is this person's
 * (the signature is checked; an expired card still counts as declined). Nothing runs. `{ noted }`: whether it was theirs.
 */
export function noteDeclined(ctx: OrgContext, token: string): { noted: boolean } {
  const p = verifyPayload<{ k?: string; o?: string; m?: string; tool?: string }>(token);
  if (!p || p.k !== "brenda" || p.o !== ctx.org.id || p.m !== ctx.membership.id || typeof p.tool !== "string") return { noted: false };
  noteAnswer(ctx, p.tool, "declined");
  return { noted: true };
}

/**
 * What the person answered to a task on their Mac (services/act answerTask): yes or no, its kind, the apps it opens and
 * the formats it writes. Never a file's name, a folder or a page's address.
 */
export function noteMacAnswer(ctx: OrgContext, o: { yes: boolean; kind: string; apps: string[]; formats: string[] }): void {
  if (!recordsFor(ctx)) return;
  const apps = [...new Set(o.apps.map((a) => signalWords(a).slice(0, 40)).filter(Boolean))].slice(0, 4);
  const formats = [...new Set(o.formats.filter((f) => /^[a-z]{2,5}$/.test(f)))].slice(0, 4);
  const detail = [`${o.yes ? "yes" : "no"} to a ${/^[a-z]{1,10}$/.test(o.kind) ? o.kind : "task"} on the Mac`, apps.length ? `apps: ${apps.join(", ")}` : "", formats.length ? `formats: ${formats.join(", ")}` : ""].filter(Boolean).join("; ");
  later(() => writeSignals(ctx, "mac", [{ kind: "mac", detail }], 0));
}

/** The person's own time zone (their quiet hours' when set), else the organisation's, for the signals' local times. */
async function personZone(ctx: OrgContext): Promise<string> {
  try { const { quietHoursFor } = await import("@/server/services/routines"); return (await quietHoursFor(ctx))?.timezone || ctx.org.timezone; }
  catch { return ctx.org.timezone; }
}

// ---- Learning -------------------------------------------------------------------------------------------------------

type ModelClient = { messages: { create(req: Record<string, unknown>): Promise<{ content: { type: string; name?: string; input?: unknown }[]; stop_reason?: string | null; model?: string; usage?: Record<string, number | null> }> } };

/**
 * One learning run for the person, when due (or `force`, for tests and scripts): claims the run, reads their signals
 * since the last "Forget everything", asks the model, keeps what passes the second guard and replaces the active set.
 * `{ ran }`: whether the model was asked; `kept`: active habits after it. Never throws for the model.
 */
export async function learnNow(ctx: OrgContext, o: { force?: boolean } = {}): Promise<{ ran: boolean; kept?: number }> {
  if (!recordsFor(ctx) || !ctx.plan?.features?.AI_ASSISTANT) return { ran: false };
  const { resolveAssistant } = await import("@/server/services/assistant");
  const conn = await resolveAssistant(ctx.org.id).catch(() => null);
  if (!conn) return { ran: false };
  type Claim = { forgotten_at: string | null; signals: { kind: string; channel: string; detail: string; created_at: string }[]; current: CurrentHabit[]; removed: string[] };
  const claim = await retryWithout0067(() => withUser(ctx.user.profileId, async (db): Promise<Claim | null> => {
    if (!(await schema0067Ready(db))) return null;
    const c = await db.maybeOne<{ forgotten_at: string | null }>(
      `UPDATE assistant_learning SET last_run_at = now(), turns_since = 0
        WHERE membership_id = $1 AND organisation_id = $2 AND enabled
          AND ($3 OR (turns_since >= $4 AND (last_run_at IS NULL OR last_run_at < now() - make_interval(mins => $5)))
                  OR (turns_since >= $6 AND (last_run_at IS NULL OR last_run_at < now() - make_interval(hours => $7))))
        RETURNING forgotten_at`,
      [ctx.membership.id, ctx.org.id, !!o.force, LEARNING_LIMITS.everyTurns, LEARNING_LIMITS.minGapMinutes, LEARNING_LIMITS.dailyMinTurns, LEARNING_LIMITS.dailyHours]);
    if (!c) return null;
    const signals = await db.query<Claim["signals"][number]>(
      `SELECT kind, channel, detail, created_at FROM assistant_signals
        WHERE membership_id = $1 AND created_at > now() - make_interval(days => $2) AND ($3::timestamptz IS NULL OR created_at > $3)
        ORDER BY created_at DESC LIMIT $4`, [ctx.membership.id, LEARNING_LIMITS.keepDays, c.forgotten_at, LEARNING_LIMITS.signalsPerRun]);
    const rows = await db.query<{ id: string; body: string; kind: string; confidence: number; evidence: number; dismissed: boolean }>(
      `SELECT id, body, kind, confidence, evidence, dismissed_at IS NOT NULL AS dismissed FROM assistant_learned WHERE membership_id = $1 ORDER BY created_at, id`, [ctx.membership.id]);
    return {
      forgotten_at: c.forgotten_at, signals: signals.reverse(),
      current: rows.filter((r) => !r.dismissed).map((r) => ({ id: r.id, body: r.body, kind: isLearnedKind(r.kind) ? r.kind : "other", confidence: r.confidence, evidence: r.evidence })),
      removed: rows.filter((r) => r.dismissed).map((r) => r.body),
    };
  })).catch((err: unknown) => { if (isMissingSchema(err)) { forget0067(); return null; } throw err; });
  if (!claim || !claim.signals.length) return { ran: false };

  const { preferencesForModel } = await import("@/server/services/preferences");
  const preferences = (await preferencesForModel(ctx).catch(() => [])).map((p) => p.body);
  const zone = await personZone(ctx);
  const content = learningUserMessage({
    signals: claim.signals.map((s) => ({ at: localStamp(s.created_at, zone), kind: s.kind, channel: s.channel, detail: s.detail })),
    current: claim.current, preferences, removed: claim.removed,
  });
  const model = learningModel();
  let input: unknown = null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: conn.apiKey, maxRetries: 0, timeout: 30_000 }) as unknown as ModelClient;
    const res = await client.messages.create({
      model, max_tokens: 1500, system: LEARNING_SYSTEM, tools: [SAVE_HABITS_TOOL], tool_choice: { type: "tool", name: SAVE_HABITS_TOOL.name },
      messages: [{ role: "user", content }],
    });
    const { newRequestId, recordWorkspaceUsage } = await import("@/server/services/ai-usage");
    // The workspace's own row, no person (owners never see who has learning on); never one of the person's 150 a day.
    await recordWorkspaceUsage(ctx.org.id, { purpose: "learning", model: res.model ?? model, usage: res.usage as never, requestId: newRequestId() });
    if (res.stop_reason === "refusal") return { ran: true };
    input = res.content.find((b) => b.type === "tool_use" && b.name === SAVE_HABITS_TOOL.name)?.input ?? null;
  } catch (err) {
    console.warn(`[learning] the model could not learn this time: ${msg(err).slice(0, 160)}`);
    return { ran: true };
  }
  if (!input) return { ran: true };
  const accepted = acceptHabits(input, { current: claim.current, preferences, removed: claim.removed });
  // A write the database refuses (a check, the cap) keeps the old set: the run is over either way.
  const kept = await retryWithout0067(() => withUser(ctx.user.profileId, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assistant_learned:${ctx.membership.id}`]);
    // Switched off, or "Forget everything" pressed, while the model thought: nothing is kept.
    const now = await db.maybeOne<{ enabled: boolean; forgotten_at: string | null }>(`SELECT enabled, forgotten_at FROM assistant_learning WHERE membership_id = $1`, [ctx.membership.id]);
    if (!now?.enabled || (now.forgotten_at ?? null) !== (claim.forgotten_at ?? null)) return null;
    const keep = accepted.filter((h) => h.id).map((h) => h.id as string);
    await db.query(`DELETE FROM assistant_learned WHERE membership_id = $1 AND dismissed_at IS NULL AND NOT (id = ANY($2::uuid[]))`, [ctx.membership.id, keep]);
    for (const h of accepted) {
      if (h.id) {
        await db.query(
          `UPDATE assistant_learned SET body = $3, kind = $4, confidence = $5, evidence = $6, last_seen = CASE WHEN $7 THEN now() ELSE last_seen END
            WHERE id = $1 AND membership_id = $2 AND dismissed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM assistant_learned o WHERE o.membership_id = $2 AND o.id <> $1 AND lower(o.body) = lower($3))`,
          [h.id, ctx.membership.id, h.body, h.kind, h.confidence, h.evidence, h.seen]);
      } else {
        await db.query(
          `INSERT INTO assistant_learned(organisation_id, membership_id, body, kind, confidence, evidence) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (membership_id, lower(body)) DO NOTHING`,
          [ctx.org.id, ctx.membership.id, h.body, h.kind, h.confidence, h.evidence]);
      }
    }
    return (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM assistant_learned WHERE membership_id = $1 AND dismissed_at IS NULL`, [ctx.membership.id])).n;
  })).catch((err: unknown) => { console.warn(`[learning] could not keep what was learned: ${(err as { code?: string })?.code ?? "error"}`); return null; });
  return { ran: true, ...(kept === null ? {} : { kept }) };
}

// ---- Reading --------------------------------------------------------------------------------------------------------

type Row = { id: string; body: string; kind: string; confidence: number; evidence: number; last_seen: string; created_at: string };
const toHabit = (r: Row): LearnedHabit => ({ id: r.id, body: r.body, kind: isLearnedKind(r.kind) ? r.kind : "other", confidence: r.confidence, evidence: r.evidence, lastSeen: r.last_seen, createdAt: r.created_at });

/** The person's list, the most confident first; hidden while someone else is signed in as them; `ready: false` before 0067. */
export async function listLearned(ctx: OrgContext): Promise<LearnedList> {
  const none = (ready: boolean, hidden: boolean, enabled = true): LearnedList => ({ ready, hidden, enabled, items: [], max: LEARNING_LIMITS.max });
  try {
    return await retryWithout0067(() => withUser(ctx.user.profileId, async (db): Promise<LearnedList> => {
      if (!(await schema0067Ready(db))) return none(false, !!ctx.user.impersonation);
      if (ctx.user.impersonation) return none(true, true);
      return readList(db, ctx);
    }));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0067();
    return none(false, !!ctx.user.impersonation);
  }
}

async function readList(db: Db, ctx: OrgContext): Promise<LearnedList> {
  const s = await db.maybeOne<{ enabled: boolean }>(`SELECT enabled FROM assistant_learning WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id]);
  const rows = await db.query<Row>(
    `SELECT id, body, kind, confidence, evidence, last_seen, created_at FROM assistant_learned
      WHERE membership_id = $1 AND organisation_id = $2 AND dismissed_at IS NULL ORDER BY confidence DESC, last_seen DESC, id LIMIT $3`,
    [ctx.membership.id, ctx.org.id, LEARNING_LIMITS.max]);
  return { ready: true, hidden: false, enabled: s?.enabled ?? true, items: rows.map(toHabit), max: LEARNING_LIMITS.max };
}

/**
 * The habits as the model reads them (her uncached situation): id and words, the most confident first, at most 12.
 * [] before 0067, while someone else is signed in as the person, or on any failure. Never throws. Kept while learning
 * is switched off (the switch stops new learning; the person deletes what they don't want).
 */
export async function learnedForModel(ctx: OrgContext): Promise<{ id: string; body: string }[]> {
  if (ctx.user.impersonation) return [];
  try {
    return await retryWithout0067(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0067Ready(db))) return [];
      return db.query<{ id: string; body: string }>(
        `SELECT id, body FROM assistant_learned WHERE membership_id = $1 AND organisation_id = $2 AND dismissed_at IS NULL
          ORDER BY confidence DESC, last_seen DESC, id LIMIT $3`, [ctx.membership.id, ctx.org.id, LEARNING_LIMITS.max]);
    }));
  } catch (err) {
    if (isMissingSchema(err)) forget0067();
    else console.warn(`[learning] reading for the model: ${msg(err).slice(0, 120)}`);
    return [];
  }
}

// ---- Changing -------------------------------------------------------------------------------------------------------

async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated);
  try {
    return await retryWithout0067(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0067Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0067(); throw notReady(); }
    throw err;
  }
}

/** Deletes one habit (it stays hidden as dismissed, so it isn't learned again); 404 when it is not theirs. */
export async function deleteLearned(ctx: OrgContext, id: string): Promise<{ deleted: true; body: string }> {
  if (!UUID.test(id)) throw notFound(W.errors.notFound);
  return asPerson(ctx, async (db) => {
    const r = await db.maybeOne<{ body: string }>(
      `UPDATE assistant_learned SET dismissed_at = now() WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 AND dismissed_at IS NULL RETURNING body`,
      [id, ctx.membership.id, ctx.org.id]);
    if (!r) throw notFound(W.errors.notFound);
    return { deleted: true as const, body: r.body };
  });
}

/** "Forget everything": every habit (dismissed ones too) and every signal go; learning starts again from now. */
export async function forgetAllLearned(ctx: OrgContext): Promise<LearnedList> {
  return asPerson(ctx, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assistant_learned:${ctx.membership.id}`]);
    await db.query(`DELETE FROM assistant_learned WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id]);
    await db.query(`DELETE FROM assistant_signals WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id]);
    await db.query(
      `INSERT INTO assistant_learning AS l (membership_id, organisation_id, forgotten_at) VALUES ($1, $2, now())
       ON CONFLICT (membership_id) DO UPDATE SET forgotten_at = now(), turns_since = 0`, [ctx.membership.id, ctx.org.id]);
    return readList(db, ctx);
  });
}

/**
 * The switch "Learn from how I use Brenda" (on by default). Off: nothing is recorded or learned from then on, and the
 * signals kept so far are deleted (what was learned stays listed until the person deletes it).
 */
export async function setLearning(ctx: OrgContext, enabled: boolean): Promise<LearnedList> {
  return asPerson(ctx, async (db) => {
    await db.query(
      `INSERT INTO assistant_learning AS l (membership_id, organisation_id, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (membership_id) DO UPDATE SET enabled = EXCLUDED.enabled, turns_since = CASE WHEN EXCLUDED.enabled THEN l.turns_since ELSE 0 END`,
      [ctx.membership.id, ctx.org.id, enabled]);
    if (!enabled) await db.query(`DELETE FROM assistant_signals WHERE membership_id = $1 AND organisation_id = $2`, [ctx.membership.id, ctx.org.id]);
    return readList(db, ctx);
  });
}

// ---- The purge ------------------------------------------------------------------------------------------------------

/** The worker's part of system.purge_expired: signals older than 30 days go. No-op before 0067. Counts only. */
export async function purgeSignals(): Promise<{ deleted: number }> {
  try {
    return await withWorker(async (db) => {
      if (!(await schema0067Ready(db))) return { deleted: 0 };
      const r = await db.query<{ id: string }>(`DELETE FROM assistant_signals WHERE created_at < now() - make_interval(days => $1) RETURNING id`, [LEARNING_LIMITS.keepDays]);
      return { deleted: r.length };
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0067(); return { deleted: 0 }; }
    throw err;
  }
}
