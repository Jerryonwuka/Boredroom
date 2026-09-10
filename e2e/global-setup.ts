import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { migrate } from "../db/scripts/migrate";

export default async function globalSetup() {
  (process.env as Record<string, string>).NODE_ENV = "test";
  process.env.MAIL_SINK_DIR = "./var/e2e-mail";
  process.env.STORAGE_LOCAL_DIR = "./var/e2e-storage";
  await migrate(process.env.TEST_DATABASE_ADMIN_URL!, { reset: true, quiet: true });
  const { buildCompany } = await import("../src/server/services/fixtures");
  await buildCompany("a");
  await buildCompany("b");
  const { getPool } = await import("../src/server/db");
  await getPool().end();
}
