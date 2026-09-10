/**
 * Seeds two isolated organisations with fixture accounts (development only).
 * All accounts use the password: correct-horse-battery
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { buildCompany } from "../../src/server/services/fixtures";
import { getPool } from "../../src/server/db";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");
  const pool = getPool();
  if (process.env.NODE_ENV === "test") { await pool.query("SELECT 1"); }
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_ADMIN_URL : process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  const existing = await admin.query("SELECT (SELECT count(*) FROM organisations)::int AS orgs, (SELECT count(*) FROM auth_users)::int AS users");
  await admin.end();
  if (existing.rows[0].orgs > 0 || existing.rows[0].users > 0) {
    console.log("Database already contains data; skipping seed. Run `pnpm db:reset && pnpm db:seed` for a clean demo dataset.");
    await pool.end();
    return;
  }
  const a = await buildCompany("a");
  const b = await buildCompany("b", { names: { owner: "Bola Owner", hr: "Ngozi HR", manager: "Tunde Manager", employee: "Chidi Employee", employee2: "Efe Employee" } });
  console.log("Seeded:");
  for (const c of [a, b]) {
    console.log(`  ${c.slug}: owner ${c.owner.email}, hr ${c.hr.email}, manager ${c.manager.email}, employees ${c.employee.email}, ${c.employee2.email}`);
  }
  console.log("Password for every account: correct-horse-battery");
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
