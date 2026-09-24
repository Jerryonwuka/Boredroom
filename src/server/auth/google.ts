/**
 * Sign in with Google (OpenID Connect, authorisation code flow, no library).
 *
 * start: send the browser to Google with a random state and nonce kept in a short-lived cookie.
 * callback: exchange the code for tokens, verify the ID token against Google's published keys (issuer, audience,
 * expiry, nonce), then find or create the account. Google has verified the address, so the account counts as
 * verified at once. An existing password account with the same address is linked, not duplicated.
 */
import { createPublicKey, verify as verifySignature, randomBytes, createHash } from "node:crypto";
import { withSystem, isUniqueViolation, type Db } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { issueSession } from "@/server/auth";
import { storage } from "@/server/lib/storage";

export const OAUTH_COOKIE = "boredroom_oauth";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function googleConfigured(env: Record<string, string | undefined> = process.env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function origin() { return process.env.APP_ORIGIN ?? "http://localhost:3000"; }
export function redirectUri() { return `${origin()}/api/auth/google/callback`; }

/** Where to send the browser, plus the values to remember in the cookie until it comes back. */
export function beginGoogleSignIn(next: string | null) {
  if (!googleConfigured()) throw new AppError(503, "GOOGLE_NOT_CONFIGURED", "Sign in with Google is not set up on this server.");
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: "openid email profile",
    state, nonce, access_type: "online", prompt: "select_account",
  });
  return { url: `${AUTH_URL}?${params}`, cookie: JSON.stringify({ state, nonce, next: safeNext(next), at: Date.now() }) };
}

export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

type Claims = { iss: string; aud: string; sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string; nonce?: string; exp: number; iat: number };

let jwksCache: { keys: { kid: string; [k: string]: unknown }[]; at: number } | null = null;
async function googleKeys() {
  if (jwksCache && Date.now() - jwksCache.at < 6 * 3600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AppError(502, "GOOGLE_KEYS", "Google's signing keys could not be fetched. Try again.");
  const body = (await res.json()) as { keys: { kid: string; [k: string]: unknown }[] };
  jwksCache = { keys: body.keys, at: Date.now() };
  return body.keys;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verifies an ID token's signature and claims; returns the claims. */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<Claims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AppError(401, "GOOGLE_TOKEN", "Google returned an unreadable token.");
  const header = JSON.parse(b64(parts[0]).toString("utf8")) as { alg: string; kid: string };
  if (header.alg !== "RS256") throw new AppError(401, "GOOGLE_TOKEN", "Unexpected token algorithm.");
  let keys = await googleKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache = null; keys = await googleKeys(); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new AppError(401, "GOOGLE_TOKEN", "The token was signed with an unknown key.");
  const key = createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
  const ok = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
  if (!ok) throw new AppError(401, "GOOGLE_TOKEN", "The token's signature did not check out.");
  const c = JSON.parse(b64(parts[1]).toString("utf8")) as Claims;
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.has(c.iss)) throw new AppError(401, "GOOGLE_TOKEN", "The token was not issued by Google.");
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new AppError(401, "GOOGLE_TOKEN", "The token was issued for a different app.");
  if (c.exp < now - 60) throw new AppError(401, "GOOGLE_TOKEN", "The token has expired. Try again.");
  if (c.nonce !== expectedNonce) throw new AppError(401, "GOOGLE_TOKEN", "The sign-in did not match the one that was started. Try again.");
  if (!c.sub) throw new AppError(401, "GOOGLE_TOKEN", "The token has no subject.");
  return c;
}

/** Exchanges the code for tokens and returns the verified identity. */
export async function completeGoogleSignIn(code: string, nonce: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new AppError(401, "GOOGLE_EXCHANGE", `Google did not accept the sign-in${body.error_description ? ` (${body.error_description})` : ""}. Try again.`);
  return verifyIdToken(body.id_token, nonce);
}

/**
 * Finds the account for a Google identity, links it to an existing account with the same address, or creates one.
 * Returns a session token. Google-created accounts have no password and are verified from the start.
 */
export async function signInWithGoogle(c: Claims, meta: { ip?: string; userAgent?: string }) {
  const email = c.email?.trim().toLowerCase();
  if (!email || !c.email_verified) throw new AppError(401, "GOOGLE_EMAIL", "Google did not confirm an email address for this account.");
  return withSystem(async (db) => {
    let user = await db.maybeOne<{ id: string }>(`SELECT user_id AS id FROM auth_identities WHERE provider = 'google' AND subject = $1`, [c.sub]);
    let created = false;
    if (!user) {
      user = await db.maybeOne<{ id: string }>(`SELECT id FROM auth_users WHERE email = $1`, [email]);
      if (!user) {
        user = await db.one<{ id: string }>(`INSERT INTO auth_users(email, password_hash, email_verified_at) VALUES ($1, NULL, now()) RETURNING id`, [email]);
        await db.query(`INSERT INTO profiles(auth_user_id, display_name, email) VALUES ($1, $2, $3)`, [user.id, (c.name?.trim() || email.split("@")[0]).slice(0, 120), email]);
        created = true;
      } else {
        // Same address, existing account: Google has verified it, so the account is verified too.
        await db.query(`UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`, [user.id]);
      }
      try { await db.query(`INSERT INTO auth_identities(user_id, provider, subject, email, last_used_at) VALUES ($1, 'google', $2, $3, now())`, [user.id, c.sub, email]); }
      catch (err) { if (!isUniqueViolation(err)) throw err; }
    } else {
      await db.query(`UPDATE auth_identities SET last_used_at = now(), email = $2 WHERE provider = 'google' AND subject = $1`, [c.sub, email]);
    }
    if (created && c.picture) await importPicture(db, user.id, c.picture).catch(() => undefined);
    const token = await issueSession(db, user.id, { ...meta, method: "google" });
    return { token, created };
  });
}

/** Best effort: the Google profile picture becomes the person's avatar on first sign-in. */
async function importPicture(db: Db, userId: string, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return;
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!ext[type]) return;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) return;
  const p = await db.maybeOne<{ id: string }>(`SELECT id FROM profiles WHERE auth_user_id = $1`, [userId]);
  if (!p) return;
  const key = `users/${p.id.replace(/-/g, "")}/avatar-${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext[type]}`;
  await storage().put(key, bytes, type);
  await db.query(`UPDATE profiles SET avatar_key = $2, avatar_mime = $3, updated_at = now() WHERE id = $1`, [p.id, key, type]);
}
