/**
 * Migration 0070 (the Browser helper; owner decisions, 4 November 2026: phase 2) lets a job's helper be 'web' and counts
 * its cost as 'web'. It waits in db/pending for the owner's go-ahead, so the code runs without it: the router doesn't offer
 * browser jobs (it says this needs a database update), and nothing else changes.
 *
 * Same caching as schema-0060: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** The check itself: the job check allows 'web'. */
export const SCHEMA_0070_CHECK = `EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_tasks_job_check' AND pg_get_constraintdef(oid) LIKE '%''web''%')`;

/** True once migration 0070 is applied. Cached true for the process. */
export async function schema0070Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0070_CHECK} AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    if (!warned) {
      warned = true;
      console.warn("[jobs] migration 0070 (the Browser helper) is not applied on this database: browser jobs are off until it is.");
    }
  }
  return ready;
}

/** Forget the cached answer (tests, or a database migrated while the process runs). */
export function forget0070(): void {
  ready = false;
  notReadyUntil = 0;
}
