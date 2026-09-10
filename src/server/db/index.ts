import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// Return timestamptz as ISO strings and int8 as numbers so JSON responses are stable.
types.setTypeParser(1184, (v: string) => new Date(v).toISOString());
types.setTypeParser(1114, (v: string) => new Date(v + "Z").toISOString());
types.setTypeParser(20, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v));
types.setTypeParser(1082, (v: string) => v); // date -> 'YYYY-MM-DD'

declare global {
  var __boredroomPool: Pool | undefined;
}

function connectionString() {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

export function getPool(): Pool {
  if (!globalThis.__boredroomPool) {
    globalThis.__boredroomPool = new Pool({ connectionString: connectionString(), max: 10 });
  }
  return globalThis.__boredroomPool;
}

export type Db = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R>;
  maybeOne<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R | null>;
  client: PoolClient;
};

function wrap(client: PoolClient): Db {
  return {
    client,
    async query(text, params) {
      const res = await client.query(text, params as never[]);
      return res.rows as never;
    },
    async one(text, params) {
      const res = await client.query(text, params as never[]);
      if (res.rows.length !== 1) throw new Error(`expected exactly one row, got ${res.rows.length}`);
      return res.rows[0] as never;
    },
    async maybeOne(text, params) {
      const res = await client.query(text, params as never[]);
      return (res.rows[0] as never) ?? null;
    },
  };
}

export type Ctx = { userId: string | null; role?: "user" | "worker" | "system" };

/**
 * Runs `fn` inside one transaction with the caller's identity bound for RLS.
 * `userId` is the internal profile id. Nothing client-supplied reaches this setting.
 */
export async function withCtx<T>(ctx: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (ctx.userId) await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    if (ctx.role && ctx.role !== "user") await client.query("SELECT set_config('app.role', $1, true)", [ctx.role]);
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export const withUser = <T>(userId: string, fn: (db: Db) => Promise<T>) => withCtx({ userId }, fn);
/** Explicit privileged context for server code that must act before a user has membership (invitation lookup, auth). */
export const withSystem = <T>(fn: (db: Db) => Promise<T>) => withCtx({ userId: null, role: "system" }, fn);
export const withWorker = <T>(fn: (db: Db) => Promise<T>) => withCtx({ userId: null, role: "worker" }, fn);

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
export function isExclusionViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23P01";
}
export function isCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23514";
}
export function isRlsViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42501";
}
export function pgMessage(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? String(err);
}
