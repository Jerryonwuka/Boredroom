/**
 * Creates the PostgreSQL roles, databases and extensions Boredroom needs. Idempotent.
 * Connects as a superuser: PG_SUPERUSER_URL (default postgres://postgres:postgres@localhost:5432/postgres).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

const superUrl = process.env.PG_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

async function main() {
  const admin = new Client({ connectionString: superUrl });
  try { await admin.connect(); } catch (err) {
    console.error(`Cannot connect as a PostgreSQL superuser using ${superUrl.replace(/:[^:@/]+@/, ":***@")}\n${(err as Error).message}\n\nIs PostgreSQL installed and running? Set PG_SUPERUSER_URL if your superuser or password differs.`);
    process.exit(1);
  }
  const roles = [["boardroom_owner", "SUPERUSER"], ["boardroom_app", "NOSUPERUSER NOBYPASSRLS"]] as const;
  for (const [name, opts] of roles) {
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
    if (!exists.rows.length) { await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${name}' ${opts}`); console.log(`created role ${name}`); }
  }
  for (const db of ["boardroom", "boardroom_test"]) {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
    if (!exists.rows.length) { await admin.query(`CREATE DATABASE ${db} OWNER boardroom_owner`); console.log(`created database ${db}`); }
  }
  await admin.end();
  for (const db of ["boardroom", "boardroom_test"]) {
    const c = new Client({ connectionString: superUrl.replace(/\/[^/?]*(\?|$)/, `/${db}$1`) });
    await c.connect();
    for (const ext of ["btree_gist", "citext", "pgcrypto"]) await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    await c.end();
  }
  console.log("Roles, databases and extensions are ready. Next: pnpm db:migrate && pnpm db:seed");
}
main().catch((err) => { console.error(err.message); process.exit(1); });
