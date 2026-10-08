/**
 * Migration 0047 (review, 8 October 2026: phase 7a) moves the person's own time zone, quiet hours and morning-opener
 * mark from `assistant_profiles` (which every member of the workspace reads) to `assistant_private` (the person and the
 * worker only). The columns are the same, under the same names, so the code reads and writes whichever table holds
 * them: `assistant_private` once 0047 is applied, `assistant_profiles` before (0046's columns, still there and emptied
 * by 0047).
 *
 * Same caching as schema-0046: once the table is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

let ready = false;
let notReadyUntil = 0;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0047 is applied (the assistant_private table). Cached true for the process. */
export async function schema0047Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(`SELECT to_regclass('public.assistant_private') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) notReadyUntil = Date.now() + NOT_READY_TTL_MS;
  return ready;
}

/** Forget a cached "ready" after a 42P01 (a database restored to before 0047). */
export function forget0047(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * The table that holds the person's time zone, quiet hours and opener mark (columns `membership_id`, `organisation_id`,
 * `timezone`, `quiet_start`, `quiet_end`, `quiet_days`, `opener_seen_at`), in a transaction the caller holds.
 */
export async function personalTable(db: Db): Promise<"assistant_private" | "assistant_profiles"> {
  return (await schema0047Ready(db)) ? "assistant_private" : "assistant_profiles";
}

/**
 * Runs `fn` once more when it failed because 0047's table was missing although the cache said it was there: the failed
 * transaction rolled back whole, the cache is forgotten, and the second run uses `assistant_profiles`.
 */
export async function retryWithout0047<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0047();
    return fn();
  }
}
