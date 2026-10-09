/**
 * Migration 0052 (owner decision, 9 October 2026: notch notifications, "A plus the grafts") adds the end-of-day report's
 * counts (`brenda_report_log.facts`, with its size check), so the notch's team report card can show them as chips ("0h
 * logged, 0 finished, 8 overdue, 2 didn't clock in"). The code may run before it is applied (a deploy, the running dev
 * server), so callers ask here first and fall back (contract B.4):
 * - the daily report writes no facts (its snapshot is written as before);
 * - the notch reads the report card's counts from the snapshot instead (`source: "snapshot"`: finished, overdue and
 *   blocked only, no hours and no names), and draws the plain card when there is no snapshot either.
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

/** True once migration 0052 is applied (the column and its check). Cached true for the process. */
export async function schema0052Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_report_log') AND attname = 'facts' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.brenda_report_log') AND conname = 'brenda_report_log_facts_check') AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0052). */
export function forget0052(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0052's column was missing although the cache said it was there (a database
 * restored to before 0052 while the process runs): the failed transaction rolled back whole, the cache is forgotten, and
 * the second run takes the fallback path.
 */
export async function retryWithout0052<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0052();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0052 (the team report's counts) is not applied yet: the notch reads them from the report's snapshot until it is.");
}
