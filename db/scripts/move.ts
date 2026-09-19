/**
 * Moves the local Boredroom database to another PostgreSQL (for example Neon) in one step:
 * backs up with pg_dump, restores there with pg_restore, creates the app role and grants, and (optionally)
 * rewrites .env.local so the app uses the new database from the next start.
 *
 *   pnpm db:move "<target connection url>" [--app-password <pw>] [--write-env]
 *
 * The target url is the owner connection string from the host's dashboard. A Neon "-pooler" host is switched
 * to the direct host for the restore (pg_restore needs a direct connection); the app can use either.
 * The source is DATABASE_ADMIN_URL from .env.local (the local database must be running: pnpm dev).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function directHost(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.replace("-pooler", "");
  return u.toString();
}
function withUser(url: string, user: string, password: string) {
  const u = new URL(url); u.username = user; u.password = password; return u.toString();
}
function redact(url: string) { try { const u = new URL(url); if (u.password) u.password = "***"; return u.toString(); } catch { return url; } }

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const pwIdx = args.indexOf("--app-password");
  const appPassword = pwIdx >= 0 ? args[pwIdx + 1] : process.env.RESTORE_APP_PASSWORD || randomBytes(18).toString("base64url");
  const writeEnv = args.includes("--write-env");
  if (!target) { console.error('Usage: pnpm db:move "<target connection url>" [--app-password <pw>] [--write-env]'); process.exit(1); }
  if (!process.env.DATABASE_ADMIN_URL) { console.error("DATABASE_ADMIN_URL is not set in .env.local; nothing to move."); process.exit(1); }
  const direct = directHost(target);
  if (direct !== target) console.log(`Using the direct host for the restore: ${redact(direct)}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `var/backups/boredroom-${stamp}.dump`;
  console.log(`\n1/3 Backing up the local database to ${file}`);
  const d = spawnSync(process.execPath, [require.resolve("tsx/cli"), "db/scripts/dump.ts", file], { stdio: "inherit" });
  if (d.status !== 0 || !existsSync(file)) { console.error("\nThe backup did not complete, so nothing was sent to the target."); process.exit(d.status ?? 1); }

  console.log(`\n2/3 Restoring into ${redact(direct)}`);
  const r = spawnSync(process.execPath, [require.resolve("tsx/cli"), "db/scripts/restore.ts", direct, file, "--app-password", appPassword], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`\nThe restore did not complete. The backup is still at ${file}; fix the cause and run: pnpm db:restore "<url>" ${file}`); process.exit(r.status ?? 1); }

  const adminUrl = direct;
  const appUrl = withUser(target, "boardroom_app", appPassword); // the pooled host is fine for the app itself
  console.log(`\n3/3 ${writeEnv ? "Updating .env.local" : "Connection strings"}`);
  if (writeEnv) {
    const path = ".env.local";
    if (existsSync(path)) { copyFileSync(path, `${path}.before-move-${stamp}`); console.log(`Saved the old file as ${path}.before-move-${stamp}`); }
    let env = existsSync(path) ? readFileSync(path, "utf8") : "";
    const set = (key: string, value: string) => { const re = new RegExp(`^${key}=.*$`, "m"); env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`; };
    set("DATABASE_ADMIN_URL", adminUrl);
    set("DATABASE_URL", appUrl);
    writeFileSync(path, env);
    console.log("Done. Restart the app (pnpm dev) and it runs on the new database. Your local copy is untouched; the old .env.local points back to it.");
  } else {
    console.log(`Put these in .env.local to run the app on the new database:\n  DATABASE_ADMIN_URL=${adminUrl}\n  DATABASE_URL=${appUrl}\n(or re-run with --write-env to have that done for you)`);
  }
  console.log("\nNot in the database: recording video files in var/storage. Copy that folder, or point STORAGE_* at a bucket. Then run: pnpm doctor");
}
main();
