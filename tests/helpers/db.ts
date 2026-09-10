import { Client } from "pg";
import { migrate } from "../../db/scripts/migrate";

export const adminUrl = () => process.env.TEST_DATABASE_ADMIN_URL!;

/** Rebuilds the test schema once per test file. */
export async function resetTestDatabase() {
  await migrate(adminUrl(), { reset: true, quiet: true });
}

export async function adminQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try { return (await c.query(sql, params as never[])).rows as T[]; } finally { await c.end(); }
}

/** Direct query as the restricted app role with a bound user, bypassing service code (RLS test). */
export async function appQueryAs(userId: string | null, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const r = await c.query(sql, params as never[]);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { await c.end(); }
}
