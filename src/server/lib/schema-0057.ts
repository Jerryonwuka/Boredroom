/**
 * Migration 0057 (owner decisions, 11 October 2026: screen help on Brenda for Mac, phase 1) adds the workspace's screen
 * help settings (`screen_help_settings`), each person's own never-look list and "Turn off on my Macs" time
 * (`assistant_private.screen_help_never_look`, `screen_help_off_at`) and the cost table with no workspace and no person
 * (`look_usage_daily`). The code may run before it is applied (a deploy, the running dev server), so callers ask here
 * first and fall back (contract D.3):
 * - the desktop state's `look` reads `ready: false` (the notch shows no look features);
 * - the settings views read `{ ready: false, … }` and their writes answer 503 NOT_READY;
 * - the look route answers 503 LOOK_NOT_READY;
 * - createOrganisation inserts no row (asked before the insert: a failing statement would abort the whole creation);
 * - look costs are not recorded.
 *
 * Same caching as schema-0056: once the schema is there the answer is kept for the life of the process; a "not yet" is
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
export const SCHEMA_0057_CHECK = `(to_regclass('public.screen_help_settings') IS NOT NULL
        AND to_regclass('public.look_usage_daily') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_private') AND attname = 'screen_help_off_at' AND NOT attisdropped))`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0057Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0057_CHECK, asked by someone else's query, as schema0057Ready would. */
export function noteSchema0057(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0057 is applied. Cached true for the process. */
export async function schema0057Ready(db: Db): Promise<boolean> {
  const known = schema0057Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0057_CHECK} AS ok`);
  return noteSchema0057(r.ok);
}

/** Forget a cached answer (a database restored to before 0057, or a test that applies it by hand). */
export function forget0057(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0057's tables or columns were missing although the cache said they were
 * there (a database restored to before 0057 while the process runs): the cache is forgotten, and the second run takes
 * the fallback path.
 */
export async function retryWithout0057<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0057();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[screen-help] migration 0057 (screen help on Brenda for Mac) is not applied yet: screen help stays off until it is.");
}
