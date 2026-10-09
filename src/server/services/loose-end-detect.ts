/**
 * The person's own loose ends (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part;
 * contract B.4): their own assistant looks through the conversations they can read for promises they made ("I'll send the
 * deck Thursday"), things asked of them ("Olu, can you review X by Friday?") and things they asked of others ("Ben, can
 * you fix the login bug?") that never became a to-do, reminder, follow-up or commitment. On demand ("Any loose ends?",
 * the Loose ends page) and as the `loose_ends` routine.
 *
 * - Everything is read AS THE PERSON (`withUser`): row-level security decides which conversations; in group
 *   conversations only messages that involve them (they wrote it, it mentions or names them, it replies to them); a direct
 *   thread is theirs.
 * - The same prefilter as the workspace's scan, then, when the AI is on and the person has requests left today, ONE
 *   request for the whole scan (batches of 20 lines; 3 calls on demand, 1 for a routine), recorded against their 150 a day
 *   (purpose 'loose_ends'). Without it, only the clearest (prefilter 0.7 or more), and the result says why.
 * - What is already captured is never suggested: messages already a loose end, dismissed ("Not a commitment") or behind a
 *   commitment of theirs (loose-ends.ts knownLooseEndMessages), and anything close enough to one of their own tasks,
 *   reminders, follow-ups or requests made since (the same content words, Jaccard 0.6 or more).
 * - Private: the rows are the person's alone (loose-ends.ts writes them as the person). Nothing is added to a list or
 *   sent to anyone here: every action is the person's own choice afterwards.
 *
 * This file never prepares or presses a Confirm and never loads the copilot (tests/unit/routine-guard.test.ts).
 *
 * The async standup (owner decisions, 8–9 October 2026: phase 7c): a posted standup is the day's plan, not a promise, so
 * after migration 0050 it is never a loose end. Read as the person, row-level security shows them only their own
 * standups, so someone else's posted standup is recognised by its shape too: a message their assistant posted for them
 * in a team channel that starts as every standup does ("Standup, Friday 9 October"; lib/standup standupPostBody).
 */
import { withSystem, withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { forget0048, isMissingSchema, schema0048Ready } from "@/server/lib/schema-0048";
import { forget0050, schema0050Ready } from "@/server/lib/schema-0050";
import { resolveAssistant, type AssistantConnection } from "@/server/services/assistant";
import { aiAllowance, newRequestId, recordUsage } from "@/server/services/ai-usage";
import { requireAbility } from "@/server/services/abilities";
import { builtinTitle, prefilter, type PrefilterResult, type Reader } from "@/server/services/commitment-prefilter";
import { classifyBatch, type Classified } from "@/server/services/commitment-classify";
import { SCAN_COLUMNS, SCAN_JOINS, scanFilter, classifyLinesFor, dueFromWords, namedIn, numberBatches, prefilterInputOf, scanMessageOf, type Batch, type ScanMessage, type ScanRow } from "@/server/services/commitment-detect";
import { namesPerson } from "@/server/services/routine-templates";
import { LOOP_LIMITS, LOOP_WORDS, type DetectedLooseEnd, type LooseEndKind, type LooseEndScanResult } from "@/lib/commitments";

const DAY_MS = 86_400_000;
/**
 * Someone else's posted standup, by its shape (their own row is not readable as this person): sent by their assistant in
 * a team channel, starting "Standup, " (owner decisions, 8–9 October 2026: phase 7c).
 */
export const OTHERS_STANDUP_FILTER = `NOT (m.author_kind = 'via_assistant' AND c.kind = 'team' AND m.body LIKE 'Standup, %')`;
const warn = (what: string) => (err: unknown) => console.warn(`[loose ends] ${what}: ${(err as Error)?.message ?? String(err)}`);

// ---- Already captured elsewhere (pure) -------------------------------------------------------------------------------------

const STOP_WORDS = new Set(["the", "a", "an", "to", "and", "or", "of", "for", "on", "in", "at", "by", "with", "it", "is", "be", "this", "that", "my", "your",
  "our", "their", "me", "you", "i", "we", "can", "could", "will", "would", "please", "pls", "do", "up", "out", "from", "about", "as", "so", "just", "also",
  "get", "send", "make"]);

/** The content words of a title: lower case, letters and digits, stop words out. */
export function contentWords(s: string): Set<string> {
  return new Set(String(s ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

/** Jaccard similarity of two titles' content words (0 when either has none). */
export function jaccard(a: string, b: string): number {
  const x = contentWords(a), y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Whether a found title is already captured: one of `captured`, made after the message less an hour, is close enough. */
export function capturedElsewhere(title: string, messageAt: string, captured: { text: string; at: string }[]): boolean {
  const from = Date.parse(messageAt) - 3_600_000;
  return captured.some((c) => Date.parse(c.at) >= from && jaccard(title, c.text) >= LOOP_LIMITS.capturedSimilarity);
}

/**
 * A finding as a loose end of the person's (contract B.4 step 6): their promise (or agreement) → promise; an ask of them
 * → asked_of_me; their ask of someone else → i_asked; anything else is not theirs. `me` the person; `writer` the line's.
 */
export function looseEndKindOf(f: { kind: "promise" | "ask" | "agreement"; writer: string; to: string | null; direct: boolean }, me: string): { kind: LooseEndKind; counterpart: string | null } | null {
  if (f.kind === "promise") return f.writer === me ? { kind: "promise", counterpart: f.to && f.to !== me ? f.to : null } : null;
  if (f.kind === "agreement") return f.writer === me ? { kind: "promise", counterpart: f.to && f.to !== me ? f.to : null } : null;
  if (f.writer === me) return f.to && f.to !== me ? { kind: "i_asked", counterpart: f.to } : null;
  if (f.to === me || (f.direct && !f.to)) return { kind: "asked_of_me", counterpart: f.writer };
  return null;
}

// ---- The scan ----------------------------------------------------------------------------------------------------------------

type Read = {
  messages: ScanMessage[]; readers: Map<string, Reader[]>; names: Map<string, string>;
  captured: { text: string; at: string }[]; known: Set<string>;
};

const notReady = (): LooseEndScanResult => ({ ready: false, scanned: 0, candidates: 0, found: [], engine: "none", note: null });

/**
 * Looks for the person's loose ends now. `days`: how far back (1 to 14, 7 by default). `source` on_demand (the page, her
 * chat: at most once every 2 minutes, 429 otherwise) or routine. `maxModelCalls`: 3 on demand, 1 for a routine.
 * `ready: false` before migration 0048. Refused first (403 `ABILITY_OFF`, the catalogue's words) when loose ends are
 * switched off for the person, by the workspace or by themself, so no model call is made for a scan that could not keep
 * what it found (owner decisions, 8–9 October 2026: phase 7c; everything on before 0050).
 */
export async function scanLooseEnds(ctx: OrgContext, o: { days?: number; source?: "on_demand" | "routine"; useModel?: boolean; maxModelCalls?: number; now?: Date } = {}): Promise<LooseEndScanResult> {
  const now = o.now ?? new Date();
  const source = o.source ?? "on_demand";
  const days = Math.max(1, Math.min(LOOP_LIMITS.looseEndDaysMax, Math.round(o.days ?? LOOP_LIMITS.looseEndDaysDefault) || LOOP_LIMITS.looseEndDaysDefault));
  const me = ctx.membership.id;
  await requireAbility(ctx, "loose_ends");
  try {
    if (!(await withUser(ctx.user.profileId, (db) => schema0048Ready(db)))) return notReady();
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0048();
    return notReady();
  }
  // On demand: once every two minutes (her chat and the page share it); a routine runs on its own cadence.
  if (source === "on_demand") {
    const { rateLimitIn } = await import("@/server/auth");
    await withSystem((db) => rateLimitIn(db, `ai.looseends:${me}`, 1, LOOP_LIMITS.looseEndScanCooldownSeconds, LOOP_WORDS.errors.scanCooldown));
  }

  let read: Read;
  try {
    read = await withUser(ctx.user.profileId, async (db): Promise<Read> => {
      const since = new Date(now.getTime() - days * DAY_MS).toISOString();
      // Phase 7c: posted standups are left out once they exist (migration 0050).
      const v50 = await schema0050Ready(db);
      const filter = v50 ? `${scanFilter({ standups: true })} AND ${OTHERS_STANDUP_FILTER}` : scanFilter({ standups: false });
      const full = ctx.user.displayName.replace(/\s+/g, " ").trim();
      const first = full.split(" ")[0] ?? "";
      const likes = [full, ...([...first].filter((ch) => /\p{L}/u.test(ch)).length >= 3 && first !== full ? [first] : [])]
        .filter(Boolean).map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
      // Newest first: the 500 most recent that involve the person (they wrote it, it mentions them, it replies to them,
      // it is in a direct thread, or its words may name them, checked word by word below).
      const rows = await db.query<ScanRow & { mentions_me: boolean; replies_to_me: boolean }>(
        `SELECT ${SCAN_COLUMNS},
                EXISTS (SELECT 1 FROM message_mentions mm WHERE mm.message_id = m.id AND mm.kind = 'person' AND mm.membership_id = $2) AS mentions_me,
                (r.sender_membership_id = $2) AS replies_to_me
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN teams tm ON tm.id = c.team_id
         ${SCAN_JOINS}
         WHERE m.organisation_id = $1 AND ${filter}
           AND m.created_at >= $3::timestamptz AND m.created_at <= $4::timestamptz
           AND (c.archived_at IS NULL OR c.kind = 'direct')
           AND (m.sender_membership_id = $2 OR c.kind = 'direct' OR r.sender_membership_id = $2
                OR EXISTS (SELECT 1 FROM message_mentions mm WHERE mm.message_id = m.id AND mm.kind = 'person' AND mm.membership_id = $2)
                OR m.body ILIKE ANY($5::text[]))
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT $6`, [ctx.org.id, me, since, now.toISOString(), likes, LOOP_LIMITS.looseEndMessagesPerScan]);
      // A name in the words counts only as a whole word (never "Ben" in "Benefits").
      const involved = rows.filter((r) => r.author === me || r.conversation_kind === "direct" || r.mentions_me || r.replies_to_me || namesPerson(r.body, ctx.user.displayName));
      const messages = involved.map(scanMessageOf).reverse();
      const readers = new Map<string, Reader[]>();
      const names = new Map<string, string>();
      for (const conv of [...new Set(messages.map((m) => m.conversationId))]) {
        const rs = await db.query<{ membership_id: string; name: string | null }>(
          `SELECT r.membership_id, p.display_name AS name FROM app_conversation_readers($1) r
           JOIN memberships m ON m.id = r.membership_id JOIN profiles p ON p.id = m.user_id`, [conv]);
        readers.set(conv, rs.map((x) => ({ membershipId: x.membership_id, name: x.name ?? "Someone" })));
        for (const x of rs) names.set(x.membership_id, x.name ?? "Someone");
      }
      // What the person already captured in the last 14 days: their tasks, reminders, follow-ups and requests' to-dos.
      const lookback = new Date(now.getTime() - LOOP_LIMITS.capturedLookbackDays * DAY_MS).toISOString();
      const captured = await db.query<{ text: string | null; at: string }>(
        `SELECT title AS text, created_at AS at FROM tasks WHERE organisation_id = $1 AND (assignee_membership_id = $2 OR created_by = $2) AND created_at >= $3::timestamptz
         UNION ALL SELECT body, created_at FROM brenda_reminders WHERE organisation_id = $1 AND membership_id = $2 AND created_at >= $3::timestamptz
         UNION ALL SELECT question, created_at FROM follow_ups WHERE organisation_id = $1 AND requester_membership_id = $2 AND created_at >= $3::timestamptz
         UNION ALL SELECT payload->>'title', created_at FROM assistant_items WHERE organisation_id = $1 AND sender_membership_id = $2 AND kind = 'request'
                     AND payload->>'kind' = 'add_todo' AND created_at >= $3::timestamptz`, [ctx.org.id, me, lookback]);
      return { messages, readers, names, captured: captured.filter((c) => c.text).map((c) => ({ text: c.text as string, at: c.at })), known: new Set() };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0048();
    forget0050();
    return notReady();
  }
  const { knownLooseEndMessages, insertLooseEnds } = await import("@/server/services/loose-ends");
  if (read.messages.length) {
    const ids = [...new Set(read.messages.flatMap((m) => [m.id, ...(m.reply ? [m.reply.id] : []), ...(m.previous ? [m.previous.id] : [])]))];
    read.known = await knownLooseEndMessages(ctx, ids).catch((err) => { warn("reading what is already known")(err); return new Set<string>(); });
  }

  // Prefilter (the person a normal participant: kinds are mapped relative to them afterwards).
  const otherInDirect = (m: ScanMessage) => m.conversationKind === "direct" ? ((read.readers.get(m.conversationId) ?? []).find((r) => r.membershipId !== m.authorMembershipId)?.membershipId ?? null) : null;
  const scored = new Map<string, PrefilterResult>();
  for (const m of read.messages) {
    if (read.known.has(m.id)) continue;
    const r = prefilter(prefilterInputOf(m), read.readers.get(m.conversationId) ?? [], { otherInDirect: otherInDirect(m) });
    if (r.score >= LOOP_LIMITS.prefilterMin) scored.set(m.id, r);
  }
  const candidates = read.messages.filter((m) => scored.has(m.id));
  const byId = new Map(read.messages.map((m) => [m.id, m]));

  // The model, once for the scan, when the AI is on and the person has requests left today.
  let conn: AssistantConnection | null = null;
  let note: string | null = null;
  if (candidates.length && o.useModel !== false && process.env.NODE_ENV !== "test") {
    const allowance = ctx.plan.features.AI_ASSISTANT ? await aiAllowance(ctx).catch(() => null) : null;
    const connection = ctx.plan.features.AI_ASSISTANT ? await resolveAssistant(ctx.org.id).catch(() => null) : null;
    if (!connection || !ctx.plan.features.AI_ASSISTANT) note = LOOP_WORDS.looseEnds.builtinNote;
    else if (allowance?.ready && allowance.remaining <= 0) note = LOOP_WORDS.looseEnds.allowanceNote(allowance.limit);
    else conn = connection;
  } else if (candidates.length && process.env.NODE_ENV === "test") {
    note = LOOP_WORDS.looseEnds.builtinNote;
  }

  const found: DetectedLooseEnd[] = [];
  const handled = new Set<string>();
  let engine: LooseEndScanResult["engine"] = candidates.length ? "builtin" : "none";
  const tz = ctx.org.timezone;
  const isReader = (conv: string, id: string | null | undefined) => !!id && (read.readers.get(conv) ?? []).some((r) => r.membershipId === id);

  const add = (m: ScanMessage, f: { kind: "promise" | "ask" | "agreement"; to: string | null; context: string | null; title: string; due: string | null; dueWords: string | null; by: "claude" | "builtin"; confidence: number }) => {
    const k = looseEndKindOf({ kind: f.kind, writer: m.authorMembershipId, to: f.to, direct: m.conversationKind === "direct" }, me);
    if (!k) return;
    // An agreement to an ask already a loose end (or known otherwise) is that loose end, never its twin (review, 9 October 2026).
    if (f.context && read.known.has(f.context)) return;
    const counterpart = k.counterpart && isReader(m.conversationId, k.counterpart) ? k.counterpart : null;
    if ((k.kind === "asked_of_me" || k.kind === "i_asked") && !counterpart) return;
    if (capturedElsewhere(f.title, m.at, read.captured)) return;
    found.push({
      messageId: m.id, conversationId: m.conversationId, contextMessageId: f.context, kind: k.kind, counterpartMembershipId: counterpart,
      title: f.title, dueAt: f.due, dueWords: f.dueWords, detectedBy: f.by, confidence: f.confidence,
    });
  };

  if (conn) {
    const maxCalls = Math.max(1, Math.min(LOOP_LIMITS.looseEndModelCallsOnDemand, Math.round(o.maxModelCalls ?? (source === "routine" ? LOOP_LIMITS.looseEndModelCallsRoutine : LOOP_LIMITS.looseEndModelCallsOnDemand))));
    const batches: Batch[] = numberBatches(classifyLinesFor(candidates), {
      perCall: LOOP_LIMITS.looseEndCandidatesPerCall, names: read.names,
      extra: (l) => [me, ...(byId.get(l.messageId)?.mentions ?? []), ...namedIn(l.body, read.readers.get(l.conversationId) ?? []), ...(scored.get(l.messageId)?.addressee ? [scored.get(l.messageId)!.addressee!] : [])],
    }).slice(0, maxCalls);
    // One request for the whole scan: it counts once against the person's 150 a day.
    const requestId = newRequestId();
    for (const b of batches) {
      const items = await classifyBatch(b.lines, b.people, {
        connection: conn, timeZone: tz, now, requestId,
        record: (model, usage) => recordUsage(ctx, { purpose: "loose_ends", model, usage, requestId }),
      });
      if (items === null) continue;
      engine = "claude";
      for (const l of b.lines) if (l.candidate) handled.add(b.byN.get(l.n)!.messageId);
      for (const it of items) fromModel(it, b);
    }
  }

  function fromModel(it: Classified, b: Batch) {
    if (it.confidence < LOOP_LIMITS.modelAcceptLooseEnd) return;
    const line = b.byN.get(it.n);
    const m = line ? byId.get(line.messageId) : undefined;
    if (!m || read.known.has(m.id)) return;
    const context = it.kind === "agreement" && it.agreesTo !== null ? (b.byN.get(it.agreesTo)?.messageId ?? null) : null;
    add(m, { kind: it.kind, to: it.to, context, title: it.what, due: it.due, dueWords: it.dueWords, by: "claude", confidence: it.confidence });
  }

  // Without the model (or a batch it did not answer): the prefilter's reading, 0.7 or more.
  for (const m of candidates) {
    if (handled.has(m.id)) continue;
    const r = scored.get(m.id)!;
    if (r.score < LOOP_LIMITS.builtinAccept) continue;
    const top = r.signals[0];
    const title = top === "agreement" ? r.what : (r.what ?? builtinTitle(m.body, top));
    if (!title) continue;
    const base = top === "agreement" && r.agreesTo ? (r.agreesTo.id === m.reply?.id ? m.reply : m.previous) : null;
    const due = dueFromWords(r.dueWords, { timeZone: tz, now: new Date(base?.at ?? m.at) });
    add(m, {
      kind: top, to: top === "agreement" ? (r.agreesTo?.askerMembershipId ?? null) : r.addressee, context: top === "agreement" ? (r.agreesTo?.id ?? null) : null,
      title, due, dueWords: r.dueWords, by: "builtin", confidence: r.score,
    });
  }

  // An ask of the person and their own "On it" to it are one loose end (review, 9 October 2026): the agreement (a promise
  // with the ask as its context) is kept, the ask it answers is not stored beside it.
  const agreedAsks = new Set(found.filter((f) => f.kind === "promise" && f.contextMessageId).map((f) => `${f.contextMessageId}:${f.counterpartMembershipId ?? ""}`));
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    if (f.kind === "asked_of_me" && agreedAsks.has(`${f.messageId}:${f.counterpartMembershipId ?? ""}`)) found.splice(i, 1);
  }

  // One per message and kind (the database holds the same), the strongest kept.
  const unique = new Map<string, DetectedLooseEnd>();
  for (const f of found) {
    const key = `${f.messageId}:${f.kind}`;
    const had = unique.get(key);
    if (!had || f.confidence > had.confidence) unique.set(key, f);
  }
  const views = unique.size ? await insertLooseEnds(ctx, [...unique.values()], { source }) : [];
  return { ready: true, scanned: read.messages.length, candidates: candidates.length, found: views, engine, note: engine === "claude" ? null : candidates.length ? note : null };
}
