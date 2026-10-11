/**
 * Migration 0056 (owner request, 11 October 2026: the first-run welcome) adds the person's own welcome progress to
 * `assistant_private` (`welcome_step`, `welcome_started_at`, `welcome_done_at`, `welcome_outcome`, `welcome_skipped`,
 * `welcome_shown`, `next_steps_hidden_at`), marks everyone who is already a member done ('existing'), and tightens the
 * two self-join policies on `team_members` so only a lead code or a lead invitation takes a lead seat. The code may run
 * before it is applied (a deploy, the running dev server), so callers ask here first and fall back (contract 8.3):
 * - `welcomeState` reads `{ ...WELCOME_NOT_READY, done: <the assistant's setup is done> }`; the gate never fires and Next
 *   steps never shows;
 * - `PATCH /welcome` answers 503 NOT_READY; `POST /welcome/done` marks the assistant's setup done and answers done;
 * - the shell keeps the Phase 1 "Meet your assistant" dialog for anyone whose assistant setup is not done;
 * - the welcome page itself works, keeping its step in the browser's session;
 * - the fixtures mark nothing.
 *
 * Same caching as schema-0054: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** The check itself, a boolean SQL expression, so one query can ask it together with others. */
export const SCHEMA_0056_CHECK = `(to_regclass('public.assistant_private') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_private') AND attname = 'welcome_done_at' AND NOT attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_private') AND attname = 'next_steps_hidden_at' AND NOT attisdropped))`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0056Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0056_CHECK, asked by someone else's query, as schema0056Ready would. */
export function noteSchema0056(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0056 is applied (assistant_private's welcome columns). Cached true for the process. */
export async function schema0056Ready(db: Db): Promise<boolean> {
  const known = schema0056Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0056_CHECK} AS ok`);
  return noteSchema0056(r.ok);
}

/** Forget a cached answer (a database restored to before 0056, or a test that applies it by hand). */
export function forget0056(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0056's columns were missing although the cache said they were there (a
 * database restored to before 0056 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0056<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0056();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[welcome] migration 0056 (the welcome) is not applied yet: new members get the old \"Meet your assistant\" dialog until it is.");
}
