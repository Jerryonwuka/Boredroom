/**
 * Restores a `pnpm db:dump` backup into another PostgreSQL (for example Neon), then makes it Boredroom-ready:
 * creates the restricted application role, re-applies its grants, and prints the .env.local values to use.
 *
 *   pnpm db:restore "<target url>" var/backups/boredroom-….dump [--app-password <pw>]
 *
 * The target url must connect as the database owner (on Neon: the connection string from the dashboard, which
 * ends in ?sslmode=require). The database is emptied of Boredroom objects first (--clean), so point it at the
 * database you intend to replace. Idempotent: run again to refresh.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const GRANTS = `
GRANT USAGE ON SCHEMA public TO boardroom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boardroom_app;
REVOKE DELETE ON audit_events, session_intervals, report_versions, reviews, task_submissions, deliverables,
  recording_access_log, deletion_tombstones, policy_acknowledgements FROM boardroom_app;
REVOKE UPDATE ON audit_events, reviews, policy_acknowledgements, recording_access_log FROM boardroom_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO boardroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO boardroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO boardroom_app;`;

function withUser(url: string, user: string, password: string) {
  const u = new URL(url);
  u.username = user; u.password = password;
  return u.toString();
}

async function main() {
  const [rawTarget, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // pg_restore needs a direct connection; Neon's "-pooler" host is switched to the direct one.
  const target = rawTarget ? (() => { const u = new URL(rawTarget); u.hostname = u.hostname.replace("-pooler", ""); return u.toString(); })() : rawTarget;
  if (rawTarget && target !== rawTarget) console.log("Using the direct (non-pooled) host for the restore.");
  const pwIdx = process.argv.indexOf("--app-password");
  const providedPassword = pwIdx > 0 ? process.argv[pwIdx + 1] : process.env.RESTORE_APP_PASSWORD || undefined;
  const appPassword = providedPassword ?? randomBytes(18).toString("base64url");
  if (!target || !file) { console.error('Usage: pnpm db:restore "<target connection url>" <backup file> [--app-password <password>]'); process.exit(1); }
  if (!existsSync(file)) { console.error(`Backup file not found: ${file}`); process.exit(1); }
  const safe = target.replace(/:[^:@/]+@/, ":***@");

  const admin = new Client({ connectionString: target });
  try { await admin.connect(); } catch (err) { console.error(`Cannot connect to ${safe}\n${(err as Error).message}`); process.exit(1); }
  const server = (await admin.query("SHOW server_version")).rows[0].server_version as string;
  console.log(`Target: PostgreSQL ${server} at ${safe}`);
  for (const ext of ["btree_gist", "citext", "pgcrypto"]) await admin.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
  const role = await admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'boardroom_app'");
  if (role.rows.length) {
    // Only a superuser may mention SUPERUSER/BYPASSRLS in ALTER ROLE (even as a no-op), and hosts like Neon give the
    // database owner no superuser. So just set the password, then check the attributes the app relies on.
    if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) { console.error("The existing boardroom_app role is SUPERUSER or BYPASSRLS; row-level security would not apply. Fix the role (or drop it) and run again."); process.exit(1); }
    if (providedPassword) {
      // The owner manages this role (for example in the Neon dashboard): use the password as given and never change it.
      console.log("boardroom_app already exists; using the password from RESTORE_APP_PASSWORD / --app-password without changing the role.");
    } else {
      await admin.query(`ALTER ROLE boardroom_app WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
      console.log("Updated the boardroom_app role password.");
    }
  } else { await admin.query(`CREATE ROLE boardroom_app LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS`); console.log("Created the boardroom_app role."); }
  await admin.end();

  const ver = spawnSync("pg_restore", ["--version"], { encoding: "utf8" });
  if (ver.status !== 0) { console.error("pg_restore is not installed or not on PATH (it ships with the PostgreSQL client tools, like pg_dump)."); process.exit(1); }
  console.log(`Restoring ${file} with ${ver.stdout.trim()}…`);
  const r = spawnSync("pg_restore", ["--no-owner", "--no-privileges", "--clean", "--if-exists", "--exit-on-error", "--single-transaction", `--dbname=${target}`, file], { stdio: "inherit" });
  if (r.status !== 0) { console.error("pg_restore failed; nothing was changed (single transaction)."); process.exit(r.status ?? 1); }

  const post = new Client({ connectionString: target });
  await post.connect();
  await post.query(GRANTS);
  const counts = await post.query("SELECT (SELECT count(*) FROM organisations)::int AS orgs, (SELECT count(*) FROM memberships)::int AS members, (SELECT count(*) FROM tasks)::int AS tasks, (SELECT max(name) FROM schema_migrations) AS migration");
  await post.end();
  const c = counts.rows[0];
  console.log(`\nRestored: ${c.orgs} organisation(s), ${c.members} membership(s), ${c.tasks} task(s); migrations through ${c.migration}.`);
  console.log(`\nPut these in .env.local on the machine that runs the app:\n  DATABASE_ADMIN_URL=${target}\n  DATABASE_URL=${withUser(target, "boardroom_app", appPassword)}\n\nThe app role password above is shown once; keep it with your secrets. Then run: pnpm doctor`);
}
main().catch((err) => { console.error(err.message); process.exit(1); });
