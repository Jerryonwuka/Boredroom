/**
 * The event stream route and the LISTEN connection (fix review, 23 October 2026: realtime plan, phase 0, item 2). A
 * browser that leaves while the connection is still opening (seconds after a Neon suspend) must leave no subscriber
 * behind, or the connection never closes and keeps reconnecting. pg's Client and the membership check are replaced by
 * fakes: no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeClient } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    static made: FakeClient[] = [];
    /** When set, connect() waits for it: a slow first connection. */
    static gate: Promise<void> | null = null;
    queries: string[] = [];
    ended = false;
    constructor() { super(); FakeClient.made.push(this); }
    async connect() { if (FakeClient.gate) await FakeClient.gate; }
    async query(sql: string) { this.queries.push(sql); return { rows: [] }; }
    async end() { this.ended = true; this.emit("end"); }
  }
  return { FakeClient };
});

vi.mock("pg", () => ({ Client: FakeClient }));
vi.mock("@/server/lib/api", () => ({
  orgContext: async () => ({ org: { id: "00000000-0000-4000-8000-000000000001" } }),
  errorResponse: () => new Response("no", { status: 403 }),
}));

const bus = () => import("@/server/lib/notify-bus");
const route = () => import("@/app/api/orgs/[org]/events/route");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function slowConnect() {
  let open!: () => void;
  FakeClient.gate = new Promise<void>((r) => { open = r; });
  return () => { FakeClient.gate = null; open(); };
}

async function call(signal: AbortSignal) {
  const { GET } = await route();
  return GET(new Request("http://localhost/api/orgs/a/events", { signal }), { params: Promise.resolve({ org: "a" }) });
}

beforeEach(async () => {
  (await bus()).resetNotifyBusForTests();
  FakeClient.made = [];
  FakeClient.gate = null;
});
afterEach(() => { FakeClient.gate = null; });

describe("a browser that leaves while the LISTEN connection is opening", () => {
  it("aborted during a slow connect: no subscriber left, and the connection is closed", async () => {
    const release = slowConnect();
    const ac = new AbortController();
    const res = await call(ac.signal);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    await settle();
    expect((await bus()).subscriberCount()).toBe(1);
    ac.abort();
    release();
    await settle();
    expect((await bus()).subscriberCount()).toBe(0);
    expect(FakeClient.made).toHaveLength(1);
    expect(FakeClient.made[0].ended).toBe(true);
  });

  it("the stream cancelled (no abort) during a slow connect: the same", async () => {
    const release = slowConnect();
    const res = await call(new AbortController().signal);
    await settle();
    await res.body!.cancel();
    release();
    await settle();
    expect((await bus()).subscriberCount()).toBe(0);
    expect(FakeClient.made[0].ended).toBe(true);
  });

  it("already aborted before the stream starts: never subscribes", async () => {
    const ac = new AbortController();
    ac.abort();
    await call(ac.signal);
    await settle();
    expect((await bus()).subscriberCount()).toBe(0);
    expect(FakeClient.made).toHaveLength(0);
  });

  it("a stream that connected and is then aborted unsubscribes and closes the connection", async () => {
    const ac = new AbortController();
    const res = await call(ac.signal);
    await settle();
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(": connected");
    expect((await bus()).subscriberCount()).toBe(1);
    ac.abort();
    await settle();
    expect((await bus()).subscriberCount()).toBe(0);
    expect(FakeClient.made[0].ended).toBe(true);
  });
});
