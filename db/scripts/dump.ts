/**
 * Backs up the Boredroom database with pg_dump, in a form that pg_restore can load into any PostgreSQL,
 * including Neon: custom format, no ownership or grant statements (roles differ per host; restore re-applies them).
 *
 *   pnpm db:dump                      → var/backups/boredroom-<timestamp>.dump
 *   pnpm db:dump path/to/file.dump    → that file
 *   pnpm db:dump --sql                → plain SQL instead of custom format (for reading, or psql -f)
 *
 * Needs the pg_dump client tool at least as new as the server. The quickstart database is PostgreSQL 18, so on a
 * Mac: `brew install postgresql@18` (or `libpq`) and put its bin directory first on PATH; on Ubuntu/Debian add the
 * PostgreSQL apt repository and install postgresql-client-18.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error("DATABASE_ADMIN_URL is not set in .env.local"); process.exit(1); }
  const plain = process.argv.includes("--sql");
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = fileArg ?? `var/backups/boredroom-${stamp}.${plain ? "sql" : "dump"}`;
  mkdirSync("var/backups", { recursive: true });

  const c = new Client({ connectionString: url });
  try { await c.connect(); } catch (err) { console.error(`Cannot reach the database: ${(err as Error).message}\nStart it first (pnpm dev, or pnpm quickstart).`); process.exit(1); }
  const server = (await c.query("SHOW server_version")).rows[0].server_version as string;
  const tables = (await c.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0].n as number;
  const migrations = (await c.query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1").catch(() => ({ rows: [{ name: "none" }] }))).rows[0].name as string;
  await c.end();

  const ver = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (ver.status !== 0) { console.error("pg_dump is not installed or not on PATH.\n  macOS: brew install postgresql@18   then   export PATH=\"$(brew --prefix postgresql@18)/bin:$PATH\"\n  Ubuntu: sudo apt install postgresql-client-18 (from the PostgreSQL apt repository)"); process.exit(1); }
  const clientMajor = Number(/(\d+)/.exec(ver.stdout)?.[1] ?? 0);
  const serverMajor = Number(server.split(".")[0]);
  if (clientMajor < serverMajor) { console.error(`pg_dump ${clientMajor} cannot back up a PostgreSQL ${server} server. Install pg_dump ${serverMajor} (macOS: brew install postgresql@${serverMajor}) and put it first on PATH.`); process.exit(1); }

  const args = ["--no-owner", "--no-privileges", "--no-comments", `--file=${file}`, plain ? "--format=plain" : "--format=custom", url];
  console.log(`Backing up PostgreSQL ${server} (${tables} tables, migrations through ${migrations}) with pg_dump ${clientMajor}…`);
  const r = spawnSync("pg_dump", args, { stdio: "inherit" });
  if (r.status !== 0) { console.error("pg_dump failed."); process.exit(r.status ?? 1); }
  const mb = (statSync(file).size / 1048576).toFixed(2);
  console.log(`Backup written: ${file} (${mb} MB)\n\nRestore anywhere with: pnpm db:restore "<target connection url>" ${file}\nRecording video files are not in the database; copy var/storage (or point STORAGE_* at a bucket) separately.`);
}
main().catch((err) => { console.error(err.message); process.exit(1); });
