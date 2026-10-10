/**
 * Migration 0055 (owner decision, 8 October 2026: phase 8, screen recording taken out) drops what screen recording left
 * in the database, among them `policies.recording_mode` and `policies.retention_days`. Both are NOT NULL without a
 * default, so until 0055 runs every new policy row must still supply them; after it, it must not name them. This is
 * the inverted readiness check for that one difference (0055 waits in db/pending until the owner's purge ran, so the
 * code runs both ways for a while):
 * - before 0055: `createOrganisation` and `publishPolicy` write `recording_mode = 'disabled', retention_days = 7`;
 * - after it: they leave both out.
 * Nothing else reads or writes a recording table or column any more, so everything else runs either way (`tasks` and
 * `work_sessions` INSERTs simply omit their capture columns, which have defaults until 0055 drops them).
 *
 * Same caching style as schema-0053, turned round: "gone" is kept for the life of the process; "still there" is kept
 * for 30 seconds only, so the migration is picked up within half a minute of running.
 */
import type { Db } from "@/server/db";

let gone = false;
let presentUntil = 0;
const PRESENT_TTL_MS = 30_000;

/** The check itself, a boolean SQL expression: true once `policies.recording_mode` no longer exists. */
export const SCHEMA_0055_CHECK = `(NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.policies') AND attname = 'recording_mode' AND NOT attisdropped))`;

/** The cached answer without asking: true (gone), false (still there, under 30 seconds old), or null (ask). */
export function schema0055Known(): boolean | null {
  if (gone) return true;
  if (Date.now() < presentUntil) return false;
  return null;
}

/** Keeps an answer to SCHEMA_0055_CHECK. */
export function noteSchema0055(isGone: boolean): boolean {
  gone = isGone;
  if (!gone) presentUntil = Date.now() + PRESENT_TTL_MS;
  return gone;
}

/** True once migration 0055 dropped the recording columns from `policies`. Cached true for the process. */
export async function recordingColumnsGone(db: Db): Promise<boolean> {
  const known = schema0055Known();
  if (known !== null) return known;
  const r = await db.one<{ gone: boolean }>(`SELECT ${SCHEMA_0055_CHECK} AS gone`);
  return noteSchema0055(r.gone);
}

/** Forgets every cached answer (a database restored to before 0055, or tests that apply 0055 by hand). */
export function forget0055(): void {
  gone = false;
  presentUntil = 0;
}

const code = (err: unknown) => (err as { code?: string } | null)?.code;
const column = (err: unknown) => (err as { column?: string } | null)?.column;

/**
 * Runs `fn` once more when the cache was wrong about the recording columns (the failed transaction rolled back whole):
 * - 42703 (undefined column) while the cache said they were there: 0055 ran within the last 30 seconds; flip to "gone";
 * - 23502 (not-null violation on `recording_mode`/`retention_days`) while the cache said they were gone: the database
 *   was restored to before 0055; forget, so the second run asks again and supplies them.
 */
export async function retryWithRecordingColumns<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (code(err) === "42703" && !gone) {
      noteSchema0055(true);
      return fn();
    }
    if (code(err) === "23502" && gone && (column(err) === "recording_mode" || column(err) === "retention_days")) {
      forget0055();
      return fn();
    }
    throw err;
  }
}
