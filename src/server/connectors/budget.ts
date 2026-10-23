/**
 * Connected apps: shared rate budgets (owner decisions, 22 October 2026: connectors; spec §4.2, §8.6). Jira's OAuth apps
 * share one global points pool across every customer (65,000 an hour since 2 March 2026); Boredroom budgets 50,000 of it
 * here, per clock hour, in the database so every web process and worker counts together. Server-only.
 */
import { withWorker, type Db } from "@/server/db";
import { ConnectorError } from "./types";

const BUCKET = /^[a-z0-9_:.-]{3,120}$/;

/** The start of the clock hour `now` is in. */
export function windowStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Spends `cost` points or throws RATE_LIMITED with the seconds to the next hour. */
export async function spendIn(db: Db, bucket: string, cost: number, capPerHour: number, now: Date = new Date()): Promise<number> {
  if (!BUCKET.test(bucket)) throw new ConnectorError("NOT_ALLOWED", "bad budget bucket");
  const w = windowStart(now);
  const row = await db.maybeOne<{ used: number }>(
    `INSERT INTO connector_rate_budget(bucket, window_start, used, cap) VALUES ($1, $2, $3, $4)
     ON CONFLICT (bucket, window_start) DO UPDATE SET used = connector_rate_budget.used + EXCLUDED.used
       WHERE connector_rate_budget.used + EXCLUDED.used <= connector_rate_budget.cap
     RETURNING used`, [bucket, w, cost, capPerHour]);
  if (!row || row.used > capPerHour) {
    const seconds = Math.max(1, Math.ceil((w.getTime() + 3600_000 - now.getTime()) / 1000));
    throw new ConnectorError("RATE_LIMITED", `budget ${bucket} spent for this hour`, seconds);
  }
  return row.used;
}

export function spend(bucket: string, cost: number, capPerHour: number): Promise<void> {
  return withWorker((db) => spendIn(db, bucket, cost, capPerHour)).then(() => undefined);
}
