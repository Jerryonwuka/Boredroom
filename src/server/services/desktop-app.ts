/**
 * Boredroom for Mac: one sign-in for its dashboard window and Brenda in its notch (owner request, 24 October 2026:
 * option A; spec §6, §7.1). Server-only.
 *
 * The app's identity is the desktop session its Rust side holds (kind 'desktop', 90 days, a Bearer token, as the device
 * code makes it). The window's web session is an ordinary 'web' session tied to it (`auth_sessions.desktop_session_id`),
 * so desktop-only routes keep refusing it and one ringer keeps treating it as a browser; revoking either revokes both.
 *
 * Three single-use, short-lived secrets, each stored only as its sha256 and claimed by one
 * `UPDATE … WHERE unused AND unexpired AND origin = APP_ORIGIN RETURNING` (single use under concurrency):
 * - the PKCE sign-in (S256): the app starts a request with its challenge; the window or the browser signs in normally;
 *   approving mints a 120-second code bound to the request, which only the app holding the verifier can redeem (a wrong
 *   verifier burns it). The code travels only inside `boredroom://auth?…`, never to a server in a URL;
 * - the handoff: a linked app mints a 60-second code with its Bearer and hands it to its own window by script (never in
 *   a URL); the window's page posts it to a strict same-origin route that sets the normal session cookie;
 * - the browser bridge: a window session asks for a 5-minute ticket that carries a connector consent to the person's
 *   default browser (Google and most providers refuse embedded web views). It never signs a browser in: the browser
 *   must already be signed in as that person (security review, 24 October 2026: SEC-1).
 * Every route here is gated on migration 0064 (server/lib/schema-0064): without it they answer 503
 * DESKTOP_APP_NOT_READY, and the app signs its window in on its own and links the notch with a code, as before.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withSystem, withUser, type Db } from "@/server/db";
import {
  assertFailuresBelow, issueSessionRow, rateLimitCommitted, recordFailure, revokeDesktopFamily, try0064In,
  type DesktopBearer,
} from "@/server/auth";
import { keyedDigest, randomToken, sha256, signPayload, verifyPayload } from "@/server/lib/crypto";
import { AppError, conflict, forbidden, invalid, notFound, unauthenticated } from "@/server/lib/errors";
import { desktopAppNotReady, noteMissing0064, schema0064Missing, with0064 } from "@/server/lib/schema-0064";
import { safeNextPath } from "@/components/auth/next-path";
import type { OrgContext } from "@/server/lib/api";
import { PROVIDER_LABELS, PROVIDER_IDS } from "@/lib/connectors/types";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { adapterFor } from "@/server/connectors/registry";
import { toPublicError } from "@/server/connectors/errors";
import { impersonating, isManager, policyFor } from "@/server/connectors/connections";

// ---- Names and lifetimes (the shared contract, spec §11.5) -------------------------------------------------------------

export const DESKTOP_AUTH_COOKIE = "boredroom_desktop_auth";
export const FROM_DESKTOP_COOKIE = "boredroom_from_desktop";
export const REQUEST_TTL_SECONDS = 30 * 60;
export const START_TTL_SECONDS = 10 * 60;
export const AUTH_CODE_TTL_SECONDS = 120;
export const HANDOFF_TTL_SECONDS = 60;
export const TICKET_TTL_SECONDS = 5 * 60;
export const DESKTOP_SESSION_DAYS = 90;
export const DEFAULT_DEVICE_NAME = "Boredroom for Mac";

const appOrigin = () => process.env.APP_ORIGIN ?? "http://localhost:3000";
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** The person's digest the app keeps to notice that its window belongs to someone else: 16 hex characters. */
export function userDigest(authUserId: string): string {
  return keyedDigest(`desktop-user:${authUserId}`).slice(0, 16);
}

/** base64url(SHA-256(verifier)), the S256 challenge (RFC 7636). */
export function pkceChallengeOf(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The request cookie's value: a signed `{ p: "desktop-auth", r }` for 30 minutes (`p` keeps it apart from other signed payloads). */
export function requestCookieValue(requestId: string): string {
  return signPayload({ p: "desktop-auth", r: requestId }, REQUEST_TTL_SECONDS);
}

/** The request id in a request cookie, or null (forged, expired, or another purpose's payload). */
export function readRequestCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  const p = verifyPayload<{ p?: unknown; r?: unknown }>(value);
  if (!p || p.p !== "desktop-auth" || typeof p.r !== "string" || !z.string().uuid().safeParse(p.r).success) return null;
  return p.r;
}

export function desktopAuthCookieOptions(maxAge = REQUEST_TTL_SECONDS) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

/** `boredroom_from_desktop=1`: the browser came from Boredroom for Mac (the connected Alert offers the way back). 15 minutes. */
export function fromDesktopCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 15 * 60 };
}

// ---- Desktop sessions -------------------------------------------------------------------------------------------------

/**
 * A new desktop session (kind 'desktop', 90 days), the same row the device code and the PKCE sign-in make
 * (`pollLink` and `redeemAuthCode` both call this, so both make identical rows).
 */
export async function insertDesktopSession(db: Db, o: { userId: string; userAgent?: string | null; deviceName?: string | null }): Promise<{ id: string; token: string }> {
  const token = randomToken(32);
  const session = await db.one<{ id: string }>(
    `INSERT INTO auth_sessions(user_id, token_hash, expires_at, user_agent, kind, device_name) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, 'desktop', $5) RETURNING id`,
    [o.userId, sha256(token), String(DESKTOP_SESSION_DAYS), o.userAgent?.slice(0, 300) || DEFAULT_DEVICE_NAME, o.deviceName || DEFAULT_DEVICE_NAME]);
  return { id: session.id, token };
}

type SessionInfo = {
  id: string; user_id: string; kind: string; created_at: string; impersonated: boolean; verified: boolean;
  email: string; profile_id: string; display_name: string;
};

/** A live session for a token, with what the sign-in checks need. */
async function sessionInfoIn(db: Db, token: string): Promise<SessionInfo | null> {
  return db.maybeOne<SessionInfo>(
    `SELECT s.id, s.user_id, s.kind, s.created_at, (s.impersonation_id IS NOT NULL) AS impersonated, (u.email_verified_at IS NOT NULL) AS verified,
            u.email::text AS email, p.id AS profile_id, p.display_name
       FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id JOIN profiles p ON p.auth_user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [sha256(token)]);
}

export type Workspace = { id: string; slug: string; name: string };
async function workspacesIn(db: Db, profileId: string): Promise<Workspace[]> {
  return db.query<Workspace>(
    `SELECT o.id, o.slug, o.name FROM memberships m JOIN organisations o ON o.id = m.organisation_id
      WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active' ORDER BY o.name, o.slug`, [profileId]);
}

// ---- The PKCE sign-in ---------------------------------------------------------------------------------------------------

export const authStartSchema = z.object({
  challenge: z.string().regex(SECRET, "Use an S256 challenge (43 base64url characters)."),
  state: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, "Use 22 to 64 base64url characters."),
  via: z.enum(["window", "browser"]),
  intent: z.literal("google").optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

/**
 * POST /api/desktop/app/auth/start (no sign-in): a new request; its start link is single use within 10 minutes.
 * `replacingSessionId`: the desktop session the app holds now, when it sent its Bearer (security review, 24 October
 * 2026: SEC-3), so the finish page can name who this sign-in signs out of the notch and asks before it does.
 */
export async function startAuthRequest(input: z.infer<typeof authStartSchema>, meta: { ip: string; replacingSessionId?: string | null }) {
  if (schema0064Missing()) throw desktopAppNotReady();
  await rateLimitCommitted(`desktop.app.start:${meta.ip}`, 30, 3600);
  const start = randomToken(32);
  await with0064(() => withSystem(async (db) => {
    await db.query(`DELETE FROM desktop_auth_requests WHERE expires_at < now() - interval '1 day'`);
    await db.query(
      `INSERT INTO desktop_auth_requests(start_hash, state, challenge, via, intent, device_name, origin, expires_at, replacing_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8), $9)`,
      [sha256(start), input.state, input.challenge, input.via, input.intent ?? null, input.deviceName ?? null, appOrigin(), REQUEST_TTL_SECONDS, meta.replacingSessionId ?? null]);
  }));
  return { startUrl: `${appOrigin()}/desktop/app/start?t=${start}`, expiresIn: REQUEST_TTL_SECONDS };
}

/**
 * GET /desktop/app/start: claims the start link once (`bound_at`), within 10 minutes of the request, for the first
 * browser or window that opens it (the route sets the request cookie there). Null when unknown, used or expired.
 */
export async function bindStart(t: string | null): Promise<{ requestId: string; intent: "google" | null; via: "window" | "browser" } | null> {
  if (!t || !SECRET.test(t)) return null;
  return with0064(() => withSystem((db) => db.maybeOne<{ requestId: string; intent: "google" | null; via: "window" | "browser" }>(
    `UPDATE desktop_auth_requests SET bound_at = now()
      WHERE start_hash = $1 AND bound_at IS NULL AND approved_at IS NULL AND created_at > now() - make_interval(secs => $3)
        AND expires_at > now() AND origin = $2
      RETURNING id AS "requestId", intent, via`, [sha256(t), appOrigin(), START_TTL_SECONDS])));
}

export type FinishView =
  | { state: "expired" }
  | {
    state: "ready"; via: "window" | "browser"; fresh: boolean; impersonated: boolean; verified: boolean;
    workspaces: { slug: string; name: string; assistant: string }[];
    /** Who the notch is signed in as now, when that is someone else (the app sent its Bearer with the request). */
    replacing: { displayName: string; email: string } | null;
    /** The notch is signed in as this same person already (relinking changes nobody). */
    sameAsNotch: boolean;
  };

/**
 * What /desktop/app/finish shows for this session and request cookie. `fresh`: the session was made after the request
 * was bound (the person has just signed in in this flow), the one case where the page may continue without a press
 * (security review, 24 October 2026: SEC-3, also in the app's window). `replacing` and `sameAsNotch` come from the
 * desktop session the app held when it started the request.
 */
export async function finishView(sessionToken: string | undefined, cookie: string | null | undefined): Promise<FinishView> {
  const requestId = readRequestCookie(cookie);
  if (!sessionToken || !requestId || schema0064Missing()) return { state: "expired" };
  try {
    return await withSystem(async (db) => {
      const req = await db.maybeOne<{ via: "window" | "browser"; bound_at: string; replacing_user_id: string | null; replacing_name: string | null; replacing_email: string | null }>(
        `SELECT r.via, r.bound_at, rs.user_id AS replacing_user_id, rp.display_name AS replacing_name, ru.email::text AS replacing_email
           FROM desktop_auth_requests r
           LEFT JOIN auth_sessions rs ON rs.id = r.replacing_session_id AND rs.kind = 'desktop' AND rs.revoked_at IS NULL AND rs.expires_at > now()
           LEFT JOIN auth_users ru ON ru.id = rs.user_id LEFT JOIN profiles rp ON rp.auth_user_id = ru.id
          WHERE r.id = $1 AND r.bound_at IS NOT NULL AND r.approved_at IS NULL AND r.expires_at > now() AND r.origin = $2`,
        [requestId, appOrigin()]);
      const s = await sessionInfoIn(db, sessionToken);
      if (!req || !s) return { state: "expired" } as const;
      // Each workspace with the person's own assistant's name there (Brenda by default), for "Signing in {name} in your notch".
      const workspaces = await db.query<{ slug: string; name: string; assistant: string }>(
        `SELECT o.slug, o.name, COALESCE(NULLIF(btrim(ap.name), ''), 'Brenda') AS assistant
           FROM memberships m JOIN organisations o ON o.id = m.organisation_id LEFT JOIN assistant_profiles ap ON ap.membership_id = m.id
          WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active' ORDER BY o.name, o.slug`, [s.profile_id]);
      const sameAsNotch = req.replacing_user_id === s.user_id;
      return {
        state: "ready", via: req.via, fresh: new Date(s.created_at).getTime() >= new Date(req.bound_at).getTime(),
        impersonated: s.impersonated, verified: s.verified, workspaces, sameAsNotch,
        replacing: req.replacing_user_id && !sameAsNotch ? { displayName: req.replacing_name ?? "", email: req.replacing_email ?? "" } : null,
      } as const;
    });
  } catch (err) {
    if (noteMissing0064(err)) return { state: "expired" };
    throw err;
  }
}

export const approveSchema = z.object({ orgSlug: z.string().trim().min(1).max(80).optional() });

/**
 * POST /api/desktop/app/auth/approve, by the signed-in person, with the request cookie (the route has checked the
 * origin strictly). In order: a cookie session of kind 'web' (a Bearer may not approve), not impersonated, the email
 * confirmed, the request bound, unexpired, unapproved and ours, then the workspace (the one named, else the only one).
 * Mints the code and answers the `boredroom://auth` link the page then opens.
 */
export async function approveRequest(o: { sessionToken: string | undefined; requestCookie: string | null | undefined; orgSlug?: string }) {
  if (!o.sessionToken) throw unauthenticated();
  const requestId = readRequestCookie(o.requestCookie);
  return with0064(() => withSystem(async (db) => {
    const s = await sessionInfoIn(db, o.sessionToken!);
    if (!s || s.kind !== "web") throw unauthenticated();
    if (s.impersonated) throw new AppError(403, "IMPERSONATED", "Only the person can sign in Boredroom for Mac. It can't be done while you are signed in as them.");
    if (!s.verified) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address first, then try again.");
    if (!requestId) throw requestExpired();
    const req = await db.maybeOne<{ id: string; state: string; via: "window" | "browser"; device_name: string | null }>(
      `SELECT id, state, via, device_name FROM desktop_auth_requests
        WHERE id = $1 AND bound_at IS NOT NULL AND approved_at IS NULL AND expires_at > now() AND origin = $2 FOR UPDATE`, [requestId, appOrigin()]);
    if (!req) throw requestExpired();
    const all = await workspacesIn(db, s.profile_id);
    let org: Workspace | undefined;
    if (o.orgSlug) {
      org = all.find((w) => w.slug === o.orgSlug);
      if (!org) throw notFound("You are not an active member of that workspace.");
    } else if (all.length === 1) org = all[0];
    else if (!all.length) throw conflict("NO_WORKSPACE", "Set up your workspace first, then try again.");
    else throw conflict("CHOOSE_WORKSPACE", "Choose the workspace to use on this Mac.", { workspaces: all.map((w) => ({ slug: w.slug, name: w.name })) });
    const code = randomToken(32);
    await db.query(
      `UPDATE desktop_auth_requests SET approved_at = now(), approved_user_id = $2, organisation_id = $3, web_session_id = $4,
              code_hash = $5, code_expires_at = now() + make_interval(secs => $6)
        WHERE id = $1`, [req.id, s.user_id, org.id, req.via === "window" ? s.id : null, sha256(code), AUTH_CODE_TTL_SECONDS]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'auth.desktop_app_approved', 'desktop_auth_request', $2, $3)`,
      [s.user_id, req.id, JSON.stringify({ organisationId: org.id, via: req.via, deviceName: req.device_name })]);
    return { redirect: `boredroom://auth?code=${code}&state=${req.state}`, via: req.via };
  }));
}

const requestExpired = () => new AppError(410, "REQUEST_EXPIRED", "This sign-in has expired. Go back to Boredroom and try again.");
const codeInvalid = () => new AppError(400, "CODE_INVALID", "That sign-in code is not valid. Start again from Boredroom.");

export const tokenSchema = z.object({
  code: z.string().regex(SECRET, "Not a code."),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, "Not a verifier."),
});

/**
 * POST /api/desktop/app/auth/token, from the app (no sign-in): the code and its verifier for the desktop session. The
 * claim commits first, so a wrong verifier burns the code (no guessing); one answer for unknown, used, expired or a
 * wrong verifier (400 CODE_INVALID), and failures from one address are counted (20 an hour, then 429).
 */
export async function redeemAuthCode(input: z.infer<typeof tokenSchema>, meta: { ip: string; userAgent?: string }) {
  if (schema0064Missing()) throw desktopAppNotReady();
  const failBucket = `desktop.app.token.fail:${meta.ip}`;
  await assertFailuresBelow(failBucket, 20, 3600, "Too many sign-in attempts. Try again in an hour.");
  type Claimed = { id: string; challenge: string; via: "window" | "browser"; approved_user_id: string; organisation_id: string; web_session_id: string | null; device_name: string | null };
  const row = await with0064(() => withSystem((db) => db.maybeOne<Claimed>(
    `UPDATE desktop_auth_requests SET redeemed_at = now()
      WHERE code_hash = $1 AND redeemed_at IS NULL AND code_expires_at > now() AND origin = $2
      RETURNING id, challenge, via, approved_user_id, organisation_id, web_session_id, device_name`, [sha256(input.code), appOrigin()])));
  if (!row || !sameSecret(pkceChallengeOf(input.verifier), row.challenge)) {
    await recordFailure(failBucket, 3600);
    throw codeInvalid();
  }
  return withSystem(async (db) => {
    const who = await db.maybeOne<{ slug: string; name: string; display_name: string }>(
      `SELECT o.slug, o.name, p.display_name FROM auth_users u JOIN profiles p ON p.auth_user_id = u.id
         JOIN memberships m ON m.user_id = p.id JOIN organisations o ON o.id = m.organisation_id
        WHERE u.id = $1 AND u.status = 'active' AND o.id = $2 AND m.status = 'active' AND o.status = 'active'`, [row.approved_user_id, row.organisation_id]);
    if (!who) throw forbidden("You are no longer an active member of that workspace.");
    const session = await insertDesktopSession(db, { userId: row.approved_user_id, userAgent: meta.userAgent, deviceName: row.device_name });
    if (row.via === "window" && row.web_session_id) {
      // The window's own session now belongs to this Mac: signing out of either signs out of both.
      await db.query(`UPDATE auth_sessions SET desktop_session_id = $1 WHERE id = $2 AND user_id = $3 AND kind = 'web' AND revoked_at IS NULL`,
        [session.id, row.web_session_id, row.approved_user_id]);
    }
    await db.query(`UPDATE desktop_auth_requests SET desktop_session_id = $2 WHERE id = $1`, [row.id, session.id]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id, metadata) VALUES ($1, 'auth.sign_in', 'auth_session', $2, $3)`,
      [row.approved_user_id, session.id, JSON.stringify({ ip: meta.ip, method: "desktop_app", via: row.via, deviceName: row.device_name })]);
    return {
      status: "approved" as const, token: session.token, workspace: { slug: who.slug, name: who.name }, displayName: who.display_name,
      userDigest: userDigest(row.approved_user_id),
    };
  });
}

// ---- The handoff (a linked app signs its own window in) ----------------------------------------------------------------

export const handoffSchema = z.object({ next: z.string().max(2000).optional() });

/** POST /api/desktop/app/handoff, Bearer of a desktop session only: a 60-second single-use code for its window. */
export async function mintHandoff(bearer: DesktopBearer, input: z.infer<typeof handoffSchema>) {
  if (schema0064Missing()) throw desktopAppNotReady();
  await rateLimitCommitted(`desktop.handoff:${bearer.sessionId}`, 60, 3600);
  let next = safeNextPath(input.next, "/app");
  if (next.length > 300) next = "/app";
  const code = randomToken(32);
  await with0064(() => withSystem(async (db) => {
    await db.query(`DELETE FROM desktop_handoff_codes WHERE expires_at < now() - interval '1 day'`);
    await db.query(
      `INSERT INTO desktop_handoff_codes(code_hash, desktop_session_id, user_id, origin, next, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [sha256(code), bearer.sessionId, bearer.authUserId, appOrigin(), next, HANDOFF_TTL_SECONDS]);
  }));
  return { code, expiresIn: HANDOFF_TTL_SECONDS, userDigest: userDigest(bearer.authUserId) };
}

export const redeemSchema = z.object({ code: z.string().max(100) });

/**
 * POST /api/desktop/app/handoff/redeem (the route has checked the origin strictly): the code for a window session tied
 * to the desktop session, never living past it. Single use (the claim commits even when the desktop session has gone);
 * failures from one address are counted (30 an hour, then 429).
 */
export async function redeemHandoff(input: z.infer<typeof redeemSchema>, meta: { ip: string; userAgent?: string }) {
  if (schema0064Missing()) throw desktopAppNotReady();
  const failBucket = `desktop.handoff.fail:${meta.ip}`;
  await assertFailuresBelow(failBucket, 30, 3600, "Too many sign-in attempts. Try again in an hour.");
  const out = SECRET.test(input.code) ? await with0064(() => withSystem(async (db) => {
    const row = await db.maybeOne<{ id: string; desktop_session_id: string; user_id: string; next: string }>(
      `UPDATE desktop_handoff_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() AND origin = $2
       RETURNING id, desktop_session_id, user_id, next`, [sha256(input.code), appOrigin()]);
    if (!row) return null;
    const desktop = await db.maybeOne<{ expires_at: string }>(
      `SELECT s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.kind = 'desktop' AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
      [row.desktop_session_id, row.user_id]);
    if (!desktop) return null; // the claim still commits: the code is spent
    const session = await issueSessionRow(db, row.user_id, {
      method: "desktop_handoff", desktopSessionId: row.desktop_session_id, expiresAt: desktop.expires_at, ip: meta.ip, userAgent: meta.userAgent,
    });
    await db.query(`UPDATE desktop_handoff_codes SET web_session_id = $2 WHERE id = $1`, [row.id, session.id]);
    return { token: session.token, expiresAt: session.expiresAt, next: safeNextPath(row.next, "/app") };
  })) : null;
  if (!out) {
    await recordFailure(failBucket, 3600);
    throw codeInvalid();
  }
  return out;
}

/** POST /api/desktop/app/sign-out, Bearer of a desktop session: it and its window sessions are revoked. */
export async function desktopSignOut(bearer: DesktopBearer) {
  await withSystem(async (db) => {
    const done = await try0064In(db, async () => { await revokeDesktopFamily(db, bearer.sessionId); });
    if (!done) await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [bearer.sessionId]);
    await db.query(`INSERT INTO audit_events(actor_user_id, action, subject_type, subject_id) VALUES ($1, 'auth.desktop_unlinked', 'auth_session', $2)`,
      [bearer.authUserId, bearer.sessionId]);
  });
  return { ok: true as const };
}

// ---- The browser bridge (connector consents) ---------------------------------------------------------------------------

export const ticketPayloadSchema = z.object({
  org: z.string().min(1).max(80),
  provider: z.enum(PROVIDER_IDS),
  kind: z.enum(["workspace", "personal"]),
  act: z.boolean().optional(),
  purpose: z.enum(["connect", "reconnect", "upgrade"]).optional(),
  connectionId: z.string().uuid().optional(),
  returnTo: z.string().max(300).optional(),
});
export type TicketPayload = z.infer<typeof ticketPayloadSchema>;

/**
 * The connector start with `browser: true` (spec §7.1), in Boredroom for Mac's window: the cheap checks beginConnect
 * makes first, then a 5-minute single-use ticket for the person's browser. No state cookie and no state row yet: the
 * browser starts the consent itself with its own cookie, so the connectors' model is unchanged. Only a window session
 * (tied to a desktop session) may ask (403 NOT_A_WINDOW_SESSION).
 */
export async function mintBrowserTicket(ctx: OrgContext, payload: TicketPayload): Promise<{ url: string }> {
  if (schema0064Missing()) throw desktopAppNotReady();
  const provider = payload.provider;
  const app = PROVIDER_LABELS[provider];
  const adapter = await adapterFor(provider);
  if (!adapter.configured(process.env)) throw toPublicError("NOT_CONFIGURED", provider);
  if (!adapter.kinds.includes(payload.kind)) throw invalid(CONNECTOR_WORDS.kindNotOffered(app, payload.kind));
  if (impersonating(ctx)) throw forbidden(CONNECTOR_WORDS.impersonatedConnect);
  if (payload.kind === "workspace" && !isManager(ctx)) throw forbidden(CONNECTOR_WORDS.workspaceOnly);
  if (payload.kind === "personal") {
    const policy = await withUser(ctx.user.profileId, (db) => policyFor(db, ctx.org.id, provider));
    if (!policy.personalAllowed) throw forbidden(CONNECTOR_WORDS.personalOff(app));
  }
  const ticket = randomToken(32);
  await with0064(() => withSystem(async (db) => {
    const s = await db.maybeOne<{ desktop_session_id: string | null }>(
      `SELECT desktop_session_id FROM auth_sessions WHERE id = $1 AND kind = 'web' AND revoked_at IS NULL AND expires_at > now()`, [ctx.user.sessionId]);
    if (!s?.desktop_session_id) throw new AppError(403, "NOT_A_WINDOW_SESSION", "This only works in Boredroom for Mac's window.");
    await db.query(`DELETE FROM desktop_browser_tickets WHERE expires_at < now() - interval '1 day'`);
    await db.query(
      `INSERT INTO desktop_browser_tickets(ticket_hash, user_id, source_session_id, purpose, payload, origin, expires_at)
       VALUES ($1, $2, $3, 'connect', $4, $5, now() + make_interval(secs => $6))`,
      [sha256(ticket), ctx.user.authUserId, ctx.user.sessionId, JSON.stringify(payload), appOrigin(), TICKET_TTL_SECONDS]);
  }));
  return { url: `${appOrigin()}/desktop/continue?t=${ticket}` };
}

const LIVE_TICKET = `t.ticket_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND t.origin = $2
  AND EXISTS (SELECT 1 FROM auth_sessions src WHERE src.id = t.source_session_id AND src.revoked_at IS NULL AND src.expires_at > now())`;

export type TicketPreview = { app: string; workspaceName: string; displayName: string; email: string; browser: BridgeBrowser; otherEmail: string | null };

/**
 * GET /desktop/continue: who and what a ticket is for, and who this browser is (`browser`), without using it (read
 * only: a mail scanner or a link preview opening it changes nothing). Null when unknown, used or expired, or when the
 * window session that asked has gone.
 */
export async function previewTicket(t: string | null | undefined, browserToken: string | undefined): Promise<TicketPreview | null> {
  if (!t || !SECRET.test(t) || schema0064Missing()) return null;
  try {
    return await withSystem(async (db) => {
      const row = await db.maybeOne<{ user_id: string; payload: unknown; email: string; display_name: string }>(
        `SELECT t.user_id, t.payload, u.email::text AS email, p.display_name FROM desktop_browser_tickets t
           JOIN auth_users u ON u.id = t.user_id JOIN profiles p ON p.auth_user_id = u.id
          WHERE ${LIVE_TICKET} AND u.status = 'active'`, [sha256(t), appOrigin()]);
      const payload = row ? ticketPayloadSchema.safeParse(row.payload) : null;
      if (!row || !payload?.success) return null;
      const org = await db.maybeOne<{ name: string }>(`SELECT name FROM organisations WHERE slug = $1`, [payload.data.org]);
      const b = await bridgeBrowserIn(db, browserToken);
      const browser = bridgeBrowserOf(b, row.user_id);
      return {
        app: PROVIDER_LABELS[payload.data.provider], workspaceName: org?.name ?? payload.data.org, displayName: row.display_name, email: row.email,
        browser, otherEmail: browser === "other" ? b!.email : null,
      };
    });
  } catch (err) {
    if (noteMissing0064(err)) return null;
    throw err;
  }
}

/**
 * Who the browser bridge's browser is, for one ticket (security review, 24 October 2026: SEC-1, SEC-2, SEC-3). The
 * bridge never signs a browser in: only a browser already signed in as the ticket's person, as themselves (no
 * impersonation) and not as Boredroom for Mac's window, may continue. Anyone else is sent to sign in as that person,
 * so a ticket mailed to someone else, or left in a browser's history, opens nothing (no login CSRF, no session for
 * whoever holds the link, nothing that outlives unlinking the Mac).
 */
export type BridgeBrowser = "same" | "none" | "other" | "impersonated" | "window";

type BrowserSession = { auth_user_id: string; session_id: string; email: string; impersonated: boolean; window: boolean };
async function bridgeBrowserIn(db: Db, browserToken: string | undefined): Promise<BrowserSession | null> {
  if (!browserToken) return null;
  return db.maybeOne<BrowserSession>(
    `SELECT u.id AS auth_user_id, s.id AS session_id, u.email::text AS email, (s.impersonation_id IS NOT NULL) AS impersonated,
            (s.desktop_session_id IS NOT NULL) AS window
       FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.kind = 'web' AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [sha256(browserToken)]);
}
function bridgeBrowserOf(b: BrowserSession | null, ticketUserId: string): BridgeBrowser {
  if (!b) return "none";
  if (b.window) return "window";
  if (b.auth_user_id !== ticketUserId) return "other";
  return b.impersonated ? "impersonated" : "same";
}

/**
 * POST /api/desktop/continue (the route has checked the origin strictly): claims the ticket once, while the window
 * session that asked is still valid, for a browser signed in as the ticket's person (`bridgeBrowserOf` "same"). Every
 * other browser is refused before the ticket is touched, so the person can still sign in and press again: 401
 * SIGN_IN_FIRST (no session), 403 WRONG_ACCOUNT, IMPERSONATED or IN_APP_WINDOW. Never issues a session or a cookie
 * (security review, 24 October 2026: SEC-1, SEC-2). Answers the browser's own session for the consent the route starts.
 */
export async function claimTicket(t: string, browserToken: string | undefined): Promise<{ token: string; payload: TicketPayload } | null> {
  if (!SECRET.test(t)) return null;
  return with0064(() => withSystem(async (db) => {
    const peek = await db.maybeOne<{ user_id: string; email: string }>(
      `SELECT t.user_id, u.email::text AS email FROM desktop_browser_tickets t JOIN auth_users u ON u.id = t.user_id
        WHERE ${LIVE_TICKET} AND u.status = 'active'`, [sha256(t), appOrigin()]);
    if (!peek) return null;
    const browser = await bridgeBrowserIn(db, browserToken);
    switch (bridgeBrowserOf(browser, peek.user_id)) {
      case "none": throw new AppError(401, "SIGN_IN_FIRST", `Sign in to Boredroom in this browser as ${peek.email} first, then continue.`);
      case "window": throw new AppError(403, "IN_APP_WINDOW", "Open this link in your browser, not in Boredroom for Mac.");
      case "other": throw new AppError(403, "WRONG_ACCOUNT", `This link is for ${peek.email}. Sign in to Boredroom in this browser as ${peek.email}, then continue.`);
      case "impersonated": throw new AppError(403, "IMPERSONATED", CONNECTOR_WORDS.impersonatedConnect);
      case "same": break;
    }
    // The claim names the person too: a ticket is only ever used by its own person's browser.
    const row = await db.maybeOne<{ id: string; payload: unknown }>(
      `UPDATE desktop_browser_tickets t SET used_at = now(), browser_session_id = $3 WHERE ${LIVE_TICKET} AND t.user_id = $4 RETURNING t.id, t.payload`,
      [sha256(t), appOrigin(), browser!.session_id, peek.user_id]);
    if (!row) return null;
    const payload = ticketPayloadSchema.safeParse(row.payload);
    if (!payload.success) return null;
    return { token: browserToken!, payload: payload.data };
  }));
}
