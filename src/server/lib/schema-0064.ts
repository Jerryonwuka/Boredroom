/**
 * Migration 0064 (Boredroom for Mac, option A; owner request, 24 October 2026) waits in db/pending until the owner's
 * go-ahead. It adds `auth_sessions.desktop_session_id` and the three desktop sign-in tables (requests, handoff codes,
 * browser tickets). The code runs before it is applied, so, as with 0061, nothing probes for it: a query that fails for
 * want of its tables or column is noted here (`noteMissing0064`, no query), and from then on, for ten minutes at a time,
 * `schema0064Missing()` is true and the desktop paths take their old fallbacks:
 * - the new desktop routes answer 503 DESKTOP_APP_NOT_READY (the app then signs its window in on its own and links the
 *   notch with a code, as before);
 * - logout and unlinking a Mac retry their old single-row statements (they never fail for want of 0064);
 * - a connector start with `browser: true` answers 503, and without it works as before.
 */
import { isMissingSchema } from "@/server/lib/schema-0037";
import { AppError } from "@/server/lib/errors";

const MISSING_TTL_MS = 10 * 60_000;
let missingUntil = 0;
let warned = false;

/** True for ten minutes after a query failed for want of 0064's tables or column. Never queries. */
export function schema0064Missing(): boolean {
  return Date.now() < missingUntil;
}

/** Notes `err` when it is a missing table or column (42P01, 42703); answers whether it was. */
export function noteMissing0064(err: unknown): boolean {
  if (!isMissingSchema(err)) return false;
  missingUntil = Date.now() + MISSING_TTL_MS;
  if (!warned) {
    warned = true;
    console.warn("[desktop-app] migration 0064 is not applied on this database: Boredroom for Mac signs its window and its notch in separately until it is.");
  }
  return true;
}

/** Forget a noted "missing" (tests, or a database migrated while the process runs). */
export function forget0064(): void {
  missingUntil = 0;
}

export const desktopAppNotReady = () =>
  new AppError(503, "DESKTOP_APP_NOT_READY", "Signing in Boredroom for Mac this way needs a database update first. Use a code from the notch instead.");

/** Runs `fn`; a missing 0064 becomes 503 DESKTOP_APP_NOT_READY (and is noted). Refuses at once while it is noted. */
export async function with0064<T>(fn: () => Promise<T>): Promise<T> {
  if (schema0064Missing()) throw desktopAppNotReady();
  try {
    return await fn();
  } catch (err) {
    if (noteMissing0064(err)) throw desktopAppNotReady();
    throw err;
  }
}
