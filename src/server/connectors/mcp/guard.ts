/**
 * The outbound guard for addresses people type in (owner decisions, 4 November 2026: MCP servers, phase 1). Connected
 * apps call only their adapters' fixed hosts (http.ts); an MCP server's address comes from an admin, so this checks it:
 * - https only, port 443, no user:password, no fragment; a host with a dot that isn't localhost, .local or .internal;
 * - an IP literal, and every address the name resolves to, must be public: private, loopback, link-local (the cloud
 *   metadata address among them), carrier-grade NAT, multicast, documentation and reserved ranges are refused, IPv4
 *   inside IPv6 (mapped, NAT64, 6to4) by the IPv4 inside;
 * - the check runs when the connection is made (the socket's own lookup), so a name can't resolve to a public address
 *   for the check and a private one for the call (DNS rebinding);
 * - no redirects: a 3xx comes back as it is, and the client treats it as an error.
 * Tests and development reach in-process hosts and test fetches through connectorFetch's seams. Server-only.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { connectorFetch, connectorFetchIsSeamed } from "../http";

export class BlockedAddress extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddress";
  }
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/i;

/** The address as a URL, or a BlockedAddress saying why not. Doesn't resolve the name. */
export function checkServerUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new BlockedAddress("not an address"); }
  if (u.protocol !== "https:") throw new BlockedAddress("not https");
  if (u.username || u.password) throw new BlockedAddress("user or password in the address");
  if (u.port && u.port !== "443") throw new BlockedAddress("not port 443");
  if (u.hash) throw new BlockedAddress("a fragment");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) {
    if (!publicAddress(host)) throw new BlockedAddress("a private address");
    return u;
  }
  if (!host.includes(".") || host.endsWith(".") || BLOCKED_NAMES.test(host)) throw new BlockedAddress("a private name");
  return u;
}

// ---- Addresses ----------------------------------------------------------------------------------------------------------

const v4 = (s: string): number | null => {
  const p = s.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = n * 256 + Number(x);
  }
  return n;
};
const cidr4 = (base: string, bits: number): [number, number] => [v4(base)!, bits];
const BLOCKED_V4: [number, number][] = [
  cidr4("0.0.0.0", 8), cidr4("10.0.0.0", 8), cidr4("100.64.0.0", 10), cidr4("127.0.0.0", 8), cidr4("169.254.0.0", 16),
  cidr4("172.16.0.0", 12), cidr4("192.0.0.0", 24), cidr4("192.0.2.0", 24), cidr4("192.88.99.0", 24), cidr4("192.168.0.0", 16),
  cidr4("198.18.0.0", 15), cidr4("198.51.100.0", 24), cidr4("203.0.113.0", 24), cidr4("224.0.0.0", 4), cidr4("240.0.0.0", 4),
];
const in4 = (n: number, [base, bits]: [number, number]) => bits === 0 || Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits));

/** The 8 groups of an IPv6 address (an embedded IPv4 tail too), or null. */
function v6Groups(s: string): number[] | null {
  let a = s.toLowerCase().split("%")[0];
  const tail = a.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const n = v4(tail[1]);
    if (n === null) return null;
    a = `${a.slice(0, -tail[1].length)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(":") : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** True for a public unicast address; anything unreadable is not. */
export function publicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4(ip);
    return n !== null && !BLOCKED_V4.some((c) => in4(n, c));
  }
  if (kind !== 6) return false;
  const g = v6Groups(ip);
  if (!g) return false;
  const embedded = (hi: number, lo: number) => publicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible); :: and ::1 among them.
    return g[5] === 0xffff || g[6] !== 0 || g[7] > 1 ? embedded(g[6], g[7]) : false;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // documentation
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return false; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  return (g[0] & 0xe000) === 0x2000; // global unicast only
}

// ---- The transport --------------------------------------------------------------------------------------------------------

type Resolver = (host: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (host) => new Promise((resolve, reject) => {
  dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
});
let resolver: Resolver = systemResolver;

/** Tests only: answer name lookups with `impl` (null restores the system's). */
export function setResolverForTests(impl: Resolver | null): void {
  resolver = impl ?? systemResolver;
}

/** Every address `host` resolves to, when all are public; a BlockedAddress otherwise. */
export async function resolvePublic(host: string): Promise<LookupAddress[]> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (!publicAddress(bare)) throw new BlockedAddress("a private address");
    return [{ address: bare, family: isIP(bare) }];
  }
  let all: LookupAddress[];
  try { all = await resolver(bare); } catch { throw new BlockedAddress("the name doesn't resolve"); }
  if (!all.length) throw new BlockedAddress("the name doesn't resolve");
  if (all.some((a) => !publicAddress(a.address))) throw new BlockedAddress("the name resolves to a private address");
  return all;
}

/** The socket's lookup: the guard's answer, so the address checked is the address connected to. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublic(hostname).then(
    (all) => {
      const want = typeof options === "object" && options ? options.family : undefined;
      const pick = all.find((a) => !want || a.family === want) ?? all[0];
      if (typeof options === "object" && options?.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, all);
      else callback(null, pick.address, pick.family);
    },
    (err: Error) => callback(Object.assign(err, { code: "EBLOCKED" }) as NodeJS.ErrnoException, "", 0),
  );
};

/**
 * fetch, guarded: checks the address, connects only to public addresses, never follows a redirect. `init.body` is a
 * string or absent; `init.signal` stops it. Seamed hosts (tests, development) go to connectorFetch after the URL check.
 */
export async function guardedFetch(rawUrl: string, init: RequestInit & { body?: string }): Promise<Response> {
  const u = checkServerUrl(rawUrl);
  if (connectorFetchIsSeamed(u.toString())) return connectorFetch(u.toString(), { ...init, redirect: "manual" });
  await resolvePublic(u.hostname);
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const req = httpsRequest(u, { method: init.method ?? "GET", headers, lookup: guardedLookup, agent: false, signal: init.signal ?? undefined }, (res) => {
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) for (const x of v) h.append(k, x);
        else if (typeof v === "string") h.set(k, v);
      }
      const status = res.statusCode ?? 502;
      const body = status === 204 || status === 304 ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
      resolve(new Response(body, { status, headers: h }));
    });
    req.on("error", (err: NodeJS.ErrnoException) => reject(err.code === "EBLOCKED" ? new BlockedAddress(err.message) : err));
    if (init.body) req.write(init.body);
    req.end();
  });
}
