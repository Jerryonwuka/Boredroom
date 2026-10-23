/**
 * One PostgreSQL LISTEN connection per process, shared by every server-sent-events subscriber.
 * Before this, each open browser tab held a pooled connection for its event stream; with a pool of ten,
 * a handful of tabs (or streams not released on navigation in dev) made every page hang.
 */
import { Client } from "pg";

type Handler = (payload: string) => void;
/**
 * `generation` counts connections: a client's own error or end handlers act only while it is still the bus's client, so
 * a connection closed on purpose (or replaced) never schedules a reconnect. `reconnecting`: one retry loop at a time.
 */
type Bus = { client: Client | null; connecting: Promise<Client> | null; subs: Map<string, Set<Handler>>; generation: number; reconnecting: boolean };

declare global {
  var __boredroomNotifyBus: Bus | undefined;
}

/** The channels each connection LISTENs to, so a channel is never LISTENed twice on one connection. */
const listening = new WeakMap<Client, Set<string>>();

async function listen(client: Client, channel: string) {
  let set = listening.get(client);
  if (!set) { set = new Set(); listening.set(client, set); }
  if (set.has(channel)) return;
  set.add(channel);
  await client.query(`LISTEN "${channel}"`);
}

function bus(): Bus {
  if (!globalThis.__boredroomNotifyBus) globalThis.__boredroomNotifyBus = { client: null, connecting: null, subs: new Map(), generation: 0, reconnecting: false };
  const b = globalThis.__boredroomNotifyBus;
  // A bus made by an older copy of this module (dev hot reload) has no generation yet.
  if (typeof b.generation !== "number") b.generation = 0;
  if (typeof b.reconnecting !== "boolean") b.reconnecting = false;
  return b;
}

/**
 * LISTEN needs a session of its own, which a transaction-mode pooler does not keep: Neon's "-pooler" host takes the
 * LISTEN and never delivers a NOTIFY (review, 8 October 2026: live updates got no events at all). The listener goes to
 * DATABASE_LISTEN_URL when set, else to the same database's direct host (the host without "-pooler").
 */
function connectionString() {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : (process.env.DATABASE_LISTEN_URL || process.env.DATABASE_URL);
  if (!url) throw new Error("DATABASE_URL is not configured");
  return unpooled(url);
}

export function unpooled(url: string): string {
  try {
    const u = new URL(url);
    if (!/-pooler\./i.test(u.hostname)) return url;
    u.hostname = u.hostname.replace(/-pooler\./i, ".");
    return u.toString();
  } catch { return url; }
}

/**
 * The LISTEN connection lives only while someone listens (owner request, 23 October 2026: realtime plan, phase 0, item 2).
 * Neon closes idle connections when it suspends; reconnecting then would wake it again for nobody. So the connection is
 * closed when the last subscriber leaves, a dropped connection is re-opened only while there are subscribers, and the
 * retry loop stops as soon as they have all gone.
 */
async function getClient(): Promise<Client> {
  const b = bus();
  if (b.client) return b.client;
  if (b.connecting) return b.connecting;
  const generation = ++b.generation;
  b.connecting = (async () => {
    const client = new Client({ connectionString: connectionString() });
    // Attached before connect, so a refused or dropped connection never ends the process with an unhandled 'error'.
    const lost = () => {
      if (b.generation !== generation) return; // closed on purpose, or already replaced
      b.client = null;
      if (b.subs.size > 0) void reconnect();
    };
    client.on("error", lost);
    client.on("end", lost);
    await client.connect();
    client.on("notification", (msg) => { const hs = b.subs.get(msg.channel); if (hs) for (const h of hs) { try { h(msg.payload ?? ""); } catch { /* subscriber gone */ } } });
    for (const channel of b.subs.keys()) await listen(client, channel);
    return client;
  })();
  try {
    const client = await b.connecting;
    b.connecting = null;
    if (b.generation !== generation) { void client.end().catch(() => undefined); throw new Error("notify-bus: connection replaced"); }
    b.client = client;
    // Everyone left while it was connecting: nobody needs it.
    if (b.subs.size === 0) closeClient();
    return client;
  } catch (err) {
    if (b.generation === generation) b.connecting = null;
    throw err;
  }
}

/** Closes the LISTEN connection; its own end handler sees a newer generation and doesn't reconnect. */
function closeClient() {
  const b = bus();
  const client = b.client;
  b.generation++;
  b.client = null;
  b.connecting = null;
  if (client) void client.end().catch(() => undefined);
}

async function reconnect() {
  const b = bus();
  if (b.reconnecting) return;
  b.reconnecting = true;
  try {
    for (let attempt = 0; attempt < 30 && !b.client; attempt++) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
      if (b.subs.size === 0 || b.client) return; // nobody listens any more, or a subscriber connected meanwhile
      try { await getClient(); } catch { /* try again */ }
    }
  } finally {
    b.reconnecting = false;
  }
}

/** Subscribes to a NOTIFY channel. Returns an unsubscribe function; the last subscriber UNLISTENs, and closes the connection. */
export async function subscribe(channel: string, handler: Handler): Promise<() => Promise<void>> {
  const b = bus();
  let hs = b.subs.get(channel);
  if (!hs) { hs = new Set(); b.subs.set(channel, hs); }
  hs.add(handler);
  const unsubscribe = async () => {
    const set = b.subs.get(channel);
    if (!set || !set.has(handler)) return;
    set.delete(handler);
    if (set.size > 0) return;
    b.subs.delete(channel);
    if (b.subs.size === 0) { closeClient(); return; }
    const c = b.client;
    listening.get(c as Client)?.delete(channel);
    try { await c?.query(`UNLISTEN "${channel}"`); } catch { /* connection gone; a reconnect re-LISTENs only live channels */ }
  };
  let client: Client;
  try { client = await getClient(); }
  catch (err) { await unsubscribe(); throw err; }
  // A fresh connection LISTENs to every channel with subscribers already; an existing one needs this channel added.
  if (b.subs.has(channel)) {
    try { await listen(client, channel); } catch { /* the connection dropped: the reconnect LISTENs again */ }
  }
  return unsubscribe;
}

/** For tests: drops the bus (closing its connection) so the next subscriber starts afresh. */
export function resetNotifyBusForTests(): void {
  closeClient();
  const b = bus();
  b.subs.clear();
  b.reconnecting = false;
}

/** For diagnostics. */
export function subscriberCount(): number { let n = 0; for (const s of bus().subs.values()) n += s.size; return n; }
