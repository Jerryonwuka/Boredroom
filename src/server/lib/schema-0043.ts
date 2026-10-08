/**
 * Migration 0043 (owner decision, 8 October 2026: personal assistants, phase 6) lets assistants talk to each other: the
 * items one person's assistant brings another (`assistant_items`: a message passed on, a request to accept, a one-line
 * reply, a note for today's team report), the mutes (`assistant_item_mutes`), the two switches
 * (`assistant_profiles.allow_thread_replies`, `brenda_settings.report_notes`), tagging someone else's assistant in
 * Messages (`assistant_mentions.owner_membership_id`, `follow_up_id`, `holding_message_id`, the status 'asked') and a
 * follow-up asked in a thread (`follow_ups.thread_mode`). The code may run before it is applied (a deploy, the running
 * dev server), and a missing table or column inside someone else's transaction would abort all of it, so callers ask
 * here first and fall back (phase 6 contract, A.3):
 * - copilot's new tools answer `ASSISTANT_TALK_NOT_READY`; every `/assistant-items/*` route that changes something
 *   answers 503 NOT_READY; the list reads answer `{ ready: false, items: [], nextBefore: null }`;
 * - `thread()` offers no one else's assistant, and their tokens are dropped silently;
 * - follow-ups and phase 5 mentions behave exactly as before; the daily report has no Notes section;
 * - the notch gets `assistantItems: { ready: false, waiting: [], updates: [] }`; the worker's sweep returns at once.
 *
 * Same caching as schema-0041: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0043 is applied (the items, the mutes, the switches, the mention and follow-up columns, the definer functions). Cached true for the process. */
export async function schema0043Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.assistant_items') IS NOT NULL AND to_regclass('public.assistant_item_mutes') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_profiles') AND attname = 'allow_thread_replies' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_settings') AND attname = 'report_notes' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_mentions') AND attname = 'owner_membership_id' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.follow_ups') AND attname = 'thread_mode' AND NOT attisdropped)
        AND to_regprocedure('public.app_assistant_item_decide(uuid,text,text)') IS NOT NULL
        AND to_regprocedure('public.app_assistant_item_refusal(uuid,uuid,text)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_mentions_status_check' AND pg_get_constraintdef(oid) LIKE '%asked%') AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0043). */
export function forget0043(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0043's table or column was missing although the cache said it was there
 * (a database restored to before 0043 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0043<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0043();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0043 (assistants talk to each other) is not applied yet: messages, requests and report notes between assistants are off until pnpm db:migrate runs.");
}
