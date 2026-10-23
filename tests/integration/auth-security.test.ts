/**
 * Sign-in and admin-entry fixes from the security audit (23 October 2026): issue 1 (attempts are counted in their own
 * committed transaction, with a failure lockout, for login, sign-up and desktop-link approval), issue 3 (Google linking
 * an unconfirmed password account ends the password and every way in), issue 12 (no administrator code under an
 * impersonated session; bootstrap only for a confirmed address, and its audit insert works), issue 15 (one answer for a
 * wrong password, whatever the account) and issue 16 (join codes from a cryptographic source, guessing throttled).
 * Each block fails on the code before the fix.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: undefined as string | undefined, ip: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.ip ? { "x-forwarded-for": reqState.ip } : {}),
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { withSystem } from "@/server/db";
import { allSettings } from "@/server/admin/settings";
import { signIn, signUp, resetPassword, requestPasswordRecovery, userFromSessionToken, isKnownDevice, settleAuthMail, type CurrentUser } from "@/server/auth";
import { setMailProvider } from "@/server/lib/mail";
import { signInWithGoogle } from "@/server/auth/google";
import { adminRowFor, getAdmin, type Admin } from "@/server/admin/auth";
import { startImpersonation } from "@/server/admin/ops";
import { permissionsFor } from "@/server/admin/permissions";
import { approveLink, startLink } from "@/server/services/desktop";
import { buildCompany, createVerifiedUser, type CompanyFixture } from "@/server/services/fixtures";
import { newJoinCode, previewJoinCode, joinWithCode, updateJoinCode } from "@/server/services/orgs";
import { randomToken, sha256 } from "@/server/lib/crypto";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  await adminQuery(`UPDATE platform_settings SET value = $1 WHERE key = 'launch'`, [JSON.stringify({ mode: "live", waitlist_open: true, app_access: true })]);
  await allSettings(true);
  a = await buildCompany("a");
});

afterEach(async () => { reqState.cookie = undefined; reqState.ip = undefined; vi.restoreAllMocks(); await settleAuthMail(); });

const userOf = (u: { profileId: string; authUserId: string; email: string; displayName: string }, extra: Partial<CurrentUser> = {}): CurrentUser => ({
  profileId: u.profileId, authUserId: u.authUserId, email: u.email, displayName: u.displayName, emailVerified: true, sessionId: "test", impersonation: null, ...extra,
});
const clearAttemptBuckets = (email: string) => adminQuery(`DELETE FROM auth_rate_limits WHERE bucket LIKE 'login:%' OR bucket = $1`, [`signup:${email}`]);

describe("issue 1: failed attempts are counted", () => {
  it("a wrong password counts: the 11th try for one address within 15 minutes is refused with 429", async () => {
    const u = await createVerifiedUser("guess-me@a.test", "Guess Me");
    for (let i = 0; i < 10; i++) {
      await expect(signIn({ email: u.email, password: `wrong-${i}-xxxxxx`, ip: `198.51.100.${i}` })).rejects.toMatchObject({ status: 401, code: "BAD_CREDENTIALS" });
    }
    await expect(signIn({ email: u.email, password: "wrong-again-xxxx", ip: "198.51.100.200" })).rejects.toMatchObject({ status: 429 });
    // Verification V2 (security audit, 23 October 2026): only failures count against the address now.
    const rows = await adminQuery<{ hits: number }>(`SELECT hits FROM auth_rate_limits WHERE bucket = $1`, [`login.fail:${u.email}`]);
    expect(rows[0]?.hits).toBe(10);
  });

  it("ten failed passwords lock the address for the hour, even with the right password, until it is reset", async () => {
    const u = await createVerifiedUser("locked@a.test", "Locked Out");
    for (let i = 0; i < 10; i++) await expect(signIn({ email: u.email, password: `nope-${i}-xxxxxx`, ip: "198.51.100.7" })).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    await clearAttemptBuckets(u.email); // only the failure counter is left
    await expect(signIn({ email: u.email, password: u.password, ip: "198.51.100.8" })).rejects.toMatchObject({ status: 429, message: expect.stringContaining("failed attempts") });
    // Proving the mailbox lifts the lock.
    const token = randomToken(32);
    await adminQuery(`INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, 'recover_password', $2, now() + interval '1 hour')`, [u.authUserId, sha256(token)]);
    await resetPassword(token, "a-brand-new-password");
    const ok = await signIn({ email: u.email, password: "a-brand-new-password", ip: "198.51.100.9" });
    expect(ok.token).toBeTruthy();
  });

  it("sign-up attempts count even when the address is taken (409), so the 21st from one IP is refused", async () => {
    await createVerifiedUser("taken@a.test", "Taken");
    for (let i = 0; i < 20; i++) {
      await expect(signUp({ email: "taken@a.test", password: "long-enough-password", displayName: "X", ip: "192.0.2.50" })).rejects.toMatchObject({ status: 409 });
    }
    await expect(signUp({ email: "taken@a.test", password: "long-enough-password", displayName: "X", ip: "192.0.2.50" })).rejects.toMatchObject({ status: 429 });
  });

  it("desktop-link approval counts wrong codes: after ten, the right code is refused for the hour", async () => {
    const me = userOf({ ...a.employee });
    for (let i = 0; i < 10; i++) {
      await expect(approveLink(me, { userCode: `ZZZZ-ZZ${String(i).padStart(2, "2")}`, orgSlug: a.employeeCtx.org.slug })).rejects.toMatchObject({ status: 422 });
    }
    const link = await startLink({ deviceName: "Test Mac" }, { ip: "192.0.2.60", origin: "http://localhost:3000" });
    await expect(approveLink(me, { userCode: link.userCode, orgSlug: a.employeeCtx.org.slug })).rejects.toMatchObject({ status: 429 });
    const fails = await adminQuery<{ hits: number }>(`SELECT hits FROM auth_rate_limits WHERE bucket = $1`, [`desktop.approve.fail:${me.authUserId}`]);
    expect(fails[0]?.hits).toBe(10);
  });

  it("V2: failures from rotating addresses do not lock the owner out of a browser that signed in before", async () => {
    const owner = await createVerifiedUser("rotating-target@a.test", "Rotating Target");
    const first = await signIn({ email: owner.email, password: owner.password, ip: "198.51.100.30" });
    expect(isKnownDevice(first.knownDevice, owner.email)).toBe(true);
    for (let i = 0; i < 10; i++) await expect(signIn({ email: owner.email, password: `guess-${i}-xxxxxx`, ip: `203.0.113.${100 + i}` })).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    // A new network address, the browser that signed in before, the right password: in.
    const ok = await signIn({ email: owner.email, password: owner.password, ip: "198.51.100.31", knownDevice: first.knownDevice });
    expect(await userFromSessionToken(ok.token)).not.toBeNull();
    // A browser that never signed in to this address (no cookie, or one for another address, or a forged one) is still locked.
    const other = await signIn({ email: a.employee.email, password: a.employee.password, ip: "198.51.100.32" });
    for (const knownDevice of [undefined, other.knownDevice, `${first.knownDevice.split(".")[0]}.forged`]) {
      await expect(signIn({ email: owner.email, password: owner.password, ip: "198.51.100.33", knownDevice })).rejects.toMatchObject({ status: 429 });
    }
  });

  it("V2: ten failures from one network address lock that address out, known browser or not", async () => {
    const u = await createVerifiedUser("one-network@a.test", "One Network");
    const first = await signIn({ email: u.email, password: u.password, ip: "198.51.100.40" });
    for (let i = 0; i < 10; i++) await expect(signIn({ email: u.email, password: `nope-${i}-xxxxxx`, ip: "198.51.100.41", knownDevice: first.knownDevice })).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    await expect(signIn({ email: u.email, password: u.password, ip: "198.51.100.41", knownDevice: first.knownDevice })).rejects.toMatchObject({ status: 429 });
    await expect(signIn({ email: u.email, password: u.password, ip: "198.51.100.42", knownDevice: first.knownDevice })).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("V2: a password reset lifts every lock on the address at once (nothing left from counting every attempt)", async () => {
    const u = await createVerifiedUser("reset-lifts@a.test", "Reset Lifts");
    for (let i = 0; i < 10; i++) await expect(signIn({ email: u.email, password: `nope-${i}-xxxxxx`, ip: "198.51.100.50" })).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    const token = randomToken(32);
    await adminQuery(`INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, 'recover_password', $2, now() + interval '1 hour')`, [u.authUserId, sha256(token)]);
    await resetPassword(token, "another-new-password");
    await expect(signIn({ email: u.email, password: "another-new-password", ip: "198.51.100.50" })).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("V4: recovery answers without waiting for the mail, so a real account takes no longer than an unknown one", async () => {
    const u = await createVerifiedUser("timing@a.test", "Timing");
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const sent: string[] = [];
    setMailProvider({ send: async (m) => { await held; sent.push(m.to); return { id: "held" }; } });
    try {
      const answered = await Promise.race([requestPasswordRecovery(u.email, "203.0.113.70").then(() => "answered"), new Promise((r) => setTimeout(() => r("waited for the mail"), 2000))]);
      expect(answered).toBe("answered");
      expect(sent).toEqual([]);
      release();
      await settleAuthMail();
      expect(sent).toEqual([u.email]);
      expect(await adminQuery(`SELECT 1 FROM auth_tokens WHERE user_id = $1 AND kind = 'recover_password'`, [u.authUserId])).toHaveLength(1);
    } finally { release(); setMailProvider(null); }
  });

  it("password recovery is limited per address as well as per IP", async () => {
    for (let i = 0; i < 5; i++) await requestPasswordRecovery("nobody-here@a.test", `203.0.113.${i}`);
    await expect(requestPasswordRecovery("nobody-here@a.test", "203.0.113.99")).rejects.toMatchObject({ status: 429 });
  });
});

describe("issue 15: one answer for a wrong password", () => {
  it("suspended, Google-only and unknown accounts all answer BAD_CREDENTIALS without the right password", async () => {
    const s = await createVerifiedUser("suspended@a.test", "Suspended");
    await adminQuery(`UPDATE auth_users SET status = 'suspended', status_reason = 'internal note: chargeback fraud' WHERE id = $1`, [s.authUserId]);
    const g = await createVerifiedUser("google-only@a.test", "Google Only");
    await adminQuery(`UPDATE auth_users SET password_hash = NULL WHERE id = $1`, [g.authUserId]);
    for (const email of [s.email, g.email, "no-such-account@a.test"]) {
      const err = await signIn({ email, password: "not-the-password", ip: "203.0.113.20" }).catch((e) => e);
      expect(err).toMatchObject({ status: 401, code: "BAD_CREDENTIALS" });
      expect(String(err.message)).not.toMatch(/suspend|chargeback|Google account/i);
    }
    // With the right password, the account holder is told why.
    await expect(signIn({ email: s.email, password: s.password, ip: "203.0.113.21" })).rejects.toMatchObject({ status: 403, code: "ACCOUNT_SUSPENDED", message: expect.stringContaining("chargeback") });
  });
});

describe("issue 3: Google linking an unconfirmed password account", () => {
  it("clears the password and ends the old sessions, links and approved desktop codes", async () => {
    const email = "victim@corp.test";
    await signUp({ email, password: "attacker-chosen-pw", displayName: "Attacker", ip: "192.0.2.70" });
    const attacker = await signIn({ email, password: "attacker-chosen-pw", ip: "192.0.2.70" });
    expect(await userFromSessionToken(attacker.token)).not.toBeNull();
    const [{ id }] = await adminQuery<{ id: string }>(`SELECT id FROM auth_users WHERE email = $1`, [email]);
    await adminQuery(`INSERT INTO desktop_link_codes(device_code_hash, user_code, expires_at, approved_at, approved_user_id, organisation_id) VALUES ($1, 'QQQQ-QQQQ', now() + interval '10 minutes', now(), $2, $3)`, [sha256("attacker-device"), id, a.employeeCtx.org.id]);

    const res = await signInWithGoogle({ iss: "https://accounts.google.com", aud: "x", sub: "google-sub-victim", email, email_verified: true, exp: 0, iat: 0 }, { ip: "192.0.2.71" });
    expect(res.created).toBe(false);
    expect(await userFromSessionToken(res.token)).not.toBeNull();

    expect(await userFromSessionToken(attacker.token)).toBeNull();
    const [u] = await adminQuery<{ password_hash: string | null; verified: boolean }>(`SELECT password_hash, email_verified_at IS NOT NULL AS verified FROM auth_users WHERE id = $1`, [id]);
    expect(u).toEqual({ password_hash: null, verified: true });
    await adminQuery(`DELETE FROM auth_rate_limits WHERE bucket LIKE 'login%'`);
    await expect(signIn({ email, password: "attacker-chosen-pw", ip: "192.0.2.72" })).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    const open = await adminQuery(`SELECT 1 FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL`, [id]);
    expect(open).toHaveLength(0);
    expect(await adminQuery(`SELECT 1 FROM desktop_link_codes WHERE approved_user_id = $1 AND claimed_at IS NULL`, [id])).toHaveLength(0);
  });

  it("an account already confirmed keeps its password and sessions when Google is linked", async () => {
    const u = await createVerifiedUser("confirmed@corp.test", "Confirmed");
    const s = await signIn({ email: u.email, password: u.password, ip: "192.0.2.80" });
    await signInWithGoogle({ iss: "https://accounts.google.com", aud: "x", sub: "google-sub-confirmed", email: u.email, email_verified: true, exp: 0, iat: 0 }, { ip: "192.0.2.81" });
    expect(await userFromSessionToken(s.token)).not.toBeNull();
    const [row] = await adminQuery<{ has: boolean }>(`SELECT password_hash IS NOT NULL AS has FROM auth_users WHERE id = $1`, [u.authUserId]);
    expect(row.has).toBe(true);
  });
});

describe("issue 12: admin bootstrap and impersonation", () => {
  it("bootstraps a confirmed listed address (the audit insert no longer fails), and never an unconfirmed or impersonated one", async () => {
    process.env.PLATFORM_SUPER_ADMINS = "founder@boredroom.test, cofounder@boredroom.test, unconfirmed@boredroom.test";
    const founder = await createVerifiedUser("founder@boredroom.test", "Founder");
    const row = await withSystem((db) => adminRowFor(db, userOf(founder)));
    expect(row).toMatchObject({ role: "super_admin", status: "active" });
    const audit = await adminQuery<{ target_id: string }>(`SELECT target_id FROM platform_audit_events WHERE action = 'admin.bootstrap' AND admin_user_id = $1`, [founder.authUserId]);
    expect(audit).toEqual([{ target_id: founder.authUserId }]);

    const unconfirmed = await createVerifiedUser("unconfirmed@boredroom.test", "Unconfirmed");
    expect(await withSystem((db) => adminRowFor(db, userOf(unconfirmed, { emailVerified: false })))).toBeNull();
    const cofounder = await createVerifiedUser("cofounder@boredroom.test", "Co-founder");
    expect(await withSystem((db) => adminRowFor(db, userOf(cofounder, { impersonation: { id: "x", adminEmail: "support@boredroom.test" } })))).toBeNull();
    expect(await adminQuery(`SELECT 1 FROM platform_admins WHERE auth_user_id = ANY($1::uuid[])`, [[unconfirmed.authUserId, cofounder.authUserId]])).toHaveLength(0);
  });

  it("an impersonated session gets no administrator, even when its person is one", async () => {
    const boss = await createVerifiedUser("ops-admin@boredroom.test", "Ops Admin");
    const support = await createVerifiedUser("support@boredroom.test", "Support");
    await adminQuery(`INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, 'super_admin', 'active')`, [boss.authUserId]);
    const own = await signIn({ email: boss.email, password: boss.password, ip: "192.0.2.90" });
    reqState.cookie = own.token;
    expect(await getAdmin()).not.toBeNull();
    const token = randomToken(32);
    const [imp] = await adminQuery<{ id: string }>(`INSERT INTO admin_impersonations(admin_user_id, target_user_id, reason) VALUES ($1, $2, 'test') RETURNING id`, [support.authUserId, boss.authUserId]);
    await adminQuery(`INSERT INTO auth_sessions(user_id, token_hash, expires_at, impersonation_id) VALUES ($1, $2, now() + interval '1 hour', $3)`, [boss.authUserId, sha256(token), imp.id]);
    reqState.cookie = token;
    expect(await getAdmin()).toBeNull();
  });

  it("support cannot impersonate a listed address or anyone with an administrator row, disabled included", async () => {
    process.env.PLATFORM_SUPER_ADMINS = "listed@boredroom.test";
    const supportUser = await createVerifiedUser("support2@boredroom.test", "Support Two");
    const [adm] = await adminQuery<{ id: string }>(`INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, 'support', 'active') RETURNING id`, [supportUser.authUserId]);
    const admin: Admin = { user: userOf(supportUser), adminId: adm.id, role: "support", permissions: permissionsFor("support"), ip: null };
    const listed = await createVerifiedUser("listed@boredroom.test", "Listed");
    await expect(startImpersonation(admin, listed.authUserId, "checking", {})).rejects.toMatchObject({ status: 403 });
    const former = await createVerifiedUser("former-admin@boredroom.test", "Former Admin");
    await adminQuery(`INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, 'super_admin', 'disabled')`, [former.authUserId]);
    await expect(startImpersonation(admin, former.authUserId, "checking", {})).rejects.toMatchObject({ status: 403 });
    // An ordinary customer can still be helped.
    await expect(startImpersonation(admin, a.employee.authUserId, "checking", {})).resolves.toMatchObject({ email: a.employee.email });
  });
});

describe("issue 16: join codes", () => {
  it("are drawn from a cryptographic source, not Math.random()", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const codes = new Set(Array.from({ length: 8 }, () => newJoinCode()));
    expect(codes.size).toBeGreaterThan(1);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("thirty unknown codes from one IP refuse every lookup from it for the hour, a real code included", async () => {
    const { join_code } = await updateJoinCode(a.hrCtx, { enabled: true });
    reqState.ip = "203.0.113.150";
    for (let i = 0; i < 30; i++) expect(await previewJoinCode(`ZZZZ-${String(i).padStart(4, "2")}`)).toBeNull();
    await expect(previewJoinCode(join_code!)).rejects.toMatchObject({ status: 429 });
    reqState.ip = "203.0.113.151";
    expect(await previewJoinCode(join_code!)).toMatchObject({ organisationId: a.employeeCtx.org.id });
  });

  it("joining is limited per account: the 21st try in an hour is refused", async () => {
    const joiner = await createVerifiedUser("joiner@a.test", "Joiner");
    for (let i = 0; i < 20; i++) {
      reqState.ip = `198.18.0.${i}`;
      await expect(joinWithCode(joiner.profileId, `YYYY-${String(i).padStart(4, "2")}`)).rejects.toMatchObject({ status: 404 });
    }
    reqState.ip = "198.18.1.1";
    await expect(joinWithCode(joiner.profileId, "YYYY-9999")).rejects.toMatchObject({ status: 429 });
  });
});
