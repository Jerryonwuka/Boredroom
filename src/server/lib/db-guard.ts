/**
 * Which database a development process may use (owner request, 23 October 2026: realtime plan, phase 0, item 1). Neon
 * only sleeps after 5 minutes without a query, and a laptop running `pnpm dev` against production kept it awake all day
 * and all night (its worker polled every 2 seconds), which used up the free allowance on 22 October. So:
 * - `pnpm dev` refuses a database that isn't on this machine unless BOREDROOM_DEV_REMOTE_DB=1, and even then it never
 *   starts the worker;
 * - the worker refuses a database that isn't on this machine whenever NODE_ENV isn't "production" (Fly sets it in
 *   Dockerfile.worker).
 * Pure functions of the environment, so the rules are tested without starting anything. Never prints a URL: only the
 * variable's name and whether its host is local.
 */

/** Hosts that are this machine: localhost, 127.0.0.0/8, ::1, *.localhost, and a Unix socket (no host). */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/**
 * True when a PostgreSQL URL points at this machine. A URL that can't be read counts as remote (refused), never as local.
 * `?host=/tmp` (a Unix socket directory) is local; `?host=db.example.com` overrides the authority's host, as libpq does.
 */
export function isLocalDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return true; // nothing configured: nothing remote to protect (the process fails later with its own message)
  try {
    const u = new URL(url);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
    const hostParam = u.searchParams.get("host");
    if (hostParam) return hostParam.startsWith("/") || hostParam.split(",").every((h) => isLocalHost(h));
    return isLocalHost(u.hostname);
  } catch {
    return false;
  }
}

/** The variables a development process may connect with. */
export const DEV_DATABASE_VARS = ["DATABASE_URL", "DATABASE_ADMIN_URL", "DATABASE_LISTEN_URL"] as const;

type Env = Record<string, string | undefined>;

/** Names of the database variables that point away from this machine. */
export function remoteDatabaseVars(env: Env, names: readonly string[] = DEV_DATABASE_VARS): string[] {
  return names.filter((n) => env[n] && !isLocalDatabaseUrl(env[n]));
}

export const REMOTE_FLAG = "BOREDROOM_DEV_REMOTE_DB";

const HOW_TO_GO_LOCAL = [
  "To develop on the database on this machine (recommended):",
  "  1. pnpm quickstart        (first time: starts the local PostgreSQL in ./var/pgdata on port 54329, creates the roles,",
  "                            applies the migrations, seeds it and points DATABASE_URL and DATABASE_ADMIN_URL in .env.local at it)",
  "     or, if ./var/pgdata exists already, set in .env.local:",
  "       DATABASE_URL=postgres://boardroom_app:boardroom_app@localhost:54329/boardroom",
  "       DATABASE_ADMIN_URL=postgres://boardroom_owner:boardroom_owner@localhost:54329/boardroom",
  "     and keep the hosted lines in a note outside the repository.",
  "  2. pnpm dev               (starts that PostgreSQL itself, see scripts/local-pg.ts)",
].join("\n");

export type DevGuard =
  | { ok: true; remote: false; worker: boolean }
  | { ok: true; remote: true; worker: false; notice: string }
  | { ok: false; message: string };

/**
 * `pnpm dev`'s decision. Local databases: as before (the worker unless --no-worker). A remote one: refused, unless
 * BOREDROOM_DEV_REMOTE_DB=1, and then the web app only, never the worker.
 */
export function devDatabaseGuard(env: Env, opts: { noWorker?: boolean } = {}): DevGuard {
  const remote = remoteDatabaseVars(env);
  if (!remote.length) return { ok: true, remote: false, worker: !opts.noWorker };
  if (env[REMOTE_FLAG] === "1") {
    return {
      ok: true, remote: true, worker: false,
      notice: `${remote.join(" and ")} point${remote.length === 1 ? "s" : ""} at a database that isn't on this machine, and ${REMOTE_FLAG}=1 allows it: `
        + "starting the web app only. The background worker never runs against a remote database from `pnpm dev`; every page "
        + "you leave open keeps that database awake, so close them when you finish.",
    };
  }
  return {
    ok: false,
    message: [
      `pnpm dev stopped: ${remote.join(" and ")} in .env.local point${remote.length === 1 ? "s" : ""} at a database that isn't on this machine.`,
      "Developing against a hosted database (Neon) keeps it awake and uses up its allowance, and the worker would run",
      "jobs there twice.",
      "",
      HOW_TO_GO_LOCAL,
      "",
      `To run the web app against it anyway (no worker), start it with ${REMOTE_FLAG}=1 pnpm dev.`,
    ].join("\n"),
  };
}

/**
 * The worker's decision: in production (NODE_ENV=production, as on Fly) anything goes; otherwise only a database on this
 * machine. `url` is the one the worker will use (TEST_DATABASE_URL under NODE_ENV=test, else DATABASE_URL).
 */
export function workerDatabaseGuard(env: Env): { ok: true } | { ok: false; message: string } {
  if (env.NODE_ENV === "production") return { ok: true };
  const name = env.NODE_ENV === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
  if (isLocalDatabaseUrl(env[name])) return { ok: true };
  return {
    ok: false,
    message: [
      `The worker stopped: ${name} points at a database that isn't on this machine, and NODE_ENV is ${env.NODE_ENV ? `"${env.NODE_ENV}"` : "not set"}, not "production".`,
      "Outside production the worker only runs against a local database, so a laptop never runs jobs on (or keeps awake) the",
      "hosted one. The production worker runs on Fly with NODE_ENV=production.",
      "",
      HOW_TO_GO_LOCAL,
    ].join("\n"),
  };
}
