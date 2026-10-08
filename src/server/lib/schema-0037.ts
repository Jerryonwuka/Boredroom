/**
 * Migration 0037 (owner decision, 8 October 2026: personal assistants, phase 3) adds who wrote a message
 * (`messages.author_kind`), reads in the assistant's activity log (`brenda_actions.source = 'read'`) and the usage ledger
 * (`ai_usage`). The code may run before it is applied (a deploy, the running dev server), and a missing column inside
 * someone else's transaction would abort all of it, so callers ask here first and fall back:
 * - messaging reads every message as the person's (`'person'::text AS author_kind`, no assistant) and sends without
 *   naming the column (the row is the person's, as before);
 * - catch-up reads still work, but are not logged;
 * - Activity lists actions only (`readsAvailable: false`);
 * - usage is not recorded and there is no daily limit (`aiAllowance` says `ready: false`).
 *
 * Same pattern as `assistantSchemaReady` (server/services/assistant-profile): one catalogue query, and once the schema is
 * there the answer is kept for the life of the process. A "not yet" is kept for 30 seconds only, so a page that asks
 * several times does not pay a round trip each time, and the migration is picked up within half a minute of running
 * (review, 8 October 2026).
 */
import type { Db } from "@/server/db";

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0037 is applied (messages.author_kind and ai_usage exist). Cached true for the process. */
export async function schema0037Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.ai_usage') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.messages') AND attname = 'author_kind' AND NOT attisdropped) AS ok`);
  ready = r.ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0037). */
export function forget0037(): void {
  ready = false;
  notReadyUntil = 0;
}

/** An undefined table (42P01) or column (42703): the schema is older than the code expects. */
export const isMissingSchema = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
};

/**
 * Runs `fn` once more when it failed because 0037's table or column was missing although the cache said it was there
 * (a database restored to before 0037 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0037<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0037();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0037 (catch-up, her identity on messages, usage) is not applied yet: messages read as the person's, reads are not logged, usage is not recorded and there is no daily limit until pnpm db:migrate runs.");
}
