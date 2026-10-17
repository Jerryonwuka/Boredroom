/**
 * Migration 0058 (owner request and permission rule, 12 October 2026: Brenda for Mac does things on the person's Mac only
 * when they ask and say yes) adds each person's own task record (`assistant_tasks`), the workspace's switch for on-screen
 * actions and file work (`screen_help_settings.actions_allowed`) and the cost table with no workspace and no person
 * (`act_usage_daily`), and what each task counted in the person's limit (`assistant_task_units`, review 12 October
 * 2026: kept apart, so Forget cannot reset the limit). It waits in db/pending until the owner's go-ahead, so the code runs without it (contract D.3):
 * - the desktop state's `look.act` reads `ready: false, available: false` (the notch offers no task);
 * - the look route still answers v2 looks, but `propose_task` is never offered to the model;
 * - the act routes answer 503 ACT_NOT_READY;
 * - the person's Activity has no tasks, the daily limit counts none, and the owner switch reads as not ready (its write
 *   answers 503 NOT_READY);
 * - task costs are not recorded and the purge leaves tasks alone.
 *
 * Same caching as schema-0057: once the schema is there the answer is kept for the life of the process; a "not yet" is
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
export const SCHEMA_0058_CHECK = `(to_regclass('public.assistant_tasks') IS NOT NULL
        AND to_regclass('public.act_usage_daily') IS NOT NULL
        AND to_regclass('public.assistant_task_units') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.screen_help_settings') AND attname = 'actions_allowed' AND NOT attisdropped))`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0058Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0058_CHECK, asked by someone else's query, as schema0058Ready would. */
export function noteSchema0058(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0058 is applied. Cached true for the process. */
export async function schema0058Ready(db: Db): Promise<boolean> {
  const known = schema0058Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0058_CHECK} AS ok`);
  return noteSchema0058(r.ok);
}

/** Forget a cached answer (a database restored to before 0058, or a test that applies it by hand). */
export function forget0058(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0058's tables or columns were missing although the cache said they were
 * there (a database restored to before 0058 while the process runs): the cache is forgotten, and the second run takes
 * the fallback path.
 */
export async function retryWithout0058<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0058();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[act] migration 0058 (tasks on Brenda for Mac) is not applied yet: on-screen actions and file work stay off until it is.");
}
