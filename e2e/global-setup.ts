import { execSync } from "node:child_process";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

/**
 * Rebuilds and seeds the test database through the project's own scripts (tsx resolves the
 * `@/` alias; Playwright's loader does not for transitive imports).
 */
export default async function globalSetup() {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://boardroom_app:boardroom_app@localhost:5432/boardroom_test",
    MAIL_SINK_DIR: "./var/e2e-mail",
    STORAGE_LOCAL_DIR: "./var/e2e-storage",
  };
  execSync("pnpm exec tsx db/scripts/migrate.ts --test --reset", { stdio: "inherit", env });
  execSync("pnpm exec tsx db/scripts/seed.ts", { stdio: "inherit", env });
}
