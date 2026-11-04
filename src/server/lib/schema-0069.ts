/**
 * Migration 0069 (signing in to MCP servers; owner request, 4 November 2026: phase 1b) adds `mcp_server_oauth`,
 * `mcp_oauth_states` and the 'oauth' sign-in kind. It waits in db/pending for the owner's go-ahead; the code runs
 * without it. Like schema-0068, nothing asks the database up front: a query that fails for want of the tables (or the
 * 'oauth' kind's check) is noted here (`noteMissing0069`), and for ten minutes at a time `schema0069Missing()` is true:
 * - Settings offers "Sign in with the app" only as "needs a database update first", and the sign-in routes answer
 *   503 NOT_READY;
 * - servers with keys, and Brenda's use of them, are unchanged.
 */
import { isMissingSchema } from "@/server/lib/schema-0037";

const MISSING_TTL_MS = 10 * 60_000;
let missingUntil = 0;
let warned = false;

/** True for ten minutes after a query failed for want of 0069. Never queries. */
export function schema0069Missing(): boolean {
  return Date.now() < missingUntil;
}

/** Notes `err` when it is a missing table or column (42P01, 42703) or the old sign-in kind check; answers whether it was. */
export function noteMissing0069(err: unknown): boolean {
  const oldCheck = (err as { code?: string; constraint?: string })?.code === "23514" && (err as { constraint?: string }).constraint === "mcp_servers_auth_check";
  if (!isMissingSchema(err) && !oldCheck) return false;
  missingUntil = Date.now() + MISSING_TTL_MS;
  if (!warned) {
    warned = true;
    console.warn("[mcp] migration 0069 (signing in to MCP servers) is not applied on this database: signing in is off until it is.");
  }
  return true;
}

/** Forget a noted "missing" (tests, or a database migrated while the process runs). */
export function forget0069(): void {
  missingUntil = 0;
}
