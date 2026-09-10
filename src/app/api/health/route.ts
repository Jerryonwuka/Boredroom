import { NextResponse } from "next/server";
import { accessSync, constants, mkdirSync } from "node:fs";
import { getPool } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Configuration self-check (no secrets returned). Green means sign-up and sign-in can work:
 * database reachable as the application role, migrations applied, storage and mail sink writable.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const env = (name: string) => !!process.env[name] && !String(process.env[name]).startsWith("change-me");
  checks.env = {
    ok: env("DATABASE_URL") && env("APP_SECRET"),
    detail: [!env("DATABASE_URL") && "DATABASE_URL missing", !env("APP_SECRET") && "APP_SECRET missing or placeholder", !env("APP_ORIGIN") && "APP_ORIGIN missing (defaults to http://localhost:3000)"].filter(Boolean).join("; ") || undefined,
  };
  try {
    const r = await getPool().query("SELECT current_user AS role, (SELECT count(*)::int FROM schema_migrations) AS migrations, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS gist");
    const row = r.rows[0];
    checks.database = { ok: row.migrations >= 7 && row.gist, detail: `connected as ${row.role}; ${row.migrations} migrations applied${row.gist ? "" : "; btree_gist extension missing"}` };
  } catch (err) {
    checks.database = { ok: false, detail: (err as Error).message };
  }
  for (const [name, dir] of [["storage", process.env.STORAGE_LOCAL_DIR ?? "./var/storage"], ["mailSink", process.env.MAIL_SINK_DIR ?? "./var/mail-outbox"]] as const) {
    try { mkdirSync(dir, { recursive: true }); accessSync(dir, constants.W_OK); checks[name] = { ok: true, detail: dir }; }
    catch (err) { checks[name] = { ok: false, detail: `${dir}: ${(err as Error).message}` }; }
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks, nodeEnv: process.env.NODE_ENV, mailProvider: process.env.MAIL_PROVIDER ?? "sink", storageProvider: process.env.STORAGE_PROVIDER ?? "local" }, { status: ok ? 200 : 503 });
}
