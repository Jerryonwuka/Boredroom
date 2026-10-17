/**
 * Migration 0060 (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: the doc "Brenda and her
 * helpers", all nine decisions "Agree", "proceed to build"; permission rule v2 the same day: "when you hold the keys and
 * clearly ask for a routine task, the request is the permission, and she does it. She still asks before anything
 * destructive, anything sent, anything that costs money, or anything sensitive") adds the person's "Check with me before
 * every task" (`assistant_private.check_every_task`), the record of each request made on their Mac (`mac_requests`, the
 * person alone) and background jobs on `assistant_tasks` (kind 'job'). It waits in db/pending until the owner's go-ahead,
 * so the code runs without it (contract E.2):
 * - the desktop state's `look.front.ready` is false, so Brenda for Mac keeps phase 3's ask-first flow;
 * - `/assistant/front*`, `/assistant/jobs*` and `PUT /brenda/mac-permission` answer 503 FRONT_NOT_READY ("This needs a
 *   database update first.");
 * - `GET /brenda/jobs` answers `{ready: false, jobs: []}`; the look route ignores `front`; nothing else changes.
 *
 * Same caching as schema-0059: once the schema is there the answer is kept for the life of the process; a "not yet" is
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
export const SCHEMA_0060_CHECK = `(${column("assistant_private", "check_every_task")}
        AND ${column("assistant_tasks", "helper")}
        AND to_regclass('public.mac_requests') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mac_requests_authorised'))`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0060Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0060_CHECK, asked by someone else's query, as schema0060Ready would. */
export function noteSchema0060(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0060 is applied. Cached true for the process. */
export async function schema0060Ready(db: Db): Promise<boolean> {
  const known = schema0060Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0060_CHECK} AS ok`);
  return noteSchema0060(r.ok);
}

/** Forget a cached answer (a database restored to before 0060, or a test that applies it by hand). */
export function forget0060(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0060's tables or columns were missing although the cache said they were
 * there (a database restored to before 0060 while the process runs): the cache is forgotten, and the second run takes
 * the fallback path.
 */
export async function retryWithout0060<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0060();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[front] migration 0060 (Brenda's front desk, background jobs and Check with me) is not applied yet: Brenda for Mac keeps asking first until it is.");
}
