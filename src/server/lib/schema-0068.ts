/**
 * Migration 0068 (Brenda's own apps over MCP, and skills; owner decisions, 4 November 2026: phase 1, "go with your
 * recommendations") adds `mcp_servers`, `mcp_server_secrets`, `mcp_tools` and `brenda_skills`. It waits in db/pending
 * for the owner's go-ahead, and the code runs before it. Like schema-0061, nothing asks the database up front: a query
 * that fails for want of the tables is noted here (`noteMissing0068`, no query), and for ten minutes at a time
 * `schema0068Missing()` is true and the paths fall back:
 * - Settings says MCP servers and skills need a database update first; their routes answer 503 NOT_READY;
 * - Brenda's situation lists no apps of the workspace's own and only the built-in skills; app_tools, use_app_tool and
 *   act_with_app_tool say they aren't switched on here yet; read_skill opens built-in skills only.
 */
import { isMissingSchema } from "@/server/lib/schema-0037";

export { isMissingSchema };

const MISSING_TTL_MS = 10 * 60_000;
let missingUntil = 0;
let warned = false;

/** True for ten minutes after a query failed for want of 0068's tables. Never queries. */
export function schema0068Missing(): boolean {
  return Date.now() < missingUntil;
}

/** Notes `err` when it is a missing table or column (42P01, 42703); answers whether it was. */
export function noteMissing0068(err: unknown): boolean {
  if (!isMissingSchema(err)) return false;
  missingUntil = Date.now() + MISSING_TTL_MS;
  if (!warned) {
    warned = true;
    console.warn("[mcp] migration 0068 (MCP servers and skills) is not applied on this database: they are off until it is.");
  }
  return true;
}

/** Forget a noted "missing" (tests, or a database migrated while the process runs). */
export function forget0068(): void {
  missingUntil = 0;
}
