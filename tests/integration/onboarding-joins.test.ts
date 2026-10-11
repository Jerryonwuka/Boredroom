/**
 * The way in around the first-run welcome (owner request, 11 October 2026): a lead join code makes the joiner that team's
 * lead (D11) and migration 0056's policies let only a lead code or a lead invitation take a lead seat; "someone joined"
 * reaches owners, HR and the team's leads once each and says nothing about setup (D12); while Boredroom is in waitlist
 * mode a pending invitation to that address or an enabled join code still lets someone create an account, by email or
 * with Google (D9); the verification link carries a safe `next`; confirming twice says "already" instead of failing; a
 * link can be looked at without being used; and a profile picture is stored without its location (D18).
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). Mail goes to the sink (./var/test-mail),
 * pictures to ./var/test-storage. No Google, no model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminQuery, resetTestDatabase } from "../helpers/db";
import { buildCompany, contextFor, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createInvitation, joinWithCode, setTeamMember, updateJoinCode } from "@/server/services/orgs";
import { joiningAllowed, peekVerifyToken, resendVerification, signUp, verifyEmail } from "@/server/auth";
import { signInWithGoogle } from "@/server/auth/google";
import { allSettings } from "@/server/admin/settings";
import { setMyAvatar } from "@/server/services/profile";
import { storage } from "@/server/lib/storage";
import { WELCOME_WORDS } from "@/lib/welcome";

delete process.env.ANTHROPIC_API_KEY;

const PASSWORD = "a-long-enough-password";
const SINK = process.env.MAIL_SINK_DIR ?? "./var/test-mail";
let a: CompanyFixture;
let b: CompanyFixture;
const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { status?: number; code?: string; message?: string }; } };

/** The newest verification link mailed to `email`, from the sink. */
function verifyLink(email: string): URL {
  const mails = readdirSync(SINK).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(SINK, f), "utf8")) as { to: string; category: string; text: string; sentAt: string })
    .filter((m) => m.to === email && m.category === "verify_email")
    .sort((x, y) => x.sentAt.localeCompare(y.sentAt));
  const last = mails[mails.length - 1];
  if (!last) throw new Error(`no verification mail for ${email}`);
  const m = /(https?:\/\/[^\s"<>]+\/verify\?[^\s"<>]+)/.exec(last.text);
  if (!m) throw new Error("no link in the mail");
  return new URL(m[1]);
}

async function launchMode(mode: "waitlist" | "live") {
  await adminQuery(`UPDATE platform_settings SET value = $1 WHERE key = 'launch'`, [JSON.stringify({ mode, waitlist_open: true, app_access: true })]);
  await allSettings(true);
}

/** Several statements as one person in one transaction (a CTE's insert is not visible to the policy's own lookups). */
async function asUserSteps(profileId: string, steps: [string, unknown[]][]) {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id', $1, true)", [profileId]);
    let last: unknown[] = [];
    for (const [sql, p] of steps) last = (await c.query(sql, p as never[])).rows;
    await c.query("COMMIT");
    return last;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { await c.end(); }
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
});

afterAll(async () => {
  await launchMode("live").catch(() => undefined);
});

describe("lead seats by join code", () => {
  it("a lead code naming a team makes the joiner its lead, with lead access to its project", async () => {
    const code = await updateJoinCode(a.ownerCtx, { enabled: true, role: "manager", teamId: a.teamId, rotate: true });
    const tolu = await createVerifiedUser("tolu@company-a.test", "Tolu Bakare");
    const joined = await joinWithCode(tolu.profileId, code.join_code!);
    expect(await adminQuery(`SELECT is_manager FROM team_members WHERE membership_id = $1`, [joined.membershipId])).toEqual([{ is_manager: true }]);
    expect(await adminQuery(`SELECT pm.access_role FROM project_members pm JOIN teams t ON t.project_id = pm.project_id WHERE t.id = $1 AND pm.membership_id = $2`, [a.teamId, joined.membershipId]))
      .toEqual([{ access_role: "lead" }]);
    expect(await adminQuery(`SELECT role FROM memberships WHERE id = $1`, [joined.membershipId])).toEqual([{ role: "manager" }]);
  });

  it("a staff code gives a member's seat", async () => {
    const code = await updateJoinCode(a.ownerCtx, { enabled: true, role: "employee", teamId: a.teamId });
    const sade = await createVerifiedUser("sade@company-a.test", "Sade Staff");
    const joined = await joinWithCode(sade.profileId, code.join_code!);
    expect(await adminQuery(`SELECT is_manager FROM team_members WHERE membership_id = $1`, [joined.membershipId])).toEqual([{ is_manager: false }]);
    expect(await adminQuery(`SELECT pm.access_role FROM project_members pm JOIN teams t ON t.project_id = pm.project_id WHERE t.id = $1 AND pm.membership_id = $2`, [a.teamId, joined.membershipId]))
      .toEqual([{ access_role: "contributor" }]);
  });

  it("refuses a lead seat taken with a staff code or a staff invitation, and allows a member's seat", async () => {
    const code = (await updateJoinCode(a.ownerCtx, { enabled: true, role: "employee", teamId: a.teamId })).join_code!;
    const seat = (profileId: string, empCode: string, isManager: boolean): [string, unknown[]][] => [
      ["SELECT set_config('app.join_code', $1, true)", [code]],
      ["INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, 'employee')", [a.ownerCtx.org.id, profileId, empCode]],
      ["INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) SELECT $1, $2, m.id, $4 FROM memberships m WHERE m.organisation_id = $1 AND m.user_id = $3 RETURNING is_manager", [a.ownerCtx.org.id, a.teamId, profileId, isManager]],
    ];
    const sneaky = await createVerifiedUser("sneaky@company-a.test", "Sneaky Joiner");
    await expect(asUserSteps(sneaky.profileId, seat(sneaky.profileId, "EMP-701", true))).rejects.toThrow(/row-level security/);
    const plain = await createVerifiedUser("plain@company-a.test", "Plain Joiner");
    expect(await asUserSteps(plain.profileId, seat(plain.profileId, "EMP-702", false))).toEqual([{ is_manager: false }]);

    const accept = (email: string, profileId: string, empCode: string, isManager: boolean): [string, unknown[]][] => [
      ["INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, 'employee')", [a.ownerCtx.org.id, profileId, empCode]],
      ["UPDATE invitations SET accepted_at = now(), accepted_membership_id = (SELECT id FROM memberships WHERE organisation_id = $1 AND user_id = $2) WHERE organisation_id = $1 AND email = $3", [a.ownerCtx.org.id, profileId, email]],
      ["INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) SELECT $1, $2, m.id, $4 FROM memberships m WHERE m.organisation_id = $1 AND m.user_id = $3 RETURNING is_manager", [a.ownerCtx.org.id, a.teamId, profileId, isManager]],
    ];
    await updateJoinCode(a.ownerCtx, { enabled: false });
    const forger = await createVerifiedUser("forger@company-a.test", "Forger");
    await createInvitation(a.ownerCtx, { email: forger.email, role: "employee", teamId: a.teamId, employeeCode: "EMP-703" }, { send: false });
    await expect(asUserSteps(forger.profileId, accept(forger.email, forger.profileId, "EMP-703", true))).rejects.toThrow(/row-level security/);
    const honest = await createVerifiedUser("honest@company-a.test", "Honest");
    await createInvitation(a.ownerCtx, { email: honest.email, role: "employee", teamId: a.teamId, employeeCode: "EMP-704" }, { send: false });
    expect(await asUserSteps(honest.profileId, accept(honest.email, honest.profileId, "EMP-704", false))).toEqual([{ is_manager: false }]);
    // A lead invitation still gives the lead seat (acceptInvitation).
    const lead = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("lead2@company-a.test", "Second Lead"), "manager", a.teamId, "MGR-701");
    expect(await adminQuery(`SELECT is_manager FROM team_members WHERE membership_id = $1`, [lead.membership.id])).toEqual([{ is_manager: true }]);
  });
});

type Note = { recipient_membership_id: string; title: string; body: string | null; href: string | null; resource_type: string; resource_id: string; deduplication_key: string };
const joinedNotes = (membershipId: string) => adminQuery<Note>(
  `SELECT recipient_membership_id, title, body, href, resource_type, resource_id, deduplication_key FROM notifications WHERE type = 'member.joined' AND resource_id = $1 ORDER BY recipient_membership_id`, [membershipId]);

describe("someone joined", () => {
  it("tells owners, HR and the team's leads once each, never the joiner, never about setup", async () => {
    const ada = await joinViaInvitation(b.hrCtx, await createVerifiedUser("ada.obi@company-b.test", "Ada Obi"), "employee", b.teamId, "EMP-901");
    const notes = await joinedNotes(ada.membership.id);
    const by = new Map(notes.map((n) => [n.recipient_membership_id, n]));
    expect(notes).toHaveLength(3);
    expect(by.has(ada.membership.id)).toBe(false);
    expect(by.get(b.ownerCtx.membership.id)).toMatchObject({ title: "Ada Obi joined as staff", body: "In Design.", href: "/app/company-b/people?tab=people", resource_type: "membership", deduplication_key: `member.joined:${ada.membership.id}` });
    expect(by.get(b.hrCtx.membership.id)).toMatchObject({ title: "Ada Obi joined as staff", href: "/app/company-b/people?tab=people" });
    expect(by.get(b.managerCtx.membership.id)).toMatchObject({ title: "Ada Obi joined as staff", body: "In Design.", href: `/app/company-b/teams/${b.teamId}` });
    expect(by.has(b.employeeCtx.membership.id)).toBe(false);
    for (const n of notes) expect(`${n.title} ${n.body ?? ""}`).not.toMatch(/setup|set up|welcome|assistant/i);
    expect(WELCOME_WORDS.notifications.title("Ada Obi", "employee")).toBe(notes[0].title);
  });

  it("says a lead joined as a team lead, and tells only owners and HR when there is no team", async () => {
    const code = await updateJoinCode(b.ownerCtx, { enabled: true, role: "manager", teamId: b.teamId, rotate: true });
    const tolu = await createVerifiedUser("tolu@company-b.test", "Tolu Bakare");
    const joined = await joinWithCode(tolu.profileId, code.join_code!);
    const notes = await joinedNotes(joined.membershipId);
    expect(notes.map((n) => n.title)).toEqual(Array(3).fill("Tolu Bakare joined as a team lead"));
    expect(notes.map((n) => n.recipient_membership_id).sort()).toEqual([b.ownerCtx.membership.id, b.hrCtx.membership.id, b.managerCtx.membership.id].sort());

    await updateJoinCode(b.ownerCtx, { enabled: true, role: "employee", teamId: null });
    const solo = await createVerifiedUser("solo@company-b.test", "Solo Staff");
    const s = await joinWithCode(solo.profileId, code.join_code!);
    const soloNotes = await joinedNotes(s.membershipId);
    expect(soloNotes.map((n) => n.recipient_membership_id).sort()).toEqual([b.ownerCtx.membership.id, b.hrCtx.membership.id].sort());
    expect(soloNotes.every((n) => n.body === null && n.href === "/app/company-b/people?tab=people")).toBe(true);
    await updateJoinCode(b.ownerCtx, { enabled: false });
  });

  it("tells someone who is both HR and the team's lead once, with People's link", async () => {
    await setTeamMember(b.ownerCtx, b.teamId, b.hrCtx.membership.id, { isManager: true });
    const ben = await joinViaInvitation(b.ownerCtx, await createVerifiedUser("bisi@company-b.test", "Bisi Staff"), "employee", b.teamId, "BIS-001");
    const mine = (await joinedNotes(ben.membership.id)).filter((n) => n.recipient_membership_id === b.hrCtx.membership.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].href).toBe("/app/company-b/people?tab=people");
    await setTeamMember(b.ownerCtx, b.teamId, b.hrCtx.membership.id, { isManager: false, remove: true });
  });

  it("says when an owner or HR joined", async () => {
    const hr2 = await joinViaInvitation(b.ownerCtx, await createVerifiedUser("hr2@company-b.test", "Halima Hr"), "hr", null, "HR-802");
    const notes = await joinedNotes(hr2.membership.id);
    expect(notes.map((n) => [n.recipient_membership_id, n.title])).toEqual(
      [[b.ownerCtx.membership.id, "Halima Hr joined as an HR administrator"], [b.hrCtx.membership.id, "Halima Hr joined as an HR administrator"]]
        .sort((x, y) => x[0].localeCompare(y[0])));
  });
});

describe("the verification link", () => {
  it("carries a safe next, and leaves an unsafe one out", async () => {
    await signUp({ email: "nextful@new.test", password: PASSWORD, displayName: "Nora Next", next: "/join/ABCD-EFGH" });
    const link = verifyLink("nextful@new.test");
    expect(link.pathname).toBe("/verify");
    expect(link.search).toMatch(/^\?token=[A-Za-z0-9_-]+&next=%2Fjoin%2FABCD-EFGH$/);
    expect(link.searchParams.get("next")).toBe("/join/ABCD-EFGH");

    await signUp({ email: "evil@new.test", password: PASSWORD, displayName: "Eve Il", next: "//evil.example/join/X" });
    expect(verifyLink("evil@new.test").searchParams.has("next")).toBe(false);
    await signUp({ email: "plain@new.test", password: PASSWORD, displayName: "Pat Plain" });
    expect(verifyLink("plain@new.test").searchParams.has("next")).toBe(false);

    await resendVerification("plain@new.test", "/invite/tok_abc");
    expect(verifyLink("plain@new.test").searchParams.get("next")).toBe("/invite/tok_abc");
  });

  it("confirms once, then says already; an unknown link is refused", async () => {
    const token = verifyLink("nextful@new.test").searchParams.get("token")!;
    const [{ id }] = await adminQuery<{ id: string }>(`SELECT id FROM auth_users WHERE email = 'nextful@new.test'`);
    expect(await peekVerifyToken(token)).toEqual({ authUserId: id, verified: false, usable: true });
    expect(await verifyEmail(token)).toEqual({ userId: id, already: false });
    expect(await peekVerifyToken(token)).toEqual({ authUserId: id, verified: true, usable: false });
    expect(await verifyEmail(token)).toEqual({ userId: id, already: true });
    expect(await rejects(verifyEmail("not-a-real-token-at-all"))).toMatchObject({ status: 410, code: "TOKEN_INVALID" });
    expect(await peekVerifyToken("not-a-real-token-at-all")).toBeNull();
    expect(await peekVerifyToken("")).toBeNull();
  });

  it("refuses a used link whose account is still unconfirmed, as before", async () => {
    const token = verifyLink("evil@new.test").searchParams.get("token")!;
    const used = await adminQuery(`UPDATE auth_tokens SET used_at = now() WHERE token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex') RETURNING id`, [token]);
    expect(used).toHaveLength(1);
    expect(await peekVerifyToken(token)).toMatchObject({ verified: false, usable: false });
    expect(await rejects(verifyEmail(token))).toMatchObject({ status: 410 });
    // Expired, unconfirmed: refused, and the peek says so.
    await adminQuery(`UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM auth_users WHERE email = 'plain@new.test')`);
    const plainToken = verifyLink("plain@new.test").searchParams.get("token")!;
    expect(await peekVerifyToken(plainToken)).toMatchObject({ verified: false, usable: false });
    expect(await rejects(verifyEmail(plainToken))).toMatchObject({ status: 410 });
  });
});

describe("waitlist mode lets joiners in", () => {
  it("refuses everyone else, by email and with Google", async () => {
    await launchMode("waitlist");
    try {
      expect(await rejects(signUp({ email: "nobody@new.test", password: PASSWORD, displayName: "No Body" }))).toMatchObject({ status: 403, code: "REGISTRATION_CLOSED" });
      expect(await rejects(signUp({ email: "nobody@new.test", password: PASSWORD, displayName: "No Body", next: "/app" }))).toMatchObject({ code: "REGISTRATION_CLOSED" });
      const claims = { iss: "https://accounts.google.com", aud: "x", sub: "g-nobody", email: "gnobody@new.test", email_verified: true, name: "G Nobody", exp: 0, iat: 0 };
      expect(await rejects(signInWithGoogle(claims, {}))).toMatchObject({ code: "REGISTRATION_CLOSED" });
    } finally { await launchMode("live"); }
  });

  it("lets in a pending invitation to that address, and no other address", async () => {
    const inv = await createInvitation(a.hrCtx, { email: "invitee@company-a.test", role: "employee", teamId: a.teamId, employeeCode: null }, { send: false });
    const next = `/invite/${inv.token}`;
    await launchMode("waitlist");
    try {
      expect(await joiningAllowed(next, "Invitee@Company-A.test")).toBe(true);
      expect(await joiningAllowed(next, "someone@else.test")).toBe(false);
      expect(await rejects(signUp({ email: "someone@else.test", password: PASSWORD, displayName: "Some One", next }))).toMatchObject({ code: "REGISTRATION_CLOSED" });
      const made = await signUp({ email: "invitee@company-a.test", password: PASSWORD, displayName: "In Vitee", next });
      expect(made.profileId).toBeTruthy();
      expect(verifyLink("invitee@company-a.test").searchParams.get("next")).toBe(next);

      const gInv = await createInvitation(a.hrCtx, { email: "gina@company-a.test", role: "employee", teamId: null, employeeCode: null }, { send: false });
      const claims = { iss: "https://accounts.google.com", aud: "x", sub: "g-gina", email: "gina@company-a.test", email_verified: true, name: "Gina Google", exp: 0, iat: 0 };
      expect(await signInWithGoogle(claims, {}, { next: `/invite/${gInv.token}` })).toMatchObject({ created: true });
    } finally { await launchMode("live"); }
  });

  it("lets in an enabled join code, and not a paused one", async () => {
    const code = (await updateJoinCode(a.ownerCtx, { enabled: true, role: "employee", teamId: a.teamId, rotate: true })).join_code!;
    await launchMode("waitlist");
    try {
      expect(await joiningAllowed(`/join/${code}`, "coder@new.test")).toBe(true);
      expect(await joiningAllowed(`/join/${encodeURIComponent(code)}`, "coder@new.test")).toBe(true);
      expect((await signUp({ email: "coder@new.test", password: PASSWORD, displayName: "Cody Coder", next: `/join/${code}` })).profileId).toBeTruthy();
      await updateJoinCode(a.ownerCtx, { enabled: false });
      expect(await joiningAllowed(`/join/${code}`, "paused@new.test")).toBe(false);
      expect(await rejects(signUp({ email: "paused@new.test", password: PASSWORD, displayName: "Paula Paused", next: `/join/${code}` }))).toMatchObject({ code: "REGISTRATION_CLOSED" });
      expect(await joiningAllowed("/join/NOPE-NOPE", "x@new.test")).toBe(false);
      expect(await joiningAllowed("/invite/not-a-token", "x@new.test")).toBe(false);
    } finally { await launchMode("live"); }
  });

  it("an accepted or revoked invitation no longer lets anyone in", async () => {
    const inv = await createInvitation(a.hrCtx, { email: "late@company-a.test", role: "employee", teamId: null, employeeCode: null }, { send: false });
    await adminQuery(`UPDATE invitations SET revoked_at = now() WHERE id = $1`, [inv.id]);
    expect(await joiningAllowed(`/invite/${inv.token}`, "late@company-a.test")).toBe(false);
  });
});

describe("profile pictures", () => {
  it("are stored without their location", async () => {
    // A JPEG: SOI, an Exif APP1 carrying a GPS note, a comment, then the picture's data.
    const secret = Buffer.from("GPS 6.4541N 3.3947E", "latin1");
    const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), secret]);
    const seg = (marker: number, payload: Buffer) => { const h = Buffer.from([0xff, marker, 0, 0]); h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]); };
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, exif), seg(0xfe, Buffer.from("taken at home", "latin1")), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x11, 0x22, 0xff, 0xd9])]);
    expect(jpeg.includes(secret)).toBe(true);
    const ctx = await contextFor(a.employee, "company-a");
    const { avatarKey } = await setMyAvatar(ctx.user, { type: "image/jpeg", bytes: jpeg });
    const stored = await storage().get(avatarKey);
    expect(stored).not.toBeNull();
    expect(stored!.includes(secret)).toBe(false);
    expect(stored!.includes(Buffer.from("taken at home", "latin1"))).toBe(false);
    expect(stored!.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(stored!.subarray(stored!.length - 4).equals(Buffer.from([0x11, 0x22, 0xff, 0xd9]))).toBe(true);
    // The checks and their words are as before.
    expect(await rejects(setMyAvatar(ctx.user, { type: "image/png", bytes: jpeg }))).toMatchObject({ message: "The file content does not match its declared type." });
    expect(await rejects(setMyAvatar(ctx.user, { type: "image/gif", bytes: Buffer.from("GIF89a") }))).toMatchObject({ message: "Use a PNG, JPEG or WebP image." });
    expect(await rejects(setMyAvatar(ctx.user, { type: "image/jpeg", bytes: Buffer.alloc(0) }))).toMatchObject({ message: "The image is empty." });
  });

  it("drops an image appended after the picture, and refuses a file that cannot be read (review, 11 October 2026)", async () => {
    const secret = Buffer.from("GPS 6.4541N 3.3947E", "latin1");
    const seg = (marker: number, payload: Buffer) => { const h = Buffer.from([0xff, marker, 0, 0]); h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]); };
    const picture = (exif: Buffer) => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, exif), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x11, 0x22, 0xff, 0xd9])]);
    const appended = Buffer.concat([picture(Buffer.from("Exif\0\0first", "latin1")), picture(Buffer.concat([Buffer.from("Exif\0\0", "latin1"), secret]))]);
    const ctx = await contextFor(a.employee, "company-a");
    const { avatarKey } = await setMyAvatar(ctx.user, { type: "image/jpeg", bytes: appended });
    const stored = (await storage().get(avatarKey))!;
    expect(stored.includes(secret)).toBe(false);
    expect(stored.subarray(stored.length - 4).equals(Buffer.from([0x11, 0x22, 0xff, 0xd9]))).toBe(true);
    const cut = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0x40, 0x00]), secret]);
    expect(await rejects(setMyAvatar(ctx.user, { type: "image/jpeg", bytes: cut }))).toMatchObject({ message: "This image could not be read. Choose another one." });
  });
});
