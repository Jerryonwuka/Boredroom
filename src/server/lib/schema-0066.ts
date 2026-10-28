/**
 * Migration 0066 (Brenda's research in the background; owner decision, 28 October 2026: "Brenda, research X and give me
 * a PDF when you're done") waits in db/pending until the owner's go-ahead. It adds `research_reports` and the ai_usage
 * purpose 'research'. The code runs before it is applied, so, as with 0061 and 0064, nothing probes for it: a query that
 * fails for want of its table is noted here (`noteMissing0066`, no query), and from then on, for ten minutes at a time,
 * `schema0066Missing()` is true and the research paths take their fallbacks:
 * - Brenda's start_research and research_status answer { error: RESEARCH_NOT_READY } ("research isn't available yet");
 * - the Research page says it needs a database update; its list route answers { ready: false, reports: [] };
 * - the file route answers 404 (nothing to serve); the worker's research.run and its purge return at once.
 */
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

const MISSING_TTL_MS = 10 * 60_000;
let missingUntil = 0;
let warned = false;

/** True for ten minutes after a query failed for want of 0066's table. Never queries. */
export function schema0066Missing(): boolean {
  return Date.now() < missingUntil;
}

/** Notes `err` when it is a missing table or column (42P01, 42703); answers whether it was. */
export function noteMissing0066(err: unknown): boolean {
  if (!isMissingSchema(err)) return false;
  missingUntil = Date.now() + MISSING_TTL_MS;
  if (!warned) {
    warned = true;
    console.warn("[research] migration 0066 is not applied on this database: Brenda's research is off until it is.");
  }
  return true;
}

/** Forget a noted "missing" (tests, or a database migrated while the process runs). */
export function forget0066(): void {
  missingUntil = 0;
}
