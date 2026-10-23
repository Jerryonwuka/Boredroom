/**
 * Migration 0061 (connected apps; owner decisions, 22 October 2026: "add connectors so teams can integrate their other
 * apps") is applied everywhere the connector code runs: it is in db/migrations, the new production database has it, and
 * the test reset applies it.
 *
 * The guards that asked the database whether it was there are gone (owner request, 23 October 2026: realtime plan, phase
 * 0, item 5): each was a query (a webhook's ran before its signature was checked, so unsigned junk woke Neon), and
 * every cold Vercel instance asked again. The code stays safe on a database without 0061 (one restored to before it):
 * a query that fails for want of its tables is noted here (`noteMissing0061`, no query), and from then on, for ten
 * minutes at a time, `schema0061Missing()` is true and the connector paths take their old fallbacks:
 * - Settings' connector cards say "Connected apps need a database update first.";
 * - connector routes answer 503 CONNECTORS_NOT_READY with those words;
 * - My Day and the Dashboard leave "From your apps" out; Brenda's connector tools answer { error: CONNECTORS_NOT_READY };
 * - the worker's connector jobs return at once; a webhook is answered 200 and dropped.
 */
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

/** How long a seen "missing" holds before the tables are tried again (a migration run meanwhile is picked up then). */
const MISSING_TTL_MS = 10 * 60_000;
let missingUntil = 0;
let warned = false;

/** True for ten minutes after a query failed for want of 0061's tables. Never queries. */
export function schema0061Missing(): boolean {
  return Date.now() < missingUntil;
}

/** Notes `err` when it is a missing table or column (42P01, 42703); answers whether it was. */
export function noteMissing0061(err: unknown): boolean {
  if (!isMissingSchema(err)) return false;
  missingUntil = Date.now() + MISSING_TTL_MS;
  if (!warned) {
    warned = true;
    console.warn("[connectors] migration 0061 is not applied on this database: connected apps are off until it is.");
  }
  return true;
}

/** Forget a noted "missing" (tests, or a database migrated while the process runs). */
export function forget0061(): void {
  missingUntil = 0;
}
