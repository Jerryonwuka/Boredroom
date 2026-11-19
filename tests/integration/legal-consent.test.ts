/**
 * The agreement at sign-up and product news by opt-in (owner decisions, 11 November 2026: Privacy and Terms before
 * launch): the sign-up route refuses an account without the box; an acceptance is written to the audit log with the
 * version, the age confirmed, the IP address and how they signed up; a new Google account needs the box and an existing
 * one never does; only people who asked (the second box, or the waitlist) are in a campaign's audience and get lifecycle
 * mail; and the unsubscribe link works only for its own contact.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { withSystem } from "@/server/db";
import { allSettings } from "@/server/admin/settings";
import { signUp, settleAuthMail } from "@/server/auth";
import { signInWithGoogle, beginGoogleSignIn, googleFailureCode, googleFailureText } from "@/server/auth/google";
import { audienceSql, contactVars, unsubscribeByToken, unsubscribePreview, unsubscribeToken, upsertContact } from "@/server/admin/marketing";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { LEGAL_VERSION, LEGAL_WORDS, MINIMUM_AGE } from "@/lib/legal";

const claims = (sub: string, email: string) => ({ iss: "https://accounts.google.com", aud: "x", sub, email, email_verified: true, exp: 0, iat: 0, name: "Gina Google" });
const acceptance = (email: string) => adminQuery<{ metadata: Record<string, unknown>; organisation_id: string | null }>(
  `SELECT e.metadata, e.organisation_id FROM audit_events e JOIN auth_users u ON u.id = e.actor_user_id WHERE u.email = $1 AND e.action = 'legal.accepted'`, [email]);
const contact = async (email: string) => (await adminQuery<{ id: string; status: string; attributes: Record<string, unknown> }>(`SELECT id, status, attributes FROM marketing_contacts WHERE email = $1`, [email]))[0];
const inAudience = async (email: string) => {
  const { sql, params } = audienceSql({ kind: "all" });
  return (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n ${sql} AND c.email = $${params.length + 1}`, [...params, email]))[0].n === 1;
};
const post = (body: unknown) => signupRoute(
  new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "192.0.2.10" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({}) });

beforeAll(async () => {
  await resetTestDatabase();
  await adminQuery(`UPDATE platform_settings SET value = $1 WHERE key = 'launch'`, [JSON.stringify({ mode: "live", waitlist_open: true, app_access: true })]);
  await allSettings(true);
});
afterEach(async () => { await settleAuthMail(); });

describe("the sign-up route", () => {
  it("refuses an account without the box, in the form's own words, and makes none", async () => {
    for (const body of [{}, { agree: false }, { agree: "true" }]) {
      const res = await post({ email: "nobox@example.test", password: "correct-horse-battery", displayName: "No Box", ...body });
      expect(res.status).toBe(422);
      expect(JSON.stringify(await res.json())).toContain(LEGAL_WORDS.agreeError);
    }
    expect(await adminQuery(`SELECT 1 FROM auth_users WHERE email = 'nobox@example.test'`)).toHaveLength(0);
  });

  it("with the box: the account, and one acceptance record with the version, the age, the IP address and no product news", async () => {
    const res = await post({ email: "ticked@example.test", password: "correct-horse-battery", displayName: "Tia Ticked", agree: true });
    expect(res.status).toBe(201);
    const rows = await acceptance("ticked@example.test");
    expect(rows).toHaveLength(1);
    expect(rows[0].organisation_id).toBeNull();
    expect(rows[0].metadata).toEqual({ terms: LEGAL_VERSION, privacy: LEGAL_VERSION, minimumAge: MINIMUM_AGE, marketing: false, via: "email", ip: "192.0.2.10" });
    const c = await contact("ticked@example.test");
    expect(c.attributes.marketing_consent).toBeUndefined();
    expect(await inAudience("ticked@example.test")).toBe(false);
    expect((await withSystem((db) => contactVars(db, c.id))).unsubscribed).toBe(true);
  });

  it("with the second box too: product news is on, from that moment", async () => {
    const res = await post({ email: "news@example.test", password: "correct-horse-battery", displayName: "Nia News", agree: true, marketing: true });
    expect(res.status).toBe(201);
    expect((await acceptance("news@example.test"))[0].metadata).toMatchObject({ marketing: true });
    const c = await contact("news@example.test");
    expect(String(c.attributes.marketing_consent)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await inAudience("news@example.test")).toBe(true);
    expect((await withSystem((db) => contactVars(db, c.id))).unsubscribed).toBe(false);
  });

  it("the service alone (tests, fixtures) still makes an account, with no record it did not get", async () => {
    await signUp({ email: "plain@example.test", password: "correct-horse-battery", displayName: "Plain" });
    expect(await acceptance("plain@example.test")).toHaveLength(0);
  });
});

describe("a new account through Google", () => {
  it("is refused without the box, with the words that send the person to Create account", async () => {
    const err = await signInWithGoogle(claims("g-nobox", "gnobox@example.test"), { ip: "192.0.2.20" }, { requireAgreement: true, accepted: null }).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ code: "TERMS_REQUIRED" });
    expect(googleFailureCode(err)).toBe("terms");
    expect(googleFailureText("terms")).toBe(LEGAL_WORDS.googleNeedsAgreement);
    expect(await adminQuery(`SELECT 1 FROM auth_users WHERE email = 'gnobox@example.test'`)).toHaveLength(0);
  });

  it("is made with the box, and recorded as Google", async () => {
    const r = await signInWithGoogle(claims("g-box", "gbox@example.test"), { ip: "192.0.2.21" }, { requireAgreement: true, accepted: { marketing: true } });
    expect(r.created).toBe(true);
    expect((await acceptance("gbox@example.test")).map((x) => x.metadata)).toEqual([{ terms: LEGAL_VERSION, privacy: LEGAL_VERSION, minimumAge: MINIMUM_AGE, marketing: true, via: "google", ip: "192.0.2.21" }]);
    expect(await inAudience("gbox@example.test")).toBe(true);
  });

  it("signing in to an account that exists never needs the box, and adds no record", async () => {
    const again = await signInWithGoogle(claims("g-box", "gbox@example.test"), {}, { requireAgreement: true, accepted: null });
    expect(again.created).toBe(false);
    const linked = await signInWithGoogle(claims("g-ticked", "ticked@example.test"), {}, { requireAgreement: true, accepted: null });
    expect(linked.created).toBe(false);
    expect(await acceptance("gbox@example.test")).toHaveLength(1);
    expect(await acceptance("ticked@example.test")).toHaveLength(1);
  });

  it("the start remembers the boxes; product news never without the agreement", () => {
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    try {
      expect(JSON.parse(beginGoogleSignIn("/app").cookie)).toMatchObject({ agree: false, marketing: false });
      expect(JSON.parse(beginGoogleSignIn("/app", { agree: true, marketing: true }).cookie)).toMatchObject({ agree: true, marketing: true });
      expect(JSON.parse(beginGoogleSignIn("/app", { agree: false, marketing: true }).cookie)).toMatchObject({ agree: false, marketing: false });
    } finally {
      if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = saved.id;
      if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    }
  });
});

describe("product news", () => {
  it("someone on the waitlist asked to hear from us", async () => {
    await withSystem((db) => upsertContact(db, { email: "waiting@example.test", firstName: "Wale", source: "waitlist", isWaitlist: true }));
    expect(await inAudience("waiting@example.test")).toBe(true);
  });

  it("the unsubscribe link: shows the address masked, works for its own contact only, and takes the consent back", async () => {
    const c = await contact("news@example.test");
    const token = unsubscribeToken(c.id);
    expect(await unsubscribePreview(token)).toEqual({ email: "n•••@example.test", done: false });
    const other = await contact("waiting@example.test");
    const forged = `${other.id}.${token.split(".")[1]}`;
    expect(await unsubscribePreview(forged)).toBeNull();
    expect(await unsubscribeByToken(forged)).toBe(false);
    expect(await unsubscribeByToken("not-a-link")).toBe(false);
    expect(await inAudience("waiting@example.test")).toBe(true);

    expect(await unsubscribeByToken(token)).toBe(true);
    const after = await contact("news@example.test");
    expect(after.status).toBe("unsubscribed");
    expect(after.attributes.marketing_consent).toBeUndefined();
    expect(await inAudience("news@example.test")).toBe(false);
    expect(await unsubscribePreview(token)).toEqual({ email: "n•••@example.test", done: true });
  });
});
