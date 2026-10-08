/**
 * Migration 0046 (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed") adds routines
 * (`routines`, `routine_runs`, `routine_reported_items`), the person's own time zone, quiet hours and morning-opener
 * mark (`assistant_profiles.timezone`, `quiet_start`, `quiet_end`, `quiet_days`, `opener_seen_at`), the workspace's
 * "Only leads can schedule routines that chase other people" (`brenda_settings.routines_chase_leads_only`) and the
 * end-of-day report's snapshot (`brenda_report_log.snapshot`). The code may run before it is applied (a deploy, the
 * running dev server), and a missing table inside someone else's transaction would abort all of it, so callers ask here
 * first and fall back (phase 7a contract, A.2):
 * - every routine and quiet-hours change, and the workspace switch, answer 503 NOT_READY (`ROUTINES_NOT_READY`); list
 *   reads answer `ready: false` with nothing in them; quiet hours read as none;
 * - `quietStateFor` is never quiet; the opener's first visit is `null` (the web falls back to a per-browser key) and the
 *   opener itself works;
 * - the daily report has "Decisions for you" but no "Changed since yesterday", and writes no snapshot;
 * - the worker's routine schedules return at once; the notch reads `quiet.ready false` and no routine runs.
 *
 * Same caching as schema-0045: once the schema is there the answer is kept for the life of the process; a "not yet" is
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

/** True once migration 0046 is applied (the three tables, the new columns and the routines guard). Cached true for the process. */
export async function schema0046Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.routines') IS NOT NULL
        AND to_regclass('public.routine_runs') IS NOT NULL
        AND to_regclass('public.routine_reported_items') IS NOT NULL
        AND ${column("assistant_profiles", "timezone")}
        AND ${column("assistant_profiles", "quiet_start")}
        AND ${column("assistant_profiles", "opener_seen_at")}
        AND ${column("brenda_settings", "routines_chase_leads_only")}
        AND ${column("brenda_report_log", "snapshot")}
        AND to_regprocedure('public.routines_guard()') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0046). */
export function forget0046(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0046's table or column was missing although the cache said it was there
 * (a database restored to before 0046 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0046<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0046();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(`[assistant] migration 0046 (routines and quiet hours) is not applied yet: routines, quiet hours and "Changed since yesterday" are off until it is.`);
}
