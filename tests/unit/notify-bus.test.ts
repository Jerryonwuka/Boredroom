/**
 * notify-bus (owner request, 23 October 2026: realtime plan, phase 0, item 2): the LISTEN connection lives only while
 * someone listens. Closed when the last subscriber leaves; a dropped connection is re-opened only while there are
 * subscribers; the retry loop stops when they have all gone. pg's Client is replaced by a fake: no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeClient } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    static made: FakeClient[] = [];
    static failConnect = 0;
    queries: string[] = [];
    ended = false;
    constructor() { super(); FakeClient.made.push(this); }
    async connect() { if (FakeClient.failConnect > 0) { FakeClient.failConnect--; throw new Error("refused"); } }
    async query(sql: string) { this.queries.push(sql); return { rows: [] }; }
    async end() { this.ended = true; this.emit("end"); }
    /** The server going away (Neon suspending): an error, then the end. */
    drop() { this.emit("error", new Error("terminated")); this.emit("end"); }
  }
  return { FakeClient };
});

vi.mock("pg", () => ({ Client: FakeClient }));

const load = () => import("@/server/lib/notify-bus");
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  vi.useRealTimers();
  (await load()).resetNotifyBusForTests();
  FakeClient.made = [];
  FakeClient.failConnect = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe("the LISTEN connection follows its subscribers", () => {
  it("opens once for several subscribers and LISTENs each channel once", async () => {
    const bus = await load();
    const un1 = await bus.subscribe("org_a", () => undefined);
    const un2 = await bus.subscribe("org_a", () => undefined);
    const un3 = await bus.subscribe("org_b", () => undefined);
    expect(FakeClient.made).toHaveLength(1);
    expect(FakeClient.made[0].queries).toEqual(['LISTEN "org_a"', 'LISTEN "org_b"']);
    expect(bus.subscriberCount()).toBe(3);
    await un1(); await un2(); await un3();
  });

  it("UNLISTENs a channel nobody listens to, and closes the connection when the last subscriber leaves", async () => {
    const bus = await load();
    const unA = await bus.subscribe("org_a", () => undefined);
    const unB = await bus.subscribe("org_b", () => undefined);
    const c = FakeClient.made[0];
    await unA();
    expect(c.queries).toContain('UNLISTEN "org_a"');
    expect(c.ended).toBe(false);
    await unB();
    expect(c.ended).toBe(true);
    await settle();
    // Closing on purpose never schedules a reconnect.
    expect(FakeClient.made).toHaveLength(1);
  });

  it("calling an unsubscribe twice changes nothing", async () => {
    const bus = await load();
    const un = await bus.subscribe("org_a", () => undefined);
    const keep = await bus.subscribe("org_a", () => undefined);
    await un(); await un();
    expect(bus.subscriberCount()).toBe(1);
    expect(FakeClient.made[0].ended).toBe(false);
    await keep();
  });

  it("a new subscriber after the close opens a fresh connection", async () => {
    const bus = await load();
    await (await bus.subscribe("org_a", () => undefined))();
    const un = await bus.subscribe("org_a", () => undefined);
    expect(FakeClient.made).toHaveLength(2);
    expect(FakeClient.made[1].queries).toEqual(['LISTEN "org_a"']);
    await un();
  });

  it("delivers notifications to the channel's subscribers only", async () => {
    const bus = await load();
    const got: string[] = [];
    const un1 = await bus.subscribe("org_a", (p) => got.push(`a:${p}`));
    const un2 = await bus.subscribe("org_b", (p) => got.push(`b:${p}`));
    FakeClient.made[0].emit("notification", { channel: "org_a", payload: "1" });
    expect(got).toEqual(["a:1"]);
    await un1(); await un2();
  });
});

describe("reconnecting", () => {
  it("a dropped connection with subscribers reconnects and LISTENs every live channel again", async () => {
    vi.useFakeTimers();
    const bus = await load();
    const un = await bus.subscribe("org_a", () => undefined);
    FakeClient.made[0].drop();
    expect(FakeClient.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeClient.made).toHaveLength(2);
    expect(FakeClient.made[1].queries).toEqual(['LISTEN "org_a"']);
    await un();
    expect(FakeClient.made[1].ended).toBe(true);
  });

  it("a dropped connection with nobody subscribed never reconnects (Neon stays asleep)", async () => {
    vi.useFakeTimers();
    const bus = await load();
    const un = await bus.subscribe("org_a", () => undefined);
    const c = FakeClient.made[0];
    await un();
    // The connection closed with the last subscriber; even an error from it afterwards changes nothing.
    c.drop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeClient.made).toHaveLength(1);
  });

  it("the retry loop stops when the subscribers leave while it waits", async () => {
    vi.useFakeTimers();
    const bus = await load();
    const un = await bus.subscribe("org_a", () => undefined);
    FakeClient.failConnect = 100; // the database stays away
    FakeClient.made[0].drop();
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    const tries = FakeClient.made.length;
    expect(tries).toBeGreaterThan(1);
    await un();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(FakeClient.made.length).toBe(tries);
  });

  it("a failed first connection leaves no subscriber behind", async () => {
    const bus = await load();
    FakeClient.failConnect = 1;
    await expect(bus.subscribe("org_a", () => undefined)).rejects.toThrow(/refused/);
    expect(bus.subscriberCount()).toBe(0);
  });
});
