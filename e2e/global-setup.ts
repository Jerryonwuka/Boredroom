import { execSync } from "node:child_process";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

/**
 * Rebuilds and seeds the test database through the project's own scripts (tsx resolves the
 * `@/` alias; Playwright's loader does not for transitive imports).
 */
export default async function globalSetup() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://boardroom_app:boardroom_app@localhost:5432/boardroom_test",
    MAIL_SINK_DIR: "./var/e2e-mail",
    STORAGE_LOCAL_DIR: "./var/e2e-storage",
  };
  execSync("pnpm exec tsx db/scripts/migrate.ts --test --reset", { stdio: "inherit", env });
  execSync("pnpm exec tsx db/scripts/seed.ts", { stdio: "inherit", env });
  // The Free plan's seat cap (5 people) is lifted as tests/helpers/db.ts does: the seeded workspace is already full, and
  // the invitation test adds a sixth person. Seat limits have their own integration tests.
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  await admin.connect();
  try { await admin.query("UPDATE plans SET max_users = NULL WHERE code = 'free'"); } finally { await admin.end(); }
}
