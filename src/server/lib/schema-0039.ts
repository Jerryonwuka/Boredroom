/**
 * Migration 0039 (owner decision, 8 October 2026: personal assistants, phase 4) adds follow-ups between assistants: the
 * `follow_ups` and `follow_up_batches` tables, the person's choice (`assistant_profiles.followups`), the workspace's
 * collection before the report (`brenda_settings.followup_collect*`), the definer functions for the person's reply and
 * cancel, and the ledger purpose 'followup'. The code may run before it is applied (a deploy, the running dev server),
 * and a missing table or column inside someone else's transaction would abort all of it, so callers ask here first and
 * fall back (review, 8 October 2026):
 * - the assistant offers no follow-ups and says why (FOLLOW_UPS_NOT_READY in lib/follow-ups);
 * - reads answer `ready: false` with nothing in them, writes answer 503 NOT_READY;
 * - the notch, the home page and the report show nothing of it, and the worker's jobs return at once.
 *
 * Same caching as schema-0037: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0039 is applied (the follow-up tables, columns and the reply function exist). Cached true for the process. */
export async function schema0039Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.follow_ups') IS NOT NULL AND to_regclass('public.follow_up_batches') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_profiles') AND attname = 'followups' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_settings') AND attname = 'followup_collect_minutes' AND NOT attisdropped)
        AND to_regprocedure('public.app_follow_up_reply(uuid,text,text)') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0039). */
export function forget0039(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0039's table or column was missing although the cache said it was there
 * (a database restored to before 0039 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0039<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0039();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0039 (follow-ups between assistants) is not applied yet: follow-ups are off until pnpm db:migrate runs.");
}
