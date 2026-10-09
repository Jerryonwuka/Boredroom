/**
 * Migration 0053 (owner decision, 9 October 2026: natural voice (ElevenLabs), contract C.2) adds the person's chosen
 * natural voice (`assistant_profiles.natural_voice`), the workspace's own ElevenLabs key (`organisation_voice_secrets`)
 * and the characters spoken each day (`voice_usage_daily`). The code may run before it is applied (a deploy, the running
 * dev server), so callers ask here first and fall back:
 * - nobody has a natural voice (`reason: "not_ready"`): every assistant speaks with the computer voice, replies carry no
 *   speech offer and the speech route answers 409;
 * - choosing a voice and connecting or removing a key answer 503 NOT_READY; nothing throws.
 *
 * Same caching as schema-0052: once the schema is there the answer is kept for the life of the process; a "not yet" is
 * kept for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

let ready = false;
let notReadyUntil = 0;
let warned = false;
const NOT_READY_TTL_MS = 30_000;

/** The check itself, a boolean SQL expression, so one query can ask it together with others (SCHEMA_0050_CHECK). */
export const SCHEMA_0053_CHECK = `(EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assistant_profiles') AND attname = 'natural_voice' AND NOT attisdropped)
        AND to_regclass('public.organisation_voice_secrets') IS NOT NULL
        AND to_regclass('public.voice_usage_daily') IS NOT NULL)`;

/** The cached answer without asking: true, false (a "not yet" under 30 seconds old), or null (ask). */
export function schema0053Known(): boolean | null {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  return null;
}

/** Keeps the answer to SCHEMA_0053_CHECK, asked by someone else's query, as schema0053Ready would. */
export function noteSchema0053(ok: boolean): boolean {
  ready = ok;
  if (!ready) {
    notReadyUntil = Date.now() + NOT_READY_TTL_MS;
    warnOnce();
  }
  return ready;
}

/** True once migration 0053 is applied (the column and both tables). Cached true for the process. */
export async function schema0053Ready(db: Db): Promise<boolean> {
  const known = schema0053Known();
  if (known !== null) return known;
  const r = await db.one<{ ok: boolean }>(`SELECT ${SCHEMA_0053_CHECK} AS ok`);
  return noteSchema0053(r.ok);
}

/** Forget a cached "ready" after a 42P01/42703 (a database restored to before 0053). */
export function forget0053(): void {
  ready = false;
  notReadyUntil = 0;
}

/**
 * Runs `fn` once more when it failed because 0053's objects were missing although the cache said they were there (a
 * database restored to before 0053 while the process runs): the failed transaction rolled back whole, the cache is
 * forgotten, and the second run takes the fallback path.
 */
export async function retryWithout0053<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSchema(err) || !ready) throw err;
    forget0053();
    return fn();
  }
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0053 (natural voice) is not applied yet: everyone's assistant uses the computer voice until it is.");
}
