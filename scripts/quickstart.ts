/**
 * Zero-install local run: starts a self-contained PostgreSQL (downloaded with the dev
 * dependencies), prepares roles/databases/migrations/seed on first use, then starts the app.
 *
 *   pnpm quickstart            web app on http://localhost:3000
 *   pnpm quickstart --worker   also runs the background worker
 *
 * Data lives in ./var/pgdata and survives restarts. Ctrl+C stops everything.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { startLocalPostgres, superUrl, LOCAL_PG_PORT as PORT } from "./local-pg";

function ensureEnvFile() {
  const wanted: Record<string, string> = {
    DATABASE_ADMIN_URL: `postgres://boardroom_owner:boardroom_owner@localhost:${PORT}/boardroom`,
    DATABASE_URL: `postgres://boardroom_app:boardroom_app@localhost:${PORT}/boardroom`,
    TEST_DATABASE_ADMIN_URL: `postgres://boardroom_owner:boardroom_owner@localhost:${PORT}/boardroom_test`,
    TEST_DATABASE_URL: `postgres://boardroom_app:boardroom_app@localhost:${PORT}/boardroom_test`,
    PG_SUPERUSER_URL: superUrl("postgres"),
    SCAN_ALLOW_UNSCANNED: "true",
  };
  const template = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "APP_ORIGIN=http://localhost:3000\nAPP_SECRET=change-me\nMAIL_PROVIDER=sink\nSTORAGE_PROVIDER=local\n";
  let text = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : template.replace(/^APP_SECRET=.*$/m, `APP_SECRET=${randomBytes(32).toString("base64")}`);
  for (const [k, v] of Object.entries(wanted)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(".env.local", text);
  for (const [k, v] of Object.entries(wanted)) process.env[k] = v;
}

function run(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...extraEnv }, shell: process.platform === "win32" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function main() {
  ensureEnvFile();
  const stopPg = await startLocalPostgres();
  const stop = async () => { console.log("\nStopping local PostgreSQL…"); await stopPg(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);

  const tsx = process.platform === "win32" ? "npx.cmd" : "npx";
  await run(tsx, ["tsx", "db/scripts/bootstrap.ts"]);
  await run(tsx, ["tsx", "db/scripts/migrate.ts"]);
  await run(tsx, ["tsx", "db/scripts/seed.ts"]);
  await run(tsx, ["tsx", "scripts/doctor.ts"]);

  const withWorker = process.argv.includes("--worker");
  console.log("\nBoredroom is starting. Sign in at http://localhost:3000/login with ada@company-a.test / correct-horse-battery\n");
  const next = spawn(tsx, ["next", "dev", "-p", "3000"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  const worker = withWorker ? spawn(tsx, ["tsx", "worker/index.ts"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" }) : null;
  next.on("exit", () => { worker?.kill(); void stop(); });
}

main().catch(async (err) => { console.error(err.message); process.exit(1); });
