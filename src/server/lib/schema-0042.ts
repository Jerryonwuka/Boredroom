/**
 * Migration 0042 (review, 8 October 2026: personal assistants, phase 5 hardening) adds two definer functions: the audience
 * rule for many items at once (`app_visible_to_readers_many`) and the retraction of a withdrawn assistant reply's
 * notifications and Activity line (`app_retract_mention_reply`). Before it is applied, the audience rule is asked item by
 * item through 0041's function (same answers, slower) and a withdrawn reply's notifications stay as they were.
 *
 * Asked outside the caller's transaction is not needed: `to_regprocedure` never fails, so this is safe inside any
 * transaction. Once there, the answer is kept for the process; a "not yet" for 30 seconds.
 */
import type { Db } from "@/server/db";

let ready = false;
let notReadyUntil = 0;

export async function schema0042Ready(db: Db): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < notReadyUntil) return false;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regprocedure('public.app_visible_to_readers_many(uuid,text,uuid[])') IS NOT NULL
        AND to_regprocedure('public.app_retract_mention_reply(uuid)') IS NOT NULL AS ok`);
  ready = r.ok;
  if (!ready) notReadyUntil = Date.now() + 30_000;
  return ready;
}

/** After 42883 (a database restored to before 0042 while the process runs). */
export function forget0042(): void {
  ready = false;
  notReadyUntil = 0;
}
