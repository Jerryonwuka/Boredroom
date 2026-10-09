/**
 * The pool's idle connections (review, 9 October 2026: the natural voice's latency on a slow link). Idle connections are
 * now kept for 10 minutes (one always), so a person who reads a reply and then presses Listen does not pay a new
 * connection first; but on a phone's hotspot an idle connection can be dead without anyone knowing (the hotspot changed
 * its address), and a transaction sent on it would wait for many minutes. withCtx gives an idle connection a few seconds
 * to answer its BEGIN, then drops it and starts the transaction on another. On the throwaway test database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { getPool, setStaleConnectionCheckForTests, withSystem } from "@/server/db";
import { resetTestDatabase } from "../helpers/db";

type PoolInternals = { _idle: { client: PoolClient }[]; _clients: PoolClient[]; options: { min?: number; idleTimeoutMillis?: number } };
const internals = () => getPool() as unknown as PoolInternals;

beforeAll(async () => { await resetTestDatabase(); });
afterEach(() => { setStaleConnectionCheckForTests(null); vi.restoreAllMocks(); });
afterAll(() => { setStaleConnectionCheckForTests(null); });

describe("the pool's idle connections", () => {
  it("are kept for 10 minutes, and one always", () => {
    expect(internals().options).toMatchObject({ min: 1, idleTimeoutMillis: 600_000 });
  });

  it("an idle connection that answers its BEGIN is used as it is (no new connection)", async () => {
    await withSystem((db) => db.one(`SELECT 1 AS n`));
    const before = internals()._clients.slice();
    setStaleConnectionCheckForTests({ afterMs: 0, beginMs: 2_000 });
    await new Promise((done) => setTimeout(done, 5));
    expect(await withSystem((db) => db.one<{ n: number }>(`SELECT 2 AS n`))).toEqual({ n: 2 });
    expect(internals()._clients).toEqual(before);
  });

  it("an idle connection that does not answer its BEGIN is dropped, and the transaction runs on another", async () => {
    await withSystem((db) => db.one(`SELECT 1 AS n`));
    const idle = internals()._idle.map((i) => i.client);
    expect(idle.length).toBeGreaterThan(0);
    // Every idle connection goes silent (as after the hotspot changed its address): BEGIN never answers.
    for (const c of idle) {
      const orig = c.query.bind(c) as (...a: unknown[]) => unknown;
      (c as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) =>
        (typeof a[0] === "string" && a[0].startsWith("BEGIN") ? new Promise(() => undefined) : orig(...a));
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setStaleConnectionCheckForTests({ afterMs: 0, beginMs: 300 });
    await new Promise((done) => setTimeout(done, 5));
    const started = Date.now();
    expect(await withSystem((db) => db.one<{ n: number }>(`SELECT 3 AS n`))).toEqual({ n: 3 });
    expect(Date.now() - started).toBeLessThan(5_000);
    for (const c of idle) expect(internals()._clients).not.toContain(c);
    expect(warn).toHaveBeenCalledWith("[db] an idle connection did not answer: dropped, and the transaction moved to another");
  });
});

describe("the pool's idle connections after an outage (review, 9 October 2026)", () => {
  /** Makes every BEGIN on `c` go unanswered, as on a socket the hotspot left behind. */
  const silence = (c: PoolClient) => {
    const orig = c.query.bind(c) as (...a: unknown[]) => unknown;
    (c as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) =>
      (typeof a[0] === "string" && a[0].startsWith("BEGIN") ? new Promise(() => undefined) : orig(...a));
  };

  it("drops every connection idle through the same outage, waiting for one BEGIN only (not two, then a third with no limit)", async () => {
    // Four connections at once, so four sit idle afterwards.
    await Promise.all([1, 2, 3, 4].map(() => withSystem((db) => db.one(`SELECT pg_sleep(0.05)`))));
    const idle = internals()._idle.map((i) => i.client);
    expect(idle.length).toBeGreaterThanOrEqual(4);
    idle.forEach(silence);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setStaleConnectionCheckForTests({ afterMs: 0, beginMs: 400 });
    await new Promise((done) => setTimeout(done, 5));
    const started = Date.now();
    expect(await withSystem((db) => db.one<{ n: number }>(`SELECT 4 AS n`))).toEqual({ n: 4 });
    // One 400 ms wait, then the others went at once (with a cap of two, the third BEGIN never came back).
    expect(Date.now() - started).toBeLessThan(800 + 3_000);
    for (const c of idle) expect(internals()._clients).not.toContain(c);
    expect(warn.mock.calls.filter((c) => c[0] === "[db] an idle connection did not answer: dropped, and the transaction moved to another").length).toBe(idle.length);
  });

  it("a new connection that fails after a drop is the error thrown (the dropped one is not released twice)", async () => {
    await withSystem((db) => db.one(`SELECT 1 AS n`));
    const idle = internals()._idle.map((i) => i.client);
    idle.forEach(silence);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setStaleConnectionCheckForTests({ afterMs: 0, beginMs: 200 });
    await new Promise((done) => setTimeout(done, 5));
    const pool = getPool();
    const connect = pool.connect.bind(pool) as () => Promise<PoolClient>;
    let calls = 0;
    const down = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    vi.spyOn(pool, "connect").mockImplementation((() => (++calls === 1 ? connect() : Promise.reject(down))) as never);
    await expect(withSystem((db) => db.one(`SELECT 5 AS n`))).rejects.toBe(down);
    vi.restoreAllMocks();
    // The pool still works afterwards: the other silent ones were idle through the same outage, so they go at once.
    expect(await withSystem((db) => db.one<{ n: number }>(`SELECT 6 AS n`))).toEqual({ n: 6 });
  });
});
