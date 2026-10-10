/**
 * Brenda's notes on calls (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, "Brenda can join calls:
 * notes, recap and commitments, WITH CONSENT"; contract E.1–E.4). This file is the people's side: whether notes can be
 * offered at all, switching them on and off, each person's own answer, the lines a consenting person's own device sends,
 * reading the transcript, and the worker's deletion of transcripts 7 days after the recap. The recap itself is
 * call-recap.ts.
 *
 * The rule in one line: no notes without each person's own yes, no audio ever leaves a device, only text lines a person's
 * own device wrote from their own microphone reach the server, only the people who were on the call can read them, and
 * they are gone 7 days after the recap.
 *
 * - Every step runs AS THE PERSON through migration 0054's definer functions, which answer with a word
 *   (app_call_set_notes, app_call_consent, app_call_add_lines); the person can never write the tables directly.
 * - Notes need the AI assistant on the plan, an AI connection and the workspace's `call_notes` ability (decision D8);
 *   switching on is checked here first, switching off never is. Lines are checked too (fix review, 10 October 2026):
 *   once the workspace no longer offers notes (an owner or HR switched them off, the plan or the AI connection went),
 *   the call's notes switch off and its devices stop; switching the ability off stops notes on every live call and skips
 *   every recap still waiting, at once (stopCallNotes), and a recap being written is not posted (call-recap.ts).
 * - Nothing here works while someone else is signed in as the person (support): a person's consent and words are theirs.
 * - Lines are never logged; audit rows hold ids only (`call.notes_on` / `call.notes_off`); a person's own answer is not
 *   audited (a privacy choice).
 * - Before 0054 every step answers 503 NOT_READY (server/lib/schema-0054); without LiveKit configured the steps that need
 *   a live call answer 503 CALLS_NOT_CONFIGURED, the reads still work.
 */
import { z } from "zod";
import { withSystem, withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0054, isMissingSchema, retryWithout0054, schema0054Ready } from "@/server/lib/schema-0054";
import { livekitConfigured } from "@/server/lib/livekit";
import { rateLimitIn } from "@/server/auth";
import { aiConnected } from "@/server/services/assistant-profile";
import { abilitiesFor, abilitiesIn } from "@/server/services/abilities";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { audit } from "@/server/services/common";
import { getCallView } from "@/server/services/calls";
import { CALL_WORDS, type CallView } from "@/lib/calls";
import { NOTES_LIMITS, NOTES_WORDS as W, type NotesAvailability, type TranscriptLine } from "@/lib/call-notes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", CALL_WORDS.notReady);
const notConfigured = () => new AppError(503, "CALLS_NOT_CONFIGURED", CALL_WORDS.notConfigured);
const callNotFound = () => notFound(CALL_WORDS.errors.notFound);
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const DAY_MS = 86_400_000;

/** A person's consent and words are theirs: nothing here while someone else is signed in as them. */
function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated(firstOf(ctx.user.displayName)));
}

/** Whether 0054 is applied (as the person). False on a database restored to before it. */
async function ready(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0054Ready(db)); } catch (err) { if (isMissingSchema(err)) { forget0054(); return false; } throw err; }
}

/** Runs `fn` as the person; 503 NOT_READY before 0054 (or a database restored to before it). */
async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0054(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0054Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0054(); throw notReady(); }
    throw err;
  }
}

/** The call's view for the person after a step (null: they can no longer see it). */
async function viewOrThrow(ctx: OrgContext, callId: string): Promise<CallView> {
  const v = await getCallView(ctx, callId);
  if (!v) throw callNotFound();
  return v;
}

// ---- Whether notes can be offered (E.1) ------------------------------------------------------------------------------------

/**
 * Whether notes can be offered on this workspace's calls, and why not (decision D8): `not_ready` before 0054, `plan` without
 * the AI assistant on the plan, `no_ai` without an AI connection, `off` when an owner or HR switched the `call_notes`
 * ability off (Settings → Brenda → Abilities). Never throws.
 */
export async function callNotesAvailability(ctx: OrgContext): Promise<NotesAvailability> {
  let ok = false;
  try { ok = await ready(ctx); } catch { ok = false; }
  if (!ok) return { available: false, reason: "not_ready" };
  if (ctx.plan.features.AI_ASSISTANT !== true) return { available: false, reason: "plan" };
  if (!(await aiConnected(ctx.org.id))) return { available: false, reason: "no_ai" };
  const a = await abilitiesFor(ctx);
  if (a.workspaceOff.includes("call_notes")) return { available: false, reason: "off" };
  return { available: true, reason: null };
}

/**
 * Whether the organisation still offers notes, as the worker sees it (no person): the plan's AI assistant and the
 * workspace's `call_notes` switch (fix review, 10 October 2026: switching notes off stopped neither the lines nor the
 * recap). The AI connection is the recap's own check (resolveAssistant). Nothing before 0054 (false).
 */
export async function orgOffersNotes(orgId: string): Promise<boolean> {
  if (!UUID.test(orgId)) return false;
  return withWorker(async (db) => {
    if (!(await schema0054Ready(db))) return false;
    if ((await resolveEntitlements(db, orgId)).features.AI_ASSISTANT !== true) return false;
    return !(await abilitiesIn(db, orgId, null)).workspaceOff.includes("call_notes");
  });
}

/**
 * An owner or HR switched the `call_notes` ability off: notes stop at once (fix review, 10 October 2026; the owner: "stop
 * taking lines and skip the recap at once"). As the worker, in one transaction: notes off on every live call of the
 * organisation, so no device keeps writing words down (each call's change reaches its devices as a realtime event; a
 * device that still sends lines is refused, addCallLines); and every recap still waiting to be written ('pending') is
 * skipped as 'switched_off', so its page says so now. A call still running when it ends, and a recap being written at
 * this moment, are skipped by call-recap.ts, which asks again before the model and before writing what it answered.
 * Answers what it changed. Never throws.
 */
export async function stopCallNotes(orgId: string): Promise<{ calls: number; recaps: number }> {
  if (!UUID.test(orgId)) return { calls: 0, recaps: 0 };
  try {
    return await withWorker(async (db) => {
      if (!(await schema0054Ready(db))) return { calls: 0, recaps: 0 };
      const calls = await db.query<{ id: string }>(
        `UPDATE calls SET notes_state = 'off', notes_off_at = now() WHERE organisation_id = $1 AND state <> 'ended' AND notes_state = 'on' RETURNING id`, [orgId]);
      const recaps = await db.query<{ id: string }>(
        `UPDATE calls SET recap_state = 'skipped', recap_skipped = 'switched_off' WHERE organisation_id = $1 AND state = 'ended' AND recap_state = 'pending' RETURNING id`, [orgId]);
      return { calls: calls.length, recaps: recaps.length };
    });
  } catch (err) {
    console.warn(`[call-notes] stopping notes: ${((err as Error)?.message ?? String(err)).slice(0, 200)}`);
    return { calls: 0, recaps: 0 };
  }
}

// ---- Switching notes on and off (E.2) ------------------------------------------------------------------------------------

/**
 * "Brenda takes notes" on or off, by anyone in the call (switching on includes that person: their own yes). On: the
 * availability first (403 NOTES_NOT_AVAILABLE with its words), 20 a person per 10 minutes. 404 for a call the person
 * has no row on, 409 CALL_ENDED, 409 NOT_IN_CALL (not in the room now), 403 while impersonated, 503 before 0054 or
 * without LiveKit. Audited when it changed (ids only). Answers the call's view.
 */
export async function setCallNotes(ctx: OrgContext, callId: string, on: boolean): Promise<{ call: CallView }> {
  notWhileImpersonated(ctx);
  if (!isUuid(callId)) throw callNotFound();
  if (!(await ready(ctx))) throw notReady();
  if (!livekitConfigured()) throw notConfigured();
  if (on) {
    const a = await callNotesAvailability(ctx);
    if (!a.available) throw new AppError(403, "NOTES_NOT_AVAILABLE", W.errors.notAvailable(a.reason ?? "not_ready"), { details: { reason: a.reason } });
  }
  await withSystem((db) => rateLimitIn(db, `call.notes:${ctx.membership.id}`, 20, 600, W.errors.rateLimited));
  await asPerson(ctx, async (db) => {
    const before = await db.maybeOne<{ notes_state: string; organisation_id: string }>(`SELECT notes_state, organisation_id FROM calls WHERE id = $1`, [callId]);
    if (!before || before.organisation_id !== ctx.org.id) throw callNotFound();
    const r = await db.one<{ r: string }>(`SELECT app_call_set_notes($1, $2) AS r`, [callId, !!on]);
    switch (r.r) {
      case "ok": break;
      case "ended": throw conflict("CALL_ENDED", CALL_WORDS.errors.ended);
      case "not_in_call": throw conflict("NOT_IN_CALL", W.errors.notInCall);
      default: throw callNotFound();
    }
    const after = await db.one<{ notes_state: string }>(`SELECT notes_state FROM calls WHERE id = $1`, [callId]);
    if (after.notes_state !== before.notes_state) {
      await audit(db, {
        organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: on ? "call.notes_on" : "call.notes_off",
        subjectType: "call", subjectId: callId,
      });
    }
  });
  return { call: await viewOrThrow(ctx, callId) };
}

/**
 * The person's own answer while the call runs: "yes" (Include me) or "no" (Not me: their lines on this call are deleted
 * at once). Only someone who is or was in the call (404 otherwise), 409 CALL_ENDED once it ended, 422 for another word,
 * 403 while impersonated. Not audited (a person's own privacy choice). Answers the call's view.
 */
export async function setCallNoteConsent(ctx: OrgContext, callId: string, choice: "yes" | "no"): Promise<{ call: CallView }> {
  notWhileImpersonated(ctx);
  if (!isUuid(callId)) throw callNotFound();
  if (choice !== "yes" && choice !== "no") throw invalid(W.errors.badChoice, { consent: [W.errors.badChoice] });
  if (!(await ready(ctx))) throw notReady();
  if (!livekitConfigured()) throw notConfigured();
  await asPerson(ctx, async (db) => {
    const k = await db.maybeOne<{ organisation_id: string }>(`SELECT organisation_id FROM calls WHERE id = $1`, [callId]);
    if (!k || k.organisation_id !== ctx.org.id) throw callNotFound();
    const r = await db.one<{ r: string }>(`SELECT app_call_consent($1, $2) AS r`, [callId, choice]);
    switch (r.r) {
      case "ok": return;
      case "ended": throw conflict("CALL_ENDED", CALL_WORDS.errors.ended);
      case "bad_choice": throw invalid(W.errors.badChoice, { consent: [W.errors.badChoice] });
      default: throw callNotFound();
    }
  });
  return { call: await viewOrThrow(ctx, callId) };
}

// ---- Lines from the person's own device (E.3, E.4) ------------------------------------------------------------------------

export const callLinesSchema = z.object({
  lines: z.array(z.object({
    seq: z.number().int().min(0).max(10_000_000),
    at: z.number().int().min(0).max(8_640_000_000_000),
    text: z.string().max(4000).transform((s) => s.trim()).pipe(z.string().min(1).max(NOTES_LIMITS.lineMax)),
  })).min(1).max(NOTES_LIMITS.linesPerRequest),
});

/**
 * Lines the person's own device wrote down from their own microphone, 1 to 10 at a time, kept only while notes are on
 * (or went off under a minute ago), the person said yes and is (or was, under a minute ago) in the call and still reads
 * its conversation; each line once (its `seq`). The minute is for arrival: a line SPOKEN before notes were switched on,
 * before the person's own yes, after notes went off or after they left is refused by the database (counted in
 * `refused`; fix review, 10 October 2026). 240 requests a person per 10 minutes; at most 2,000 lines a person and
 * 20,000 a call. The workspace must still offer notes (fix review, 10 October 2026): if it no longer does (its switch,
 * the plan, the AI connection), the call's notes are switched off and the answer is 409 NOTES_OFF, which stops the
 * device for good. 403 NO_CONSENT, 409 NOTES_OFF / NOT_IN_CALL / TOO_MANY_LINES, 422 bad lines, 403 while impersonated.
 * Never logs the text.
 */
export async function addCallLines(ctx: OrgContext, callId: string, lines: { seq: number; at: number; text: string }[]): Promise<{ accepted: number; refused: number }> {
  notWhileImpersonated(ctx);
  if (!isUuid(callId)) throw callNotFound();
  const parsed = callLinesSchema.safeParse({ lines });
  if (!parsed.success) throw invalid(W.errors.badLines, { lines: [W.errors.badLines] });
  if (!(await ready(ctx))) throw notReady();
  if (!livekitConfigured()) throw notConfigured();
  await withSystem((db) => rateLimitIn(db, `call.lines:${ctx.membership.id}`, NOTES_LIMITS.requestsPer10Min, 600, W.errors.rateLimited));
  if (!(await callNotesAvailability(ctx)).available) {
    await withWorker((db) => db.query(
      `UPDATE calls SET notes_state = 'off', notes_off_at = now() WHERE id = $1 AND organisation_id = $2 AND state <> 'ended' AND notes_state = 'on'`,
      [callId, ctx.org.id]));
    throw conflict("NOTES_OFF", W.errors.notesOff);
  }
  return asPerson(ctx, async (db) => {
    const k = await db.maybeOne<{ organisation_id: string }>(`SELECT organisation_id FROM calls WHERE id = $1`, [callId]);
    if (!k || k.organisation_id !== ctx.org.id) throw callNotFound();
    const r = await db.one<{ r: { word: string; accepted: number; refused: number } }>(`SELECT app_call_add_lines($1, $2::jsonb) AS r`, [callId, JSON.stringify(parsed.data.lines)]);
    switch (r.r.word) {
      case "ok": return { accepted: Number(r.r.accepted) || 0, refused: Number(r.r.refused) || 0 };
      case "no_consent": throw new AppError(403, "NO_CONSENT", W.errors.noConsent);
      case "notes_off": throw conflict("NOTES_OFF", W.errors.notesOff);
      case "not_in_call": throw conflict("NOT_IN_CALL", W.errors.notInCall);
      case "too_many": throw conflict("TOO_MANY_LINES", W.errors.tooMany);
      case "bad_lines": throw invalid(W.errors.badLines, { lines: [W.errors.badLines] });
      default: throw callNotFound();
    }
  });
}

// ---- Reading the transcript ---------------------------------------------------------------------------------------------

/**
 * The call's transcript for someone who was ON it (joined at least once), as the person under row-level security; anyone
 * else, owners, HR and team leads included, 404. 403 while someone else is signed in as the person. Lines with their
 * speakers' names in the order they were said; `deleteAfter` from the recap (or the end + 7 days); `deleted` once the
 * worker removed them.
 */
export async function callTranscript(ctx: OrgContext, callId: string): Promise<{ lines: TranscriptLine[]; deleteAfter: string | null; deleted: boolean }> {
  if (ctx.user.impersonation) throw forbidden(W.errors.transcriptImpersonated);
  if (!isUuid(callId)) throw callNotFound();
  return asPerson(ctx, async (db) => {
    const k = await db.maybeOne<{ organisation_id: string; ended_at: string | null; was_on: boolean; recap_at: string | null; delete_after: string | null; deleted_at: string | null }>(
      `SELECT c.organisation_id, c.ended_at, app_call_was_on(c.id) AS was_on, r.created_at AS recap_at, r.lines_delete_after AS delete_after, r.lines_deleted_at AS deleted_at
       FROM calls c LEFT JOIN call_recaps r ON r.call_id = c.id WHERE c.id = $1`, [callId]);
    if (!k || k.organisation_id !== ctx.org.id || !k.was_on) throw callNotFound();
    const rows = await db.query<{ id: string; membership_id: string; name: string | null; spoken_at: string; text: string }>(
      `SELECT l.id, l.membership_id, pr.display_name AS name, l.spoken_at, l.text
       FROM call_transcript_lines l
       LEFT JOIN memberships m ON m.id = l.membership_id LEFT JOIN profiles pr ON pr.id = m.user_id
       WHERE l.call_id = $1 ORDER BY l.spoken_at, l.seq, l.id`, [callId]);
    const deleteAfter = k.delete_after ? new Date(k.delete_after).toISOString()
      : k.ended_at ? new Date(Date.parse(k.ended_at) + NOTES_LIMITS.keepDays * DAY_MS).toISOString() : null;
    const deleted = !!k.deleted_at || (!k.recap_at && !!deleteAfter && Date.parse(deleteAfter) <= Date.now() && rows.length === 0);
    return {
      lines: rows.map((r) => ({ id: r.id, speaker: { membershipId: r.membership_id, name: r.name ?? "Someone" }, spokenAt: new Date(r.spoken_at).toISOString(), text: r.text })),
      deleteAfter, deleted,
    };
  });
}

// ---- Retention (the worker) ------------------------------------------------------------------------------------------------

/**
 * The worker's `call.transcript_purge` (hourly): deletes, in batches of 5,000, the lines of ended calls whose recap is
 * more than 7 days old (or, with no recap, whose end is), and marks those recaps `lines_deleted_at`. The recaps stay.
 * Idempotent; never throws past the job; nothing before 0054. `limit`: at most this many lines a run (default 50,000).
 */
export async function purgeCallTranscripts(o: { now?: Date; limit?: number } = {}): Promise<{ lines: number; calls: number }> {
  const now = o.now ?? new Date();
  const limit = Math.max(1, Math.round(o.limit ?? 50_000));
  const cutoff = new Date(now.getTime() - NOTES_LIMITS.keepDays * DAY_MS).toISOString();
  let lines = 0;
  const calls = new Set<string>();
  try {
    if (!(await withWorker((db) => schema0054Ready(db)))) return { lines: 0, calls: 0 };
    while (lines < limit) {
      const batch = Math.min(5_000, limit - lines);
      const r = await withWorker((db) => db.query<{ call_id: string; n: number }>(
        `WITH due AS (
           SELECT l.id FROM call_transcript_lines l
           JOIN calls c ON c.id = l.call_id LEFT JOIN call_recaps r ON r.call_id = c.id
           WHERE c.state = 'ended' AND COALESCE(r.created_at, c.ended_at) < $1::timestamptz
           LIMIT $2),
         gone AS (DELETE FROM call_transcript_lines x USING due WHERE x.id = due.id RETURNING x.call_id)
         SELECT call_id, count(*)::int AS n FROM gone GROUP BY call_id`, [cutoff, batch]));
      const n = r.reduce((s, x) => s + x.n, 0);
      for (const x of r) calls.add(x.call_id);
      lines += n;
      if (n < batch) break;
    }
    // Every recap past its 7 days whose lines are gone says so (also one whose call had no lines left to delete).
    await withWorker((db) => db.query(
      `UPDATE call_recaps r SET lines_deleted_at = $2::timestamptz
       WHERE r.lines_deleted_at IS NULL AND r.created_at < $1::timestamptz
         AND NOT EXISTS (SELECT 1 FROM call_transcript_lines l WHERE l.call_id = r.call_id)`, [cutoff, now.toISOString()]));
  } catch (err) {
    if (isMissingSchema(err)) { forget0054(); return { lines, calls: calls.size }; }
    throw err;
  }
  return { lines, calls: calls.size };
}
