/**
 * Migration 0041 (owner decision, 8 October 2026: personal assistants, phase 5) adds @mentions in Messages: the mentions
 * on a message (`message_mentions`), the queue of assistant mentions and what only the person who tagged sees
 * (`assistant_mentions`, `assistant_mention_private`), the two switches (`conversations.assistant_replies`,
 * `brenda_settings.mention_replies`), the definer functions for the audience rule and the conversation switch, and the
 * ledger purpose 'mention'. The code may run before it is applied (a deploy, the running dev server), and a missing
 * table or column inside someone else's transaction would abort all of it, so callers ask here first and fall back
 * (review, 8 October 2026):
 * - `sendMessage` ignores mentions (the message sends as before, nobody is notified, `mentionId: null`);
 * - `thread()` returns no mentions and `assistantReplies.ready: false`, so the composer offers no autocomplete;
 * - every `/mentions/*` route and the conversation switch answer 503 NOT_READY; the settings read `ready: false`;
 * - the worker's jobs return at once and the processor returns null.
 *
 * Same caching as schema-0039: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0041 is applied (the mention tables, the switches, the definer functions, the purpose). Cached true for the process. */
export async function schema0041Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.message_mentions') IS NOT NULL AND to_regclass('public.assistant_mentions') IS NOT NULL
        AND to_regclass('public.assistant_mention_private') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.conversations') AND attname = 'assistant_replies' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_settings') AND attname = 'mention_replies' AND NOT attisdropped)
        AND to_regprocedure('public.app_visible_to_readers(uuid,text,uuid)') IS NOT NULL
        AND to_regprocedure('public.app_conversation_set_assistant_replies(uuid,boolean)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_purpose_check' AND pg_get_constraintdef(oid) LIKE '%mention%') AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0041). */
export function forget0041(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0041's table or column was missing although the cache said it was there
 * (a database restored to before 0041 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0041<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0041();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0041 (@mentions in Messages) is not applied yet: mentions are ignored until pnpm db:migrate runs.");
}
