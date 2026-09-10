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
  const existing = await pool.query("SELECT 1 FROM organisations LIMIT 1").catch(() => ({ rows: [] }));
  if (existing.rows.length) {
    console.log("Database already contains organisations; run `pnpm db:reset` first for a clean seed.");
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
