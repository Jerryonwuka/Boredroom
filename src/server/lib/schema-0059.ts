/**
 * Migration 0059 (Brenda for Mac, phase 3; owner report and requests, 12 October 2026: "I wanted Brenda to assist me with
 * some things, like open an app on my desktop, and it said it can't do that"; "when I turned this setting on, I stopped
 * seeing my Brenda") adds each person's own Mac state and their "Set up on my Mac" time (`assistant_private`, the person
 * and the worker only) and plans (`assistant_tasks`: steps, lines, scope, the step a plan is on). It waits in db/pending
 * until the owner's go-ahead, so the code runs without it (contract G.2):
 * - the desktop state's `look.mac.ready` is false and `look.setupAt` null (the notch reports nothing, opens no setup from
 *   the web);
 * - plans are never offered to the model (Brenda for Mac keeps phase 2's propose_task exactly as today);
 * - `PUT /screen-help/mac` answers 200 `{saved: false, ready: false}`, `PUT /screen-help/me {setup}` 503 NOT_READY, and the
 *   plan routes 503 ACT_NOT_READY.
 *
 * Same caching as schema-0058: once the schema is there the answer is kept for the life of the process; a "not yet" is
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

/** The check itself, a boolean SQL expression, so one query can ask it together with others. */
export const SCHEMA_0059_CHECK = `(${column("assistant_private", "screen_help_macs")}
        AND ${column("assistant_private", "screen_help_setup_at")}
        AND ${column("assistant_tasks", "steps")}
        AND ${column("assistant_tasks", "progress")}
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_tasks_yes_after_scope'))`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0059Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0059_CHECK, asked by someone else's query, as schema0059Ready would. */
export function noteSchema0059(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0059 is applied. Cached true for the process. */
export async function schema0059Ready(db: Db): Promise<boolean> {
  const known = schema0059Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0059_CHECK} AS ok`);
  return noteSchema0059(r.ok);
}

/** Forget a cached answer (a database restored to before 0059, or a test that applies it by hand). */
export function forget0059(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0059's columns were missing although the cache said they were there (a
 * database restored to before 0059 while the process runs): the cache is forgotten, and the second run takes the
 * fallback path.
 */
export async function retryWithout0059<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0059();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[act] migration 0059 (plans and the Mac state on Brenda for Mac) is not applied yet: plans, the web card's Mac states and Set up on my Mac stay off until it is.");
}
