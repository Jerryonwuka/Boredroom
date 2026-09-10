import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a dev server bound to the test database.
 * `pnpm test:e2e` resets and seeds the test database first (see e2e/global-setup.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://boardroom_app:boardroom_app@localhost:5432/boardroom_test",
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://boardroom_app:boardroom_app@localhost:5432/boardroom_test",
      APP_ORIGIN: "http://localhost:3100",
      MAIL_PROVIDER: "sink",
      MAIL_SINK_DIR: "./var/e2e-mail",
      STORAGE_LOCAL_DIR: "./var/e2e-storage",
      SCAN_ALLOW_UNSCANNED: "true",
    },
  },
});
