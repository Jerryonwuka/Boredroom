/**
 * Microsoft identity and Graph, shared by Outlook Calendar and Microsoft Teams (calendars + chat group; owner decisions,
 * 22 October 2026: connectors; spec §8.2). One multitenant app registration (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)
 * with two redirect URIs. Authorisation code with PKCE (S256) and the client secret; refresh tokens rotate (a new one each
 * use, 90 days by default), so the framework stores the new pair every time. Microsoft has no per-app revoke endpoint:
 * disconnecting deletes Boredroom's tokens and the card says where to remove the app. Server-only.
 */
import { env, envAll } from "../env";
import { hostAllowed, retryAfterSeconds } from "../http";
import { ConnectorError, type HttpResponse, type OAuthConfig, type ProviderHttp, type TokenSet } from "../types";
import { isValidTimeZone, localTimeOn } from "@/server/lib/time";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const GRAPH_HOST = "graph.microsoft.com";
export const LOGIN_HOST = "login.microsoftonline.com";
export const MS_ENV = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"] as const;
/** The tenant id every personal Microsoft account's id_token carries (outlook.com, hotmail.com, live.com). */
export const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export const msConfigured = (e?: NodeJS.ProcessEnv) => envAll(MS_ENV, e ?? process.env);

/** Every scope Boredroom asks Microsoft for, in its canonical spelling (token answers vary in case and prefix). */
const CANONICAL = ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadBasic", "Calendars.ReadWrite", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"];
const BY_LOWER = new Map(CANONICAL.map((s) => [s.toLowerCase(), s]));

/**
 * The scopes a token answer grants, spelled as Boredroom asked for them. Microsoft returns Graph scopes with or without
 * the `https://graph.microsoft.com/` prefix and often leaves out the OpenID ones and `offline_access`: an id_token means
 * the OpenID scopes were granted, a refresh token means `offline_access` was.
 */
export function msScopes(b: Record<string, unknown>): string[] | null {
  if (typeof b.scope !== "string") return null;
  const out = new Set<string>();
  for (const raw of b.scope.split(/\s+/).filter(Boolean)) {
    const s = raw.replace(/^https:\/\/graph\.microsoft\.com\//i, "");
    out.add(BY_LOWER.get(s.toLowerCase()) ?? s);
  }
  if (typeof b.id_token === "string") { out.add("openid"); out.add("profile"); out.add("email"); }
  if (typeof b.refresh_token === "string" && b.refresh_token) out.add("offline_access");
  return [...out];
}

const ADMIN_CODES = /AADSTS(65001|90094|90095|90099|65004)/;

export function parseMicrosoftToken(body: unknown, now: Date): TokenSet {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.error === "string") {
    const description = typeof b.error_description === "string" ? b.error_description : "";
    // The code only, never Microsoft's description, goes into the message.
    if (b.error === "consent_required" || ADMIN_CODES.test(description)) throw new ConnectorError("ADMIN_APPROVAL", "microsoft: admin approval needed");
    if (b.error === "invalid_grant" || b.error === "interaction_required") throw new ConnectorError("REAUTH_REQUIRED", `microsoft token error ${b.error}`);
    throw new ConnectorError("BAD_RESPONSE", `microsoft token error ${b.error.slice(0, 40)}`);
  }
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "microsoft token missing");
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null,
    tokenType: typeof b.token_type === "string" ? b.token_type : "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: typeof b.refresh_token_expires_in === "number" ? new Date(now.getTime() + b.refresh_token_expires_in * 1000) : null,
    scopes: msScopes(b),
  };
}

/**
 * The OAuth configuration for one Microsoft app on a tenant: `common` (Outlook: work, school and personal accounts) or
 * `organizations` (Teams: work and school only). The callback is always a top-level GET (`response_mode=query`).
 */
export function msOAuth(tenant: "common" | "organizations", scopes: OAuthConfig["scopes"]): OAuthConfig {
  return {
    authorizeUrl: `https://${LOGIN_HOST}/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://${LOGIN_HOST}/${tenant}/oauth2/v2.0/token`,
    clientId: () => env("MICROSOFT_CLIENT_ID"),
    clientSecret: () => env("MICROSOFT_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: " ",
    scopes,
    authorizeParams: (c) => ({ response_mode: "query", prompt: "select_account", nonce: c.nonce }),
    parseToken: parseMicrosoftToken,
    refresh: "rotating",
  };
}

type GraphError = { error?: { code?: string } };

/** Graph's error bodies as fixed codes (§8.2); null leaves it to the status mapping. */
export function interpretGraph(res: HttpResponse<unknown>): ConnectorError | null {
  if (res.status < 400) return null;
  const code = ((res.body ?? {}) as GraphError).error?.code ?? "";
  const wait = retryAfterSeconds(res.headers);
  if ((res.status === 503 || res.status === 504) && wait) return new ConnectorError("RATE_LIMITED", "graph busy", wait);
  if (code === "InvalidAuthenticationToken" || code === "CompactToken.Expired") return new ConnectorError("REAUTH_REQUIRED", "graph token refused");
  if (code === "ApplicationThrottled" || code === "TooManyRequests" || code === "ErrorTooManyObjectsOpened" || code === "MailboxConcurrency") return new ConnectorError("RATE_LIMITED", "graph throttled", wait ?? 60);
  if (code === "ErrorAccessDenied" || code === "Authorization_RequestDenied" || code === "AccessDenied" || code === "Forbidden") return new ConnectorError("FORBIDDEN", "graph access denied");
  if (code === "ErrorItemNotFound" || code === "ResourceNotFound" || code === "NotFound" || code === "ErrorInvalidIdMalformed") return new ConnectorError("NOT_FOUND", "graph item not found");
  return null;
}

export type GraphMe = { id: string; displayName?: string | null; mail?: string | null; userPrincipalName?: string | null };

export async function graphMe(http: ProviderHttp): Promise<GraphMe> {
  const me = (await http.request<GraphMe>({ url: `${GRAPH}/me`, query: { $select: "id,displayName,mail,userPrincipalName" } })).body;
  if (!me || typeof me.id !== "string" || !me.id) throw new ConnectorError("BAD_RESPONSE", "graph: no account id");
  return me;
}

/** The tenant (`tid`) from the id_token the framework already checked, or null. */
export function tenantOf(facts: TokenSet["facts"]): string | null {
  const c = (facts?.idTokenClaims ?? null) as Record<string, unknown> | null;
  return c && typeof c.tid === "string" && /^[0-9a-f-]{36}$/i.test(c.tid) ? c.tid.toLowerCase() : null;
}

/**
 * Every page of a Graph collection, at most `maxPages`, stopping at `deadline`. `@odata.nextLink` must stay on Graph's
 * own host (the SSRF guard checks it again). `done` says whether the collection was read to its end.
 */
export async function graphPages<T>(http: ProviderHttp, url: string, o: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string>; maxPages: number; deadline?: number; maxItems?: number }): Promise<{ items: T[]; done: boolean }> {
  const items: T[] = [];
  let next: string | null = url;
  let first = true;
  let pages = 0;
  while (next) {
    const r: HttpResponse<{ value?: T[]; "@odata.nextLink"?: string }> = await http.request<{ value?: T[]; "@odata.nextLink"?: string }>({ url: next, ...(first && o.query ? { query: o.query } : {}), ...(o.headers ? { headers: o.headers } : {}) });
    first = false;
    pages++;
    if (Array.isArray(r.body?.value)) items.push(...r.body.value);
    const link = r.body?.["@odata.nextLink"];
    next = typeof link === "string" && link ? link : null;
    if (next && !hostAllowed(next, [GRAPH_HOST])) throw new ConnectorError("BAD_RESPONSE", "graph nextLink off host");
    if (next && (pages >= o.maxPages || (o.deadline && Date.now() > o.deadline) || (o.maxItems && items.length >= o.maxItems))) return { items, done: false };
  }
  return { items, done: true };
}

/** An instant as Graph's dateTimeTimeZone, in UTC. */
export function toGraphTime(iso: string): { dateTime: string; timeZone: "UTC" } {
  return { dateTime: new Date(iso).toISOString().slice(0, 19), timeZone: "UTC" };
}

/** Graph's dateTimeTimeZone ("2026-10-23T10:00:00.0000000", "UTC") as an ISO instant; null when unreadable. */
export function fromGraphTime(t: { dateTime?: string | null; timeZone?: string | null } | null | undefined): string | null {
  const dt = t?.dateTime;
  if (typeof dt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(dt)) return null;
  const zone = (t?.timeZone ?? "UTC").trim();
  if (zone && zone !== "UTC" && zone !== "Etc/UTC" && isValidTimeZone(zone)) {
    // We ask for UTC (Prefer: outlook.timezone="UTC"); an IANA zone answered anyway is honoured to the minute.
    return localTimeOn(dt.slice(0, 10), dt.slice(11, 16), zone).toISOString();
  }
  const d = new Date(`${dt.slice(0, 23)}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
