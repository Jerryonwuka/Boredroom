/**
 * `pnpm dev`: starts the app, and also the self-contained PostgreSQL when .env.local points at it
 * (i.e. the project was set up with `pnpm quickstart`). With your own PostgreSQL nothing changes.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { usesLocalPostgres, canConnect, startLocalPostgres, superUrl, DATA_DIR } from "./local-pg";
import { migrate } from "../db/scripts/migrate";

async function main() {
  let stop: (() => Promise<void>) | null = null;
  if (usesLocalPostgres()) {
    if (!existsSync(`${DATA_DIR}/PG_VERSION`)) { console.error("The local database has not been set up yet. Run: pnpm quickstart"); process.exit(1); }
    if (!(await canConnect(superUrl("postgres")))) stop = await startLocalPostgres();
    else console.log("Local PostgreSQL is already running.");
    // Apply any migrations added since the last run so a `git pull` never leaves the schema behind.
    if (process.env.DATABASE_ADMIN_URL) await migrate(process.env.DATABASE_ADMIN_URL);
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const port = process.env.PORT ?? "3000";
  const next = spawn(npx, ["next", "dev", "-p", port], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  const shutdown = async () => { if (stop) { console.log("\nStopping local PostgreSQL…"); await stop(); } process.exit(0); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  next.on("exit", () => void shutdown());
}
main().catch((err) => { console.error(err.message); process.exit(1); });
