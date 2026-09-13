/**
 * One PostgreSQL LISTEN connection per process, shared by every server-sent-events subscriber.
 * Before this, each open browser tab held a pooled connection for its event stream; with a pool of ten,
 * a handful of tabs (or streams not released on navigation in dev) made every page hang.
 */
import { Client } from "pg";

type Handler = (payload: string) => void;
type Bus = { client: Client | null; connecting: Promise<Client> | null; subs: Map<string, Set<Handler>> };

declare global {
  var __boredroomNotifyBus: Bus | undefined;
}

function bus(): Bus {
  if (!globalThis.__boredroomNotifyBus) globalThis.__boredroomNotifyBus = { client: null, connecting: null, subs: new Map() };
  return globalThis.__boredroomNotifyBus;
}

function connectionString() {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

async function getClient(): Promise<Client> {
  const b = bus();
  if (b.client) return b.client;
  if (b.connecting) return b.connecting;
  b.connecting = (async () => {
    const client = new Client({ connectionString: connectionString() });
    await client.connect();
    client.on("notification", (msg) => { const hs = b.subs.get(msg.channel); if (hs) for (const h of hs) { try { h(msg.payload ?? ""); } catch { /* subscriber gone */ } } });
    client.on("error", () => { b.client = null; void reconnect(); });
    client.on("end", () => { b.client = null; });
    for (const channel of b.subs.keys()) await client.query(`LISTEN "${channel}"`);
    b.client = client;
    b.connecting = null;
    return client;
  })();
  try { return await b.connecting; } catch (err) { b.connecting = null; throw err; }
}

async function reconnect() {
  const b = bus();
  for (let attempt = 0; attempt < 30 && !b.client; attempt++) {
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
    try { await getClient(); } catch { /* try again */ }
  }
}

/** Subscribes to a NOTIFY channel. Returns an unsubscribe function; the last subscriber UNLISTENs. */
export async function subscribe(channel: string, handler: Handler): Promise<() => Promise<void>> {
  const b = bus();
  let hs = b.subs.get(channel);
  const first = !hs;
  if (!hs) { hs = new Set(); b.subs.set(channel, hs); }
  hs.add(handler);
  const client = await getClient();
  if (first) await client.query(`LISTEN "${channel}"`);
  return async () => {
    const set = b.subs.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      b.subs.delete(channel);
      try { await b.client?.query(`UNLISTEN "${channel}"`); } catch { /* connection gone; a reconnect re-LISTENs only live channels */ }
    }
  };
}

/** For diagnostics. */
export function subscriberCount(): number { let n = 0; for (const s of bus().subs.values()) n += s.size; return n; }
