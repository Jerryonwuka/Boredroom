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
    // Idle connections are kept for 10 minutes, and one always (`min`, which pg-pool honours when it reaps idle clients),
    // so a person who reads a reply for a minute and then presses Listen does not pay a new TCP + TLS + SCRAM handshake
    // first: about 2.2 s against a distant database (review, 9 October 2026: the natural voice's latency on a slow link).
    // Nothing about the role or its password changes; a connection the pooler or a NAT drops is replaced as before.
    const pool = new Pool({ connectionString: connectionString(), max: 20, min: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 600_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
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
const ENDED = Symbol("ended");
const BATCH = Symbol("batch");
type Wrapped = Db & { [SETTLED]: () => Promise<unknown>; [ENDED]: { committed: boolean }; [BATCH]: (text: string, commit: boolean) => Promise<QueryResultRow[][]> };

function wrap(client: PoolClient): Wrapped {
  let tail: Promise<unknown> = Promise.resolve();
  let running = 0;
  const ended = { committed: false };
  const send = (text: string, params?: unknown[]) => {
    // After a batch's COMMIT the connection is outside any transaction: nothing more may run as if it were inside one.
    if (ended.committed) return Promise.reject(new Error("db: the transaction was already committed"));
    // Nothing running: sent at once, exactly as before. Otherwise after the ones before it, in order.
    const next = running === 0 ? run(client, text, params) : tail.then(() => run(client, text, params));
    running++;
    tail = next.then(() => undefined, () => undefined).finally(() => { running--; });
    return next;
  };
  return {
    [SETTLED]: () => tail,
    [ENDED]: ended,
    async [BATCH](text, commit) {
      const res = (await send(commit ? `${text}; COMMIT` : text)) as unknown as { command: string; rows: QueryResultRow[] } | { command: string; rows: QueryResultRow[] }[];
      const all = Array.isArray(res) ? res : [res];
      if (commit) {
        ended.committed = true;
        // As withCtx's own COMMIT: a ROLLBACK answer means nothing was saved, so nobody may act as if it were.
        if (all[all.length - 1]?.command !== "COMMIT") throw new Error("db: the transaction rolled back at COMMIT");
        all.pop();
      }
      return all.map((r) => r.rows);
    },
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
 * A pooled connection that sat idle may be dead without anyone knowing (review, 9 October 2026, on a phone's hotspot:
 * the hotspot changed its address, or a NAT forgot the mapping). TCP then retries for many minutes, and a transaction
 * sent on it waits as long; the longer idle connections are now kept (getPool), the likelier that is. So a connection
 * idle for more than `afterMs` must answer its BEGIN within `beginMs`, or it is dropped (the pool removes it) and the
 * transaction starts on another. Nothing was done on the first but BEGIN, which the server rolls back when it goes. A live
 * connection costs nothing more: the BEGIN is sent anyway. The tests shorten both.
 */
const staleCheck = { afterMs: 30_000, beginMs: 8_000 };
const lastUsed = new WeakMap<PoolClient, number>();
/**
 * When a BEGIN that went unanswered was sent: every connection last used before then sat idle through the same outage
 * (a network change kills them all at once), so it is dropped at once, without another `beginMs` wait (review, 9 October
 * 2026: the guard covered two connections, and a third got a BEGIN with no limit; keepalive does not clear them sooner, as
 * macOS probes a silent socket every 75 s, 8 times). A connection wrongly dropped costs one new connection, never data.
 */
let deadBefore = 0;

export function setStaleConnectionCheckForTests(o: { afterMs: number; beginMs: number } | null): void {
  staleCheck.afterMs = o?.afterMs ?? 30_000;
  staleCheck.beginMs = o?.beginMs ?? 8_000;
  deadBefore = 0;
}

/** true when `p` settles within `ms` (its error is thrown), false when it is still waiting. */
async function answersWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.then(() => true), new Promise<boolean>((done) => { timer = setTimeout(() => done(false), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

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
  let client = await getPool().connect();
  // While a client is checked out the pool's idle error listener is off, and pg emits 'error' on the client when its
  // connection drops (Neon's "Connection terminated unexpectedly"). With no listener that is an uncaught exception, which
  // ends a long-running process such as the worker (fix review, 9 October 2026). The query in flight still rejects; the
  // broken client is destroyed on release rather than going back to the pool.
  const lost: { err: Error | null } = { err: null };
  const onError = (err: Error) => { lost.err = err; console.warn(`[db] connection dropped during a transaction: ${err.message}`); };
  client.on("error", onError);
  let db: Wrapped | null = null;
  // True between a dropped connection's release and its replacement's arrival: a connect that fails then must not
  // release (or roll back on) the dropped one again, which threw over the real error (review, 9 October 2026).
  let released = false;
  try {
    // An idle connection that does not answer its BEGIN in time is dropped for another (staleCheck), and so is every
    // connection idle through the same outage (deadBefore). Each turn takes one connection out of the pool, and a new
    // one (never used: no lastUsed) gets its BEGIN as before, so this ends. One `beginMs` is waited for: a second would
    // need a connection last used after the first BEGIN went unanswered, and that is not idle long enough to be checked.
    for (;;) {
      const used = lastUsed.get(client);
      if (used === undefined || used >= deadBefore) {
        if (used === undefined || Date.now() - used <= staleCheck.afterMs) { await client.query(setup); break; }
        const sentAt = Date.now();
        const begun = client.query(setup);
        begun.catch(() => undefined);
        if (await answersWithin(begun, staleCheck.beginMs)) break;
        deadBefore = Math.max(deadBefore, sentAt);
      }
      console.warn("[db] an idle connection did not answer: dropped, and the transaction moved to another");
      client.removeListener("error", onError);
      client.release(new Error("idle connection did not answer"));
      released = true;
      client = await getPool().connect();
      released = false;
      lost.err = null; // the dropped connection's, if it had one: not this one's
      client.on("error", onError);
    }
    db = wrap(client);
    const result = await fn(db);
    // A query `fn` started and did not wait for still runs inside the transaction, before COMMIT (as pg's own queue did).
    await db[SETTLED]();
    // `batchIn(db, …, { commit: true })` committed already, in the same round trip as its statements.
    if (db[ENDED].committed) return result;
    const done = await client.query("COMMIT");
    // Postgres answers COMMIT with ROLLBACK when a statement failed earlier and its error was caught and ignored:
    // every write in the transaction is gone, yet nothing threw. Say so loudly (this hid the lost new workspaces).
    if (done.command === "ROLLBACK") console.error(`[db] transaction rolled back at COMMIT: a statement failed inside it and the error was swallowed. Nothing it wrote was saved.\n${new Error().stack}`);
    return result;
  } catch (err) {
    if (!released && !lost.err && !db?.[ENDED].committed) { try { await client.query("ROLLBACK"); } catch { /* ignore */ } }
    throw err;
  } finally {
    client.removeListener("error", onError);
    if (!released) {
      if (!lost.err) lastUsed.set(client, Date.now());
      client.release(lost.err ?? undefined);
    }
  }
}

/**
 * Several statements in ONE round trip (the simple query protocol), and with `commit` the transaction's COMMIT too:
 * withCtx then sends no COMMIT of its own, and nothing more may run on `db`. Each statement still takes its own snapshot
 * (READ COMMITTED), so a statement after `pg_advisory_xact_lock(…)` sees every write committed before the lock was granted.
 * The simple protocol takes no parameters: every value in `statements` must be validated and inlined by the caller, as
 * withCtx does for its identity settings (review, 9 October 2026: the natural voice's latency on a slow link). Answers
 * each statement's rows, in order (COMMIT's left out). Only on a `db` that withCtx gave.
 */
export async function batchIn(db: Db, statements: string[], opts: { commit?: boolean } = {}): Promise<QueryResultRow[][]> {
  const w = db as Partial<Wrapped>;
  if (typeof w[BATCH] !== "function") throw new Error("batchIn: not a transaction from withCtx");
  return w[BATCH](statements.join("; "), !!opts.commit);
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
