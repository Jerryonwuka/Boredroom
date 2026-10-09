/**
 * Migration 0050 (owner decisions, 8–9 October 2026: phase 7c, "Brenda keeps the loops closed", third part) adds the
 * async standup (`team_standups`, `standup_rollups`, `standup_rollup_recipients`, `standup_entries` and the person's
 * definer steps), the abilities lists (`brenda_settings.abilities_off`, `assistant_private.abilities_off`), "How I like
 * things done" (`assistant_preferences`) and the private decline labels (`app_label_party` and the replaced
 * `message_labels_select`), and widens two checks (ai_usage purposes + 'standup', mention notes + 'off_ability'). The
 * code may run before it is applied (a deploy, the running dev server), and a missing table inside someone else's
 * transaction would abort all of it, so callers ask here first and fall back (phase 7c contract, A.3):
 * - team standup settings read `{ ready: false, enabled: false, … }` and their PATCH answers 503 NOT_READY; standup reads
 *   are empty with `ready: false` and every standup change answers 503; the worker's standup hooks return at once;
 * - abilities read `ready: false` with every new ability ON (today's behaviour); their PATCH routes answer 503;
 * - preferences list `{ ready: false, items: [] }`, every change answers 503 and nothing reaches the model;
 * - private decline labels are already enforced in the label query itself (commitments.ts `labelsIn`), so a reader who
 *   is not a party reads no "Declined" or "Not a commitment" label before 0050 too.
 *
 * Same caching as schema-0048: once the schema is there the answer is kept for the life of the process; a "not yet" is
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
 * True once migration 0050 is applied: the five tables, the two abilities columns and the two definer functions the code
 * calls first (the post check and the label party check). Cached true for the process.
 */
export async function schema0050Ready(db: Db): Promise<boolean> {
  const known = schema0050Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0050_CHECK} AS ok`);
  return noteSchema0050(r.ok);
}

/** The check itself, a boolean SQL expression, so one query can ask it together with others (SCHEMA_0053_CHECK). */
export const SCHEMA_0050_CHECK = `(to_regclass('public.team_standups') IS NOT NULL
        AND to_regclass('public.standup_rollups') IS NOT NULL
        AND to_regclass('public.standup_rollup_recipients') IS NOT NULL
        AND to_regclass('public.standup_entries') IS NOT NULL
        AND to_regclass('public.assistant_preferences') IS NOT NULL
        AND ${column("brenda_settings", "abilities_off")}
        AND ${column("assistant_private", "abilities_off")}
        AND to_regprocedure('public.app_standup_post_check(uuid)') IS NOT NULL
        AND to_regprocedure('public.app_label_party(uuid)') IS NOT NULL)`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0050Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0050_CHECK, asked by someone else's query, as schema0050Ready would. */
export function noteSchema0050(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0050). */
export function forget0050(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0050's table or column was missing although the cache said it was there
 * (a database restored to before 0050 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0050<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0050();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0050 (standup, abilities, preferences) is not applied yet: they are off until it is.");
}
