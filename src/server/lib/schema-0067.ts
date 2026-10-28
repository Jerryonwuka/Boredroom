/**
 * Migration 0067 ("What Brenda has learned"; owner decision, 28 October 2026: "I want her to learn from the person's usage
 * and interaction with her and interact with the person based on that") adds `assistant_learning`, `assistant_signals`
 * and `assistant_learned`, and 'learning' to ai_usage's purposes. Applied 28 October 2026 (owner: "apply 0066 and 0067"); this still guards a database without it, and
 * the code runs before it (a deploy, the running dev server), so callers ask here first and fall back:
 * - nothing is recorded and nothing is learned; her situation carries nothing learned;
 * - Settings › Your assistant says "What Brenda has learned" is coming; its routes answer 503 NOT_READY;
 * - learned_habits says it isn't switched on here yet; the worker's purge skips the signals.
 *
 * Same caching as schema-0050: once the tables are there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

export const SCHEMA_0067_CHECK = `(to_regclass('public.assistant_learning') IS NOT NULL
        AND to_regclass('public.assistant_signals') IS NOT NULL
        AND to_regclass('public.assistant_learned') IS NOT NULL)`;

/** True once migration 0067 is applied (its three tables). Cached true for the process. */
export async function schema0067Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0067_CHECK} AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    if (!warned) { warned = true; console.warn("[learning] migration 0067 (what Brenda has learned) is not applied yet: nothing is learned until it is."); }
  }
  return ready;
}

/** Forget the cached answer (tests, or a database restored to before 0067: a 42P01 seen). */
export function forget0067(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0067's tables were missing although the cache said they were there (a
 * database restored to before it while the process runs): the cache is forgotten and the second run takes the fallback.
 */
export async function retryWithout0067<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0067();
    return fn();
  }
}
