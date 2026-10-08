/**
 * Migration 0045 (owner decision, 8 October 2026: act without asking) adds the person's permission mode
 * (`assistant_profiles.act_mode`: 'ask' or 'auto'), the workspace's switch (`brenda_settings.allow_auto_act`) and the
 * sender's withdrawal of a message passed to someone's assistant (`app_assistant_item_unsend`, the status
 * message → withdrawn). The code may run before it is applied (a deploy, the running dev server), and a missing column
 * inside someone else's transaction would abort all of it, so callers ask here first and fall back (act-mode contract,
 * A.3):
 * - every read of the mode answers `ASK_STATE` (lib/act-mode): everyone's assistant asks before acting, exactly as before;
 * - `PUT /brenda/act-mode` and `PATCH /brenda/act-mode/workspace` answer 503 NOT_READY;
 * - Undo of a message passed to an assistant answers 503 (it can only arise in 'auto', so it never does); every other
 *   Undo works as it is;
 * - the notch reads `assistant.act.ready === false` and shows nothing.
 *
 * Same caching as schema-0043: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0045 is applied (the two switches and the unsend definer). Cached true for the process. */
export async function schema0045Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_profiles') AND attname = 'act_mode' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_settings') AND attname = 'allow_auto_act' AND NOT attisdropped)
        AND to_regprocedure('public.app_assistant_item_unsend(uuid)') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0045). */
export function forget0045(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0045's column was missing although the cache said it was there (a database
 * restored to before 0045 while the process runs): the failed transaction rolled back whole, the cache is forgotten, and
 * the second run takes the fallback path.
 */
export async function retryWithout0045<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0045();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0045 (act without asking) is not applied yet: everyone's assistant asks before acting until it is.");
}
