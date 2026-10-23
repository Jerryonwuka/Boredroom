/**
 * GitHub App helpers for the GitHub adapter (work group, owner decisions 22 October 2026: connectors; spec §5.3, §8.7).
 * - The App's JWT (RS256 with `GITHUB_APP_PRIVATE_KEY`, `iss` = `GITHUB_APP_ID`, issued 60 seconds in the past, valid
 *   9 minutes) signed with `node:crypto`; no SDK.
 * - Installation tokens (1 hour) minted from that JWT for a workspace connection, cached in this process until 5 minutes
 *   before they expire.
 * - Installation verification: an `installation_id` from GitHub's Setup URL is only a claim (GitHub's own warning: setup
 *   URLs can be spoofed); it is accepted only when the person's own user token lists it (`GET /user/installations`).
 * Server-only.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { env } from "../env";
import { rawRequest } from "../http";
import { ConnectorError, type ProviderHttp } from "../types";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } as const;
const CACHE_MARGIN_MS = 5 * 60_000;

/**
 * The App's private key from the environment: the PEM with `\n` escapes (or real line breaks), or base64 of the .pem
 * file. Throws NOT_CONFIGURED (never the value) when it doesn't parse.
 */
export function privateKeyFrom(raw: string): KeyObject {
  let pem = raw.trim().replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) {
    try { pem = Buffer.from(pem, "base64").toString("utf8"); } catch { pem = ""; }
  }
  try {
    return createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new ConnectorError("NOT_CONFIGURED", "GITHUB_APP_PRIVATE_KEY does not parse as a PEM private key");
  }
}

let keyCache: { raw: string; key: KeyObject } | null = null;
function appKey(): KeyObject {
  const raw = env("GITHUB_APP_PRIVATE_KEY");
  if (!raw) throw new ConnectorError("NOT_CONFIGURED", "GITHUB_APP_PRIVATE_KEY is not set");
  if (keyCache?.raw !== raw) keyCache = { raw, key: privateKeyFrom(raw) };
  return keyCache.key;
}

/** The App's JWT (RS256). `iat` 60 seconds back for clock drift, `exp` 9 minutes ahead (GitHub allows at most 10). */
export function appJwt(now: Date, appId: string = env("GITHUB_APP_ID"), key: KeyObject = appKey()): string {
  if (!/^\d{1,20}$/.test(appId) && !/^Iv[0-9A-Za-z.]{1,40}$/.test(appId)) throw new ConnectorError("NOT_CONFIGURED", "GITHUB_APP_ID is not an App id");
  const seconds = Math.floor(now.getTime() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: seconds - 60, exp: seconds + 9 * 60, iss: appId })}`;
  return `${input}.${sign("sha256", Buffer.from(input), key).toString("base64url")}`;
}

const cache = new Map<string, { token: string; expiresAt: Date }>();
/** Tests only. */
export function clearInstallationTokenCacheForTests(): void { cache.clear(); keyCache = null; }

/**
 * An installation token for `installationId` (cached until 5 minutes before its hour is up). A gone installation is
 * REVOKED; a suspended one or a refused JWT REAUTH_REQUIRED.
 */
export async function mintInstallationToken(installationId: string, now: Date = new Date(), o: { fresh?: boolean } = {}): Promise<{ token: string; expiresAt: Date }> {
  if (!/^\d{1,20}$/.test(installationId)) throw new ConnectorError("NOT_FOUND", "not an installation id");
  const hit = cache.get(installationId);
  if (!o.fresh && hit && hit.expiresAt.getTime() - now.getTime() > CACHE_MARGIN_MS) return hit;
  const res = await rawRequest(["api.github.com"], {
    method: "POST", url: `${GITHUB_API}/app/installations/${installationId}/access_tokens`, headers: { ...GITHUB_HEADERS }, authorization: `Bearer ${appJwt(now)}`, json: {},
  });
  if (res.status === 404 || res.status === 410) throw new ConnectorError("REVOKED", "installation gone");
  if (res.status === 401 || res.status === 403) throw new ConnectorError("REAUTH_REQUIRED", `installation token refused (${res.status})`);
  if (res.status === 429) throw new ConnectorError("RATE_LIMITED", "installation token rate limited", 60);
  if (res.status >= 500) throw new ConnectorError("PROVIDER_DOWN", `installation token answered ${res.status}`);
  const b = (res.body ?? {}) as Record<string, unknown>;
  if (res.status !== 201 && res.status !== 200) throw new ConnectorError("BAD_RESPONSE", `installation token answered ${res.status}`);
  if (typeof b.token !== "string" || !b.token) throw new ConnectorError("BAD_RESPONSE", "installation token missing");
  const at = typeof b.expires_at === "string" ? Date.parse(b.expires_at) : NaN;
  const minted = { token: b.token, expiresAt: new Date(Number.isNaN(at) ? now.getTime() + 3600_000 : at) };
  cache.set(installationId, minted);
  return minted;
}

export type Installation = { id: string; login: string; type: string | null; accountId: string | null };

/** Every installation of the App the person's user token can manage or see (at most 5 pages of 100). */
export async function userInstallations(http: ProviderHttp): Promise<Installation[]> {
  const out: Installation[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await http.request<{ installations?: unknown[]; total_count?: number }>({ url: `${GITHUB_API}/user/installations`, headers: { ...GITHUB_HEADERS }, query: { per_page: 100, page } });
    const list = Array.isArray(r.body?.installations) ? r.body.installations : [];
    for (const raw of list) {
      const i = (raw ?? {}) as Record<string, unknown>;
      const acc = (i.account ?? {}) as Record<string, unknown>;
      if (typeof i.id !== "number" && typeof i.id !== "string") continue;
      const accountId = typeof acc.id === "number" || (typeof acc.id === "string" && /^\d{1,20}$/.test(acc.id)) ? String(acc.id) : null;
      out.push({ id: String(i.id), login: typeof acc.login === "string" ? acc.login : "GitHub", type: typeof acc.type === "string" ? acc.type : null, accountId });
    }
    if (list.length < 100) break;
  }
  return out;
}

/** The claimed installation, only when the person's own token lists it; null otherwise. */
export async function verifyInstallation(http: ProviderHttp, claimed: unknown): Promise<Installation | null> {
  if (typeof claimed !== "string" || !/^\d{1,20}$/.test(claimed)) return null;
  return (await userInstallations(http)).find((i) => i.id === claimed) ?? null;
}

// ---- Who may connect an installation for a workspace (security fix, 22 October 2026) ------------------------------------
// GitHub lists an installation under GET /user/installations for anyone with explicit access to any one repository in it,
// while the installation token reaches every repository in it. So a workspace connection needs the connecting person to
// be an admin of the installation's account: the account itself (a personal account), or an organisation owner (role
// "admin", state "active"). That needs the App's organisation permission "Members: read".

const ORG_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** With the person's own user token: true when they administer the installation's account. */
export async function userAdministers(http: ProviderHttp, inst: Installation, me: { id: string; login: string }): Promise<boolean> {
  if (inst.type === "User") return !!inst.accountId && inst.accountId === me.id;
  if (inst.type !== "Organization" || !ORG_LOGIN.test(inst.login)) return false;
  try {
    const r = await http.request<{ role?: unknown; state?: unknown }>({ url: `${GITHUB_API}/user/memberships/orgs/${encodeURIComponent(inst.login)}`, headers: { ...GITHUB_HEADERS } });
    return r.body?.role === "admin" && r.body?.state === "active";
  } catch (err) {
    if (err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) return false;
    throw err;
  }
}

/**
 * With the installation token (sync and the repository list re-check it): true while the person who connected still
 * administers the installation's account. `settings` is what identify stored; anything missing fails closed.
 */
export async function stillAdministers(http: ProviderHttp, settings: Record<string, unknown>): Promise<boolean> {
  const type = settings.accountType;
  const login = typeof settings.login === "string" ? settings.login : "";
  if (type === "User") return typeof settings.accountId === "string" && settings.accountId === settings.userId;
  const org = typeof settings.accountLogin === "string" ? settings.accountLogin : "";
  if (type !== "Organization" || !ORG_LOGIN.test(org) || !ORG_LOGIN.test(login)) return false;
  try {
    const r = await http.request<{ role?: unknown; state?: unknown }>({ url: `${GITHUB_API}/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(login)}`, headers: { ...GITHUB_HEADERS } });
    return r.body?.role === "admin" && r.body?.state === "active";
  } catch (err) {
    if (err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) return false;
    throw err;
  }
}
