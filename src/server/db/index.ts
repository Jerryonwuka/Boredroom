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
    // connectionTimeoutMillis turns an exhausted pool into a clear error instead of a page that never loads.
    // keepAlive stops idle pooled sockets being silently dropped by NATs and the hosted pooler (seen as "read ETIMEDOUT"
    // storms and 1.8s reconnects on the next page). The error handler keeps a dead idle client from crashing the process.
    const pool = new Pool({ connectionString: connectionString(), max: 20, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 60_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
    pool.on("error", (err) => { console.warn(`[db] idle connection dropped: ${err.message}`); });
    globalThis.__boredroomPool = pool;
  }
  return globalThis.__boredroomPool;
}

export type Db = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R>;
  maybeOne<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R | null>;
  client: PoolClient;
};

async function run(client: PoolClient, text: string, params?: unknown[]) {
  try {
    return await client.query(text, params as never[]);
  } catch (err) {
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      (err as Error & { query?: string }).query = text;
      err.message = `${err.message} [sql: ${text.replace(/\s+/g, " ").slice(0, 160)}]`;
    }
    throw err;
  }
}

/**
 * One transaction's queries, one after another. Callers may start several at once (`Promise.all` of reads in one
 * transaction); a connection runs them in turn anyway, but pg 8 warns when a query is started while another is running
 * ("Calling client.query() when the client is already executing a query is deprecated", an error in pg 9). Queuing them
 * here keeps the order and the timing as they were and silences that (review, 8 October 2026).
 */
const SETTLED = Symbol("settled");
type Wrapped = Db & { [SETTLED]: () => Promise<unknown> };

function wrap(client: PoolClient): Wrapped {
  let tail: Promise<unknown> = Promise.resolve();
  let running = 0;
  const send = (text: string, params?: unknown[]) => {
    // Nothing running: sent at once, exactly as before. Otherwise after the ones before it, in order.
    const next = running === 0 ? run(client, text, params) : tail.then(() => run(client, text, params));
    running++;
    tail = next.then(() => undefined, () => undefined).finally(() => { running--; });
    return next;
  };
  return {
    [SETTLED]: () => tail,
    client,
    async query(text, params) {
      const res = await send(text, params);
      return res.rows as never;
    },
    async one(text, params) {
      const res = await send(text, params);
      if (res.rows.length !== 1) throw new Error(`expected exactly one row, got ${res.rows.length}`);
      return res.rows[0] as never;
    },
    async maybeOne(text, params) {
      const res = await send(text, params);
      return (res.rows[0] as never) ?? null;
    },
  };
}

export type Ctx = { userId: string | null; role?: "user" | "worker" | "system" };

/**
 * Runs `fn` inside one transaction with the caller's identity bound for RLS.
 * `userId` is the internal profile id. Nothing client-supplied reaches this setting.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["worker", "system"]);

export async function withCtx<T>(ctx: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  // BEGIN and the identity settings go in one multi-statement query: one round trip instead of two or three.
  // Values are validated (a UUID, a role from a fixed set) before being inlined, since a multi-statement query cannot
  // take parameters. Against a distant database each round trip is a large share of a page load.
  if (ctx.userId && !UUID.test(ctx.userId)) throw new Error("withCtx: userId is not a UUID");
  if (ctx.role && ctx.role !== "user" && !ROLES.has(ctx.role)) throw new Error("withCtx: unknown role");
  const setup = ["BEGIN", ...(ctx.userId ? [`SELECT set_config('app.user_id', '${ctx.userId}', true)`] : []), ...(ctx.role && ctx.role !== "user" ? [`SELECT set_config('app.role', '${ctx.role}', true)`] : [])].join("; ");
  const client = await getPool().connect();
  // While a client is checked out the pool's idle error listener is off, and pg emits 'error' on the client when its
  // connection drops (Neon's "Connection terminated unexpectedly"). With no listener that is an uncaught exception, which
  // ends a long-running process such as the worker (fix review, 9 October 2026). The query in flight still rejects; the
  // broken client is destroyed on release rather than going back to the pool.
  const lost: { err: Error | null } = { err: null };
  const onError = (err: Error) => { lost.err = err; console.warn(`[db] connection dropped during a transaction: ${err.message}`); };
  client.on("error", onError);
  try {
    await client.query(setup);
    const db = wrap(client);
    const result = await fn(db);
    // A query `fn` started and did not wait for still runs inside the transaction, before COMMIT (as pg's own queue did).
    await db[SETTLED]();
    const done = await client.query("COMMIT");
    // Postgres answers COMMIT with ROLLBACK when a statement failed earlier and its error was caught and ignored:
    // every write in the transaction is gone, yet nothing threw. Say so loudly (this hid the lost new workspaces).
    if (done.command === "ROLLBACK") console.error(`[db] transaction rolled back at COMMIT: a statement failed inside it and the error was swallowed. Nothing it wrote was saved.\n${new Error().stack}`);
    return result;
  } catch (err) {
    if (!lost.err) { try { await client.query("ROLLBACK"); } catch { /* ignore */ } }
    throw err;
  } finally {
    client.removeListener("error", onError);
    client.release(lost.err ?? undefined);
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
