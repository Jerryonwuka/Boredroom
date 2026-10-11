import { cache } from "react";
import type { Presence } from "@/lib/presence";
import { cookies, headers } from "next/headers";
import { withSystem, isUniqueViolation, type Db } from "@/server/db";
import { hashPassword, verifyPassword, randomToken, sha256 } from "@/server/lib/crypto";
import { AppError, invalid, rateLimited, unauthenticated } from "@/server/lib/errors";
import { mail } from "@/server/lib/mail";
import { verifyEmailMail, resetPasswordMail } from "@/server/lib/emails";
import { contactRegistered } from "@/server/admin/marketing";
import { registrationOpen } from "@/server/admin/settings";
import { joiningTarget, safeNextPath } from "@/components/auth/next-path";

/**
 * Local auth provider: email/password with verification and recovery.
 * Swap for Supabase Auth by implementing the same functions against auth.users
 * (see docs/providers.md). profiles.auth_user_id stays the join key.
 */

export const SESSION_COOKIE = "boredroom_session";
const SESSION_TTL_DAYS = 14;
const TOKEN_TTL_MIN = { verify_email: 60 * 24, recover_password: 60 } as const;

export type CurrentUser = {
  profileId: string;
  authUserId: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  sessionId: string;
  avatarKey?: string | null;
  title?: string | null;
  statusText?: string | null;
  /** Work status set by the person: active, away, busy (do not disturb) or offline. */
  presence?: Presence;
  /** Set when an administrator is viewing Boredroom as this person (Control Center support). */
  impersonation?: { id: string; adminEmail: string } | null;
};

function appOrigin() { return process.env.APP_ORIGIN ?? "http://localhost:3000"; }

async function rateLimit(db: Db, bucket: string, limit: number, windowSeconds: number, message?: string) {
  const row = await db.one<{ hits: number }>(
    `INSERT INTO auth_rate_limits(bucket, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = auth_rate_limits.hits + 1
     RETURNING hits`, [bucket, windowSeconds]);
  if (row.hits > limit) throw rateLimited(message);
}

/**
 * Whether `next` leads to a way into a workspace that is open to this address (owner request, 11 October 2026: the
 * first-run welcome, D9): an invitation that is still pending and was sent to `email`, or a join code that is enabled.
 * While Boredroom is in waitlist mode these people may still create an account, by email or with Google; everyone else
 * meets the waitlist. The orgs service is imported when needed (it is not imported at load, so there is no cycle).
 */
export async function joiningAllowed(next: string | null | undefined, email: string): Promise<boolean> {
  const target = joiningTarget(safeNextPath(next, ""));
  if (!target) return false;
  const { previewInvitation, previewJoinCode } = await import("@/server/services/orgs");
  if (target.kind === "invite") {
    const inv = await previewInvitation(target.token);
    return !!inv && inv.state === "pending" && inv.email.trim().toLowerCase() === email.trim().toLowerCase();
  }
  const code = await previewJoinCode(target.code);
  return !!code?.enabled;
}

const REGISTRATION_CLOSED = "Boredroom is not open for new accounts yet. Join the waitlist and we will email you when it is.";

/**
 * A new account. `next` (owner request, 11 October 2026: the first-run welcome) is where the person was going: while
 * registration is closed it lets in someone joining by a pending invitation to this address or an enabled join code
 * (D9), and the verification link carries it, so confirming on another device still leads into the workspace.
 */
export async function signUp(input: { email: string; password: string; displayName: string; ip?: string; next?: string | null }) {
  const email = input.email.trim().toLowerCase();
  if (!(await registrationOpen()) && !(await joiningAllowed(input.next, email))) throw new AppError(403, "REGISTRATION_CLOSED", REGISTRATION_CLOSED);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Enter a valid email address.", { email: ["Enter a valid email address."] });
  if (input.password.length < 10) throw invalid("Password must be at least 10 characters.", { password: ["Use at least 10 characters."] });
  if (!input.displayName.trim()) throw invalid("Name is required.", { displayName: ["Name is required."] });
  const passwordHash = await hashPassword(input.password);
  return withSystem(async (db) => {
    await rateLimit(db, `signup:${input.ip ?? "unknown"}`, 20, 3600);
    let authUser: { id: string };
    try {
      authUser = await db.one(`INSERT INTO auth_users(email, password_hash) VALUES ($1, $2) RETURNING id`, [email, passwordHash]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in or recover your password.");
      throw err;
    }
    const profile = await db.one<{ id: string }>(
      `INSERT INTO profiles(auth_user_id, display_name, email) VALUES ($1, $2, $3) RETURNING id`,
      [authUser.id, input.displayName.trim(), email]);
    await issueToken(db, authUser.id, email, "verify_email", input.next);
    await contactRegistered(db, authUser.id, email, input.displayName).catch(() => undefined);
    return { authUserId: authUser.id, profileId: profile.id };
  });
}

/**
 * A single-use link by email. A verification link carries `next` when it is a safe path on this site (owner request,
 * 11 October 2026: the first-run welcome), so the verify page can offer to join the workspace in the same press;
 * anything else is left out. Recovery links never carry it.
 */
async function issueToken(db: Db, authUserId: string, email: string, kind: keyof typeof TOKEN_TTL_MIN, next?: string | null) {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [authUserId, kind, sha256(token), String(TOKEN_TTL_MIN[kind])]);
  const path = kind === "verify_email" ? "/verify" : "/recover/reset";
  const goTo = kind === "verify_email" ? safeNextPath(next, "") : "";
  const url = `${appOrigin()}${path}?token=${token}${goTo ? `&next=${encodeURIComponent(goTo)}` : ""}`;
  const body = kind === "verify_email" ? verifyEmailMail(url) : resetPasswordMail(url);
  await mail().send({ to: email, category: kind, subject: kind === "verify_email" ? "Confirm your Boredroom email" : "Choose a new Boredroom password", ...body });
  return token;
}

/** A new verification link; `next` travels in it as in signUp (owner request, 11 October 2026: the first-run welcome). */
export async function resendVerification(email: string, next?: string | null) {
  return withSystem(async (db) => {
    await rateLimit(db, `verify:${email.toLowerCase()}`, 5, 3600);
    const u = await db.maybeOne<{ id: string; email_verified_at: string | null }>(`SELECT id, email_verified_at FROM auth_users WHERE email = $1`, [email]);
    if (u && !u.email_verified_at) await issueToken(db, u.id, email, "verify_email", next);
  });
}

/**
 * Confirms the email behind a verification link. `already` (owner request, 11 October 2026: the first-run welcome): the
 * link was used before or has expired, but its account is confirmed anyway (a mail scanner, a second press, a second
 * device), so the verify page can still go on, and join, instead of saying the link is broken. A link nobody knows, or
 * one whose account is still unconfirmed, is refused as before (410).
 */
export async function verifyEmail(token: string): Promise<{ userId: string; already: boolean }> {
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)]);
    if (row) {
      await db.query(`UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [row.user_id]);
      return { userId: row.user_id, already: false };
    }
    const known = await db.maybeOne<{ user_id: string }>(
      `SELECT t.user_id FROM auth_tokens t JOIN auth_users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.kind = 'verify_email' AND u.email_verified_at IS NOT NULL`, [sha256(token)]);
    if (known) return { userId: known.user_id, already: true };
    throw new AppError(410, "TOKEN_INVALID", "This verification link is invalid or has expired.");
  });
}

/**
 * What a verification link is, without using it (owner request, 11 October 2026: the first-run welcome): whose it is,
 * whether that account is confirmed, and whether the link itself is still unused and in date. Null for a link nobody
 * knows. Read only: opening the page never confirms anything (mail scanners open links); the press does.
 */
export async function peekVerifyToken(token: string): Promise<{ authUserId: string; verified: boolean; usable: boolean } | null> {
  if (!token) return null;
  const row = await withSystem((db) => db.maybeOne<{ user_id: string; verified: boolean; usable: boolean }>(
    `SELECT t.user_id, (u.email_verified_at IS NOT NULL) AS verified, (t.used_at IS NULL AND t.expires_at > now()) AS usable
       FROM auth_tokens t JOIN auth_users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.kind = 'verify_email'`, [sha256(token)]));
  return row ? { authUserId: row.user_id, verified: row.verified, usable: row.usable } : null;
}

export async function requestPasswordRecovery(email: string, ip?: string) {
  const normalised = email.trim().toLowerCase();
  return withSystem(async (db) => {
    await rateLimit(db, `recover:${ip ?? "unknown"}`, 10, 3600);
    const u = await db.maybeOne<{ id: string }>(`SELECT id FROM auth_users WHERE email = $1`, [normalised]);
    if (u) await issueToken(db, u.id, normalised, "recover_password");
    // Always succeed to avoid account enumeration.
  });
}

export async function resetPassword(token: string, newPassword: string) {
  if (newPassword.length < 10) throw invalid("Password must be at least 10 characters.", { password: ["Use at least 10 characters."] });
  const hash = await hashPassword(newPassword);
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'recover_password' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)]);
    if (!row) throw new AppError(410, "TOKEN_INVALID", "This recovery link is invalid or has expired.");
    await db.query(`UPDATE auth_users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2`, [hash, row.user_id]);
    await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id) VALUES ($1, 'auth.password_reset', 'auth_user', $1)`, [row.user_id]);
  });
}

export async function signIn(input: { email: string; password: string; ip?: string; userAgent?: string }) {
  const email = input.email.trim().toLowerCase();
  return withSystem(async (db) => {
    await rateLimit(db, `login:${input.ip ?? "unknown"}`, 30, 900);
    await rateLimit(db, `login:${email}`, 10, 900);
    const u = await db.maybeOne<{ id: string; password_hash: string | null; email_verified_at: string | null }>(
      `SELECT id, password_hash, email_verified_at FROM auth_users WHERE email = $1`, [email]);
    // An account made with Google has no password; say so rather than "incorrect".
    const st = u ? await db.maybeOne<{ status: string; status_reason: string | null }>(`SELECT status, status_reason FROM auth_users WHERE id = $1`, [u.id]) : null;
    if (st && st.status !== "active") throw new AppError(403, "ACCOUNT_" + st.status.toUpperCase(), st.status === "banned" ? "This account has been closed." : st.status === "deleted" ? "This account no longer exists." : `This account is suspended${st.status_reason ? `: ${st.status_reason}` : ""}. Contact support if you think this is a mistake.`);
    if (u && !u.password_hash) throw new AppError(401, "NO_PASSWORD", "This account signs in with Google. Use the Google button, or set a password with “Forgot your password?”.");
    const ok = u ? await verifyPassword(input.password, u.password_hash!) : await verifyPassword(input.password, "scrypt$AAAA$AAAA");
    if (!u || !ok) throw new AppError(401, "BAD_CREDENTIALS", "Email or password is incorrect.");
    const token = await issueSession(db, u.id, { ip: input.ip, userAgent: input.userAgent, method: "password" });
    return { token, emailVerified: !!u.email_verified_at };
  });
}

/** A new session for a user who has just proved who they are, by password or by Google. */
export async function issueSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string; method: "password" | "google" }) {
  const token = randomToken(32);
  const session = await db.one<{ id: string }>(
    `INSERT INTO auth_sessions(user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4) RETURNING id`,
    [userId, sha256(token), String(SESSION_TTL_DAYS), meta.userAgent?.slice(0, 300) ?? null]);
  await db.query(`UPDATE auth_users SET last_login_at = now() WHERE id = $1`, [userId]);
  await db.query(`UPDATE platform_admins SET last_login_at = now() WHERE auth_user_id = $1`, [userId]);
  await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'auth.sign_in', 'auth_session', $2, $3)`,
    [userId, session.id, JSON.stringify({ ip: meta.ip ?? null, method: meta.method })]);
  return token;
}

export async function signOut(token: string | undefined) {
  if (!token) return;
  await withSystem((db) => db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]));
}

/** The session's columns (`SessionRow`), as CTEs `s`, `touched` and `u` over `$1` = sha256(token), for one statement. */
export const SESSION_CTES = `s AS (
       SELECT s.id, s.user_id, s.impersonation_id FROM auth_sessions s WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
     ), touched AS (
       UPDATE auth_sessions a SET last_seen_at = now() FROM s WHERE a.id = s.id AND a.last_seen_at < now() - interval '5 minutes'
     ), u AS (
       SELECT s.id AS session_id, u.id AS auth_user_id, p.id AS profile_id, u.email, p.display_name, u.email_verified_at, p.avatar_key, p.title, p.status_text, p.presence,
              i.id AS impersonation_id, au.email AS admin_email
       FROM s JOIN auth_users u ON u.id = s.user_id JOIN profiles p ON p.auth_user_id = u.id
       LEFT JOIN admin_impersonations i ON i.id = s.impersonation_id AND i.ended_at IS NULL LEFT JOIN auth_users au ON au.id = i.admin_user_id
       WHERE u.status = 'active'
     )`;
export type SessionRow = { session_id: string; auth_user_id: string; profile_id: string; email: string; display_name: string; email_verified_at: string | null; avatar_key: string | null; title: string | null; status_text: string | null; presence: Presence; impersonation_id: string | null; admin_email: string | null };

export function currentUserOf(row: SessionRow): CurrentUser {
  return {
    profileId: row.profile_id, authUserId: row.auth_user_id, email: row.email, displayName: row.display_name,
    emailVerified: !!row.email_verified_at, sessionId: row.session_id,
    avatarKey: row.avatar_key, title: row.title, statusText: row.status_text, presence: row.presence,
    impersonation: row.impersonation_id ? { id: row.impersonation_id, adminEmail: row.admin_email ?? "an administrator" } : null,
  };
}

/** The session row for a token, inside a caller-provided system transaction. Touches last_seen_at at most every five minutes, in the same statement, to save a round trip. */
export async function userFromSessionTokenIn(db: Db, token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  const row = await db.maybeOne<SessionRow>(`WITH ${SESSION_CTES} SELECT * FROM u`, [sha256(token)]);
  return row ? currentUserOf(row) : null;
}

/**
 * The request's session token: the cookie, else an `Authorization: Bearer` token (the Brenda desktop app holds a desktop
 * session token this way, owner decision, 3 October 2026). Browsers never attach that header on their own, so it does
 * not widen what a page can do. A cookie, valid or not, is never passed over for the header.
 */
export async function requestSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value || (await bearerToken());
}

/** The current user from the request cookie (or the desktop app's bearer token), inside a caller-provided system transaction. */
export async function currentUserIn(db: Db): Promise<CurrentUser | null> {
  return userFromSessionTokenIn(db, await requestSessionToken());
}

async function bearerToken(): Promise<string | undefined> {
  const h = (await headers()).get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(h.trim());
  return m?.[1];
}

/**
 * Rate limits outside this module: unauthenticated endpoints (the desktop link) and bursts of requests to the person's
 * assistant (`ai.burst:<membership>`, server/services/ai-usage). `message` is what the 429 says; the default is unchanged
 * (owner decision, 8 October 2026: personal assistants, phase 3).
 */
export async function rateLimitIn(db: Db, bucket: string, limit: number, windowSeconds: number, message?: string) { return rateLimit(db, bucket, limit, windowSeconds, message); }

export async function userFromSessionToken(token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  return withSystem((db) => userFromSessionTokenIn(db, token));
}

export async function sessionCookieOptions() {
  return {
    httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  };
}

/** Deduplicated per request: layouts, pages and helpers that all ask for the user share one lookup. */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value ?? (await bearerToken()));
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw unauthenticated();
  return u;
}

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local", userAgent: h.get("user-agent") ?? undefined };
}
