import { accessSync, constants, mkdirSync } from "node:fs";
import { getPool } from "@/server/db";

export type Check = { ok: boolean; detail?: string; fix?: string };

/** Turns a database/driver error into a user-safe explanation and fix. */
export function explainInfraError(err: unknown): { message: string; fix: string } | null {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(msg)) return { message: "The database is not reachable (connection refused).", fix: "Start PostgreSQL and check DATABASE_URL (host and port)." };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { message: "The database host name cannot be resolved.", fix: "Check the host in DATABASE_URL." };
  if (code === "ETIMEDOUT" || code === "ECONNRESET") return { message: "The database connection timed out.", fix: "Check network access, firewall rules or the database's allowed IPs." };
  if (code === "28P01" || code === "28000") return { message: "The database rejected the application role's password.", fix: "Create role boardroom_app with the password used in DATABASE_URL (see README)." };
  if (code === "3D000") return { message: "The database named in DATABASE_URL does not exist.", fix: "Create it (CREATE DATABASE boardroom OWNER boardroom_owner) and run pnpm db:migrate." };
  if (code === "42P01") return { message: "Database tables are missing: migrations have not been applied.", fix: "Run pnpm db:migrate." };
  if (code === "42883" || code === "42704") return { message: "A database function or extension is missing.", fix: "Enable btree_gist, citext and pgcrypto, then run pnpm db:migrate." };
  if (/DATABASE_URL is not configured/.test(msg)) return { message: "DATABASE_URL is not set.", fix: "Copy .env.example to .env.local and set DATABASE_URL." };
  if (/APP_SECRET must be set/.test(msg)) return { message: "APP_SECRET is not set for production.", fix: "Set APP_SECRET (openssl rand -base64 32)." };
  if (code === "EROFS" || code === "EACCES") return { message: "The server cannot write to its storage or mail directory.", fix: "Point STORAGE_LOCAL_DIR / MAIL_SINK_DIR at a writable path, or configure a storage provider." };
  return null;
}

export async function runHealthChecks(): Promise<{ ok: boolean; checks: Record<string, Check>; nodeEnv: string | undefined; mailProvider: string; storageProvider: string }> {
  const checks: Record<string, Check> = {};
  const has = (name: string) => !!process.env[name] && !String(process.env[name]).startsWith("change-me");
  const missing = [!has("DATABASE_URL") && "DATABASE_URL", !has("APP_SECRET") && "APP_SECRET"].filter(Boolean) as string[];
  checks.env = { ok: missing.length === 0, detail: missing.length ? `missing or placeholder: ${missing.join(", ")}` : `APP_ORIGIN=${process.env.APP_ORIGIN ?? "(default http://localhost:3000)"}`, fix: missing.length ? "Copy .env.example to .env.local and fill in the values." : undefined };
  try {
    const r = await getPool().query("SELECT current_user AS role, (SELECT count(*)::int FROM schema_migrations) AS migrations, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS gist");
    const row = r.rows[0];
    const ok = row.migrations >= 7 && row.gist;
    checks.database = { ok, detail: `connected as ${row.role}; ${row.migrations} migrations applied${row.gist ? "" : "; btree_gist extension missing"}`, fix: ok ? undefined : "Run pnpm db:migrate (and enable btree_gist, citext, pgcrypto)." };
  } catch (err) {
    const why = explainInfraError(err);
    checks.database = { ok: false, detail: why ? `${why.message} [${(err as Error).message}]` : (err as Error).message, fix: why?.fix ?? "Check DATABASE_URL and that PostgreSQL is running." };
  }
  for (const [name, dir] of [["storage", process.env.STORAGE_LOCAL_DIR ?? "./var/storage"], ["mailSink", process.env.MAIL_SINK_DIR ?? "./var/mail-outbox"]] as const) {
    try { mkdirSync(dir, { recursive: true }); accessSync(dir, constants.W_OK); checks[name] = { ok: true, detail: dir }; }
    catch (err) { checks[name] = { ok: false, detail: `${dir}: ${(err as Error).message}`, fix: "Use a writable directory or configure a storage/mail provider." }; }
  }
  return { ok: Object.values(checks).every((c) => c.ok), checks, nodeEnv: process.env.NODE_ENV, mailProvider: process.env.MAIL_PROVIDER ?? "sink", storageProvider: process.env.STORAGE_PROVIDER ?? "local" };
}
