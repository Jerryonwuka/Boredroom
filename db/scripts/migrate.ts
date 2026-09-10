/**
 * Applies db/migrations/*.sql in lexical order using the admin connection.
 * Usage: pnpm db:migrate            (DATABASE_ADMIN_URL)
 *        pnpm db:migrate --test     (TEST_DATABASE_ADMIN_URL)
 *        pnpm db:reset [--test]     drops and recreates the public schema first
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const args = process.argv.slice(2);
const isTest = args.includes("--test");
const reset = args.includes("--reset");
const url = isTest ? process.env.TEST_DATABASE_ADMIN_URL : process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error(`Missing ${isTest ? "TEST_DATABASE_ADMIN_URL" : "DATABASE_ADMIN_URL"}`);
  process.exit(1);
}

export async function migrate(connectionString: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (opts.reset) {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await client.query("GRANT USAGE ON SCHEMA public TO PUBLIC;");
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        if (!opts.quiet) console.log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate(url, { reset }).then(
    () => console.log("migrations up to date"),
    (err) => { console.error(err.message); process.exit(1); },
  );
}
