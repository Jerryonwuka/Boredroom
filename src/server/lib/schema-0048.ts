/**
 * Migration 0048 (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part) adds the
 * person's loose ends (`loose_ends`, `loose_end_dismissals`), the workspace's commitments in group chats (`commitments`,
 * the "Noted" label `message_labels`, the scan's `commitment_scan_cursors`, the switches
 * `brenda_settings.track_commitments`, `commitment_thread_followups`, `track_commitments_since` and
 * `conversations.track_commitments`), "blocked on whom" (`task_blocks`) and the stalled re-plan (`replan_proposals`), and
 * widens four checks (ai_usage purposes, routine templates, a message's author kind 'workspace'). The code may run
 * before it is applied (a deploy, the running dev server), and a missing table inside someone else's transaction would
 * abort all of it, so callers ask here first and fall back (phase 7b contract, A.2):
 * - every 7b route that changes something answers 503 NOT_READY (`LOOPS_NOT_READY_SHORT`); list reads answer
 *   `ready: false` with nothing in them;
 * - a thread reads `commitments.ready false`, no label on any message, no disclosure and no switch;
 * - the daily report has no Commitments section; the `loose_ends` routine is unavailable; the chat's loop tools say they
 *   need the update; the worker's schedules return at once;
 * - the task editor hides "Waiting on" (Mark blocked works as before) and tasks.ts never calls the block settle;
 * - the chase's second stall makes no re-plan proposal (the follow-up works as in 7a).
 *
 * Same caching as schema-0046: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

const column = (table: string, name: string) =>
  `EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.${table}') AND attname = '${name}' AND NOT attisdropped)`;

/**
 * True once migration 0048 is applied: the seven tables, the three switch columns and the three definer functions the
 * code calls first (decide, settle, the conversation switch). Cached true for the process.
 */
export async function schema0048Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.commitments') IS NOT NULL
        AND to_regclass('public.message_labels') IS NOT NULL
        AND to_regclass('public.commitment_scan_cursors') IS NOT NULL
        AND to_regclass('public.loose_ends') IS NOT NULL
        AND to_regclass('public.loose_end_dismissals') IS NOT NULL
        AND to_regclass('public.task_blocks') IS NOT NULL
        AND to_regclass('public.replan_proposals') IS NOT NULL
        AND ${column("brenda_settings", "track_commitments")}
        AND ${column("brenda_settings", "commitment_thread_followups")}
        AND ${column("conversations", "track_commitments")}
        AND to_regprocedure('public.app_commitment_decide(uuid,text,text)') IS NOT NULL
        AND to_regprocedure('public.app_task_block_settle(uuid)') IS NOT NULL
        AND to_regprocedure('public.app_conversation_set_track_commitments(uuid,boolean)') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0048). */
export function forget0048(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0048's table or column was missing although the cache said it was there
 * (a database restored to before 0048 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0048<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0048();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0048 (loose ends, commitments, blocked on whom) is not applied yet: they are off until it is.");
}
