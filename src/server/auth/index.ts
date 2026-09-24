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

async function rateLimit(db: Db, bucket: string, limit: number, windowSeconds: number) {
  const row = await db.one<{ hits: number }>(
    `INSERT INTO auth_rate_limits(bucket, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = auth_rate_limits.hits + 1
     RETURNING hits`, [bucket, windowSeconds]);
  if (row.hits > limit) throw rateLimited();
}

export async function signUp(input: { email: string; password: string; displayName: string; ip?: string }) {
  if (!(await registrationOpen())) throw new AppError(403, "REGISTRATION_CLOSED", "Boredroom is not open for new accounts yet. Join the waitlist and we will email you when it is.");
  const email = input.email.trim().toLowerCase();
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
    await issueToken(db, authUser.id, email, "verify_email");
    await contactRegistered(db, authUser.id, email, input.displayName).catch(() => undefined);
    return { authUserId: authUser.id, profileId: profile.id };
  });
}

async function issueToken(db: Db, authUserId: string, email: string, kind: keyof typeof TOKEN_TTL_MIN) {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [authUserId, kind, sha256(token), String(TOKEN_TTL_MIN[kind])]);
  const path = kind === "verify_email" ? "/verify" : "/recover/reset";
  const url = `${appOrigin()}${path}?token=${token}`;
  const body = kind === "verify_email" ? verifyEmailMail(url) : resetPasswordMail(url);
  await mail().send({ to: email, category: kind, subject: kind === "verify_email" ? "Confirm your Boredroom email" : "Choose a new Boredroom password", ...body });
  return token;
}

export async function resendVerification(email: string) {
  return withSystem(async (db) => {
    await rateLimit(db, `verify:${email.toLowerCase()}`, 5, 3600);
    const u = await db.maybeOne<{ id: string; email_verified_at: string | null }>(`SELECT id, email_verified_at FROM auth_users WHERE email = $1`, [email]);
    if (u && !u.email_verified_at) await issueToken(db, u.id, email, "verify_email");
  });
}

export async function verifyEmail(token: string) {
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)]);
    if (!row) throw new AppError(410, "TOKEN_INVALID", "This verification link is invalid or has expired.");
    await db.query(`UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [row.user_id]);
    return row.user_id;
  });
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

/** The session row for a token, inside a caller-provided system transaction. Touches last_seen_at at most every five minutes, in the same statement, to save a round trip. */
export async function userFromSessionTokenIn(db: Db, token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  const row = await db.maybeOne<{ session_id: string; auth_user_id: string; profile_id: string; email: string; display_name: string; email_verified_at: string | null; avatar_key: string | null; title: string | null; status_text: string | null; presence: Presence; impersonation_id: string | null; admin_email: string | null }>(
    `WITH s AS (
       SELECT s.id, s.user_id, s.impersonation_id FROM auth_sessions s WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
     ), touched AS (
       UPDATE auth_sessions a SET last_seen_at = now() FROM s WHERE a.id = s.id AND a.last_seen_at < now() - interval '5 minutes'
     )
     SELECT s.id AS session_id, u.id AS auth_user_id, p.id AS profile_id, u.email, p.display_name, u.email_verified_at, p.avatar_key, p.title, p.status_text, p.presence,
            i.id AS impersonation_id, au.email AS admin_email
     FROM s JOIN auth_users u ON u.id = s.user_id JOIN profiles p ON p.auth_user_id = u.id
     LEFT JOIN admin_impersonations i ON i.id = s.impersonation_id AND i.ended_at IS NULL LEFT JOIN auth_users au ON au.id = i.admin_user_id
     WHERE u.status = 'active'`, [sha256(token)]);
  if (!row) return null;
  return {
    profileId: row.profile_id, authUserId: row.auth_user_id, email: row.email, displayName: row.display_name,
    emailVerified: !!row.email_verified_at, sessionId: row.session_id,
    avatarKey: row.avatar_key, title: row.title, statusText: row.status_text, presence: row.presence,
    impersonation: row.impersonation_id ? { id: row.impersonation_id, adminEmail: row.admin_email ?? "an administrator" } : null,
  };
}

/** The current user from the request cookie, inside a caller-provided system transaction. */
export async function currentUserIn(db: Db): Promise<CurrentUser | null> {
  const jar = await cookies();
  return userFromSessionTokenIn(db, jar.get(SESSION_COOKIE)?.value);
}

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
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
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
