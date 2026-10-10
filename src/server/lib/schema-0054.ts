/**
 * Migration 0054 (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, calls) adds the calls tables
 * (`calls`, `call_participants`, `call_note_consents`, `call_transcript_lines`, `call_recaps`, and `call_ringers` with
 * `calls.reconciled_at`, `recap_skipped` and `recap_model_at` from the fix review, 10 October 2026), their definer steps
 * (`app_call_start` … `app_call_add_lines`), `messages.call_id`/`call_part` and `commitments.call_id`/`call_item`. The code
 * may run before it is applied (a deploy, the running dev server), so callers ask here first and fall back (contract B.3):
 * - Call buttons are hidden; the Calls page says "Calls need a database update first.";
 * - `GET /calls/now` answers `{ ready: false, available: false, ringing: [], active: null, pollMs: 60000 }` and
 *   `GET /calls` answers `{ ready: false, items: [] }`; every other calls route (and the notes routes) answers 503
 *   NOT_READY;
 * - Messages threads and the inbox carry no call lines (`call: null`, `last_is_call: false`);
 * - the Workroom, the person card and the notch's teammates show nobody "On a call" (`membersOnCall` is empty);
 * - the worker's call jobs and the sweep return at once; the LiveKit webhook answers `{ ignored: true }` after verifying it;
 * - commitments read the new columns through `to_jsonb(cm)` and need no check.
 *
 * Same caching as schema-0053: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** The check itself, a boolean SQL expression, so one query can ask it together with others. */
export const SCHEMA_0054_CHECK = `(to_regclass('public.calls') IS NOT NULL
        AND to_regclass('public.call_participants') IS NOT NULL
        AND to_regclass('public.call_note_consents') IS NOT NULL
        AND to_regclass('public.call_transcript_lines') IS NOT NULL
        AND to_regclass('public.call_recaps') IS NOT NULL
        AND to_regclass('public.call_ringers') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.calls') AND attname = 'reconciled_at' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.calls') AND attname = 'recap_model_at' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.messages') AND attname = 'call_id' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.commitments') AND attname = 'call_item' AND NOT attisdropped)
        AND to_regprocedure('public.app_call_start(uuid,uuid[],uuid[])') IS NOT NULL
        AND to_regprocedure('public.app_call_add_lines(uuid,jsonb)') IS NOT NULL)`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0054Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0054_CHECK, asked by someone else's query, as schema0054Ready would. */
export function noteSchema0054(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0054 is applied (the six tables, the four columns and the steps). Cached true for the process. */
export async function schema0054Ready(db: Db): Promise<boolean> {
  const known = schema0054Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0054_CHECK} AS ok`);
  return noteSchema0054(r.ok);
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0054). */
export function forget0054(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0054's objects were missing although the cache said they were there (a
 * database restored to before 0054 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0054<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0054();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[calls] migration 0054 (calls) is not applied yet: calls are off until it is.");
}
