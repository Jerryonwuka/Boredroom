/**
 * Migration 0049 (phase 7b review fixes, 9 October 2026) adds `conversations.track_commitments_since`: when "Note
 * commitments here" was last turned back on, so the workspace's commitments scan reads nothing said while it was off,
 * as a candidate or as context. Before it is applied the scan still never takes the off period's messages as
 * candidates (commitments.ts moves the conversation's scan cursor when the switch is turned on); it only lacks the
 * floor for context lines. Same caching as schema-0048: a "ready" is kept for the life of the process, a "not yet" for
 * 30 seconds.
 */
import type { Db } from "@/server/db";

let ready = false;
let notReadyUntil = 0;
const NOT_READY_TTL_MS = 30_000;

/** True once migration 0049 is applied. Cached true for the process. */
export async function schema0049Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.conversations') AND attname = 'track_commitments_since' AND NOT attisdropped) AS ok`);
  ready = r.ok;
  if (!ready) notReadyUntil = Date.now() + NOT_READY_TTL_MS;
  return ready;
}

/** Forget a cached "ready" after a 42703 (a database restored to before 0049). */
export function forget0049(): void {
  ready = false;
  notReadyUntil = 0;
}
