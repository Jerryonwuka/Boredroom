/**
 * The first-run welcome (owner request, 11 October 2026), once migration 0056 is applied: the person's own progress
 * (read, the gate, page views, steps and skipped steps, finishing once, Next steps hidden), what is refused (bad bodies,
 * impersonation), who can read it (nobody but the person: not a colleague, not the owner), "You" done in another
 * workspace, the founder, everything the page shows for staff, a lead and an owner (team data, the notice in force),
 * Next steps (each item's rule, derived from data) and the fixtures' members marked as members from before it.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model, no ElevenLabs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, appQueryAs, resetTestDatabase } from "../helpers/db";
import { buildCompany, contextFor, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createOrganisation, PREVIOUS_DEFAULT_NOTICE, publishPolicy, updateJoinCode, createTeam, createInvitation } from "@/server/services/orgs";
import { quickTodo } from "@/server/services/tasks";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { forget0056 } from "@/server/lib/schema-0056";
import {
  desktopDownloadUrl, finishWelcome, markWelcome, nextStepsFor, welcomeDoneSchema, welcomeGatePath, welcomePatchSchema, welcomeReady, welcomeState, welcomeView,
} from "@/server/services/welcome";
import { WELCOME_WORDS } from "@/lib/welcome";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DESKTOP_DOWNLOAD_URL;

let a: CompanyFixture;
let b: CompanyFixture;
let ada: OrgContext;     // new staff in Design (company A), invited by HR
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { status?: number; code?: string; message?: string }; } };
const finishedEvents = () => adminQuery<{ organisation_id: string; auth_user_id: string | null; contact_id: string | null; payload: Record<string, unknown> }>(
  `SELECT organisation_id, auth_user_id, contact_id, payload FROM platform_events WHERE type = 'WELCOME_FINISHED' ORDER BY occurred_at`);

beforeAll(async () => {
  await resetTestDatabase();
  forget0056();
  a = await buildCompany("a");
  b = await buildCompany("b");
  ada = await joinViaInvitation(a.hrCtx, await createVerifiedUser("ada.obi@company-a.test", "Ada Obi"), "employee", a.teamId, "EMP-101");
});

describe("readiness and the fixtures", () => {
  it("is ready once 0056 is applied", async () => {
    expect(await welcomeReady()).toBe(true);
  });

  it("marks the fixtures' people as members from before the welcome", async () => {
    for (const c of [a.ownerCtx, a.hrCtx, a.managerCtx, a.employeeCtx, a.employee2Ctx, b.ownerCtx]) {
      const s = await welcomeState(c);
      expect(s).toMatchObject({ ready: true, done: true, outcome: "existing" });
      expect(await welcomeGatePath(c)).toBeNull();
      expect(await nextStepsFor(c)).toBeNull();
    }
    // The assistant's setup is left as it was (assistant-profiles.test expects it not done).
    expect((await assistantProfiles(a.employeeCtx)).setupDone).toBe(false);
  });
});

describe("a new member's progress", () => {
  it("starts not done, with nothing saved", async () => {
    expect(await welcomeState(ada)).toEqual({ ready: true, done: false, outcome: null, step: null, skipped: [], shown: 0, nextStepsHidden: false, youDone: false });
    expect(await welcomeGatePath(ada)).toBe("/app/company-a/welcome?auto=1");
  });

  it("counts page views, and the gate stops after the second", async () => {
    expect((await markWelcome(ada, { seen: true })).shown).toBe(1);
    expect(await welcomeGatePath(ada)).toBe("/app/company-a/welcome?auto=1");
    const [row1] = await adminQuery<{ started: string }>(`SELECT welcome_started_at AS started FROM assistant_private WHERE membership_id = $1`, [ada.membership.id]);
    expect(row1.started).toBeTruthy();
    expect((await markWelcome(ada, { seen: true })).shown).toBe(2);
    expect(await welcomeGatePath(ada)).toBeNull();
    const [row2] = await adminQuery<{ started: string }>(`SELECT welcome_started_at AS started FROM assistant_private WHERE membership_id = $1`, [ada.membership.id]);
    expect(row2.started).toBe(row1.started);
  });

  it("keeps the step reached and the steps skipped", async () => {
    const s = await markWelcome(ada, { step: "assistant", skipped: ["you"] });
    expect(s).toMatchObject({ step: "assistant", skipped: ["you"], shown: 2, done: false });
    expect(await markWelcome(ada, { skipped: ["you", "how"] })).toMatchObject({ step: "assistant", skipped: ["you", "how"] });
    expect(await markWelcome(ada, { step: "seen" })).toMatchObject({ step: "seen", skipped: ["you", "how"] });
    expect((await welcomeState(ada)).step).toBe("seen");
  });

  it("refuses bad bodies", () => {
    const bad = [{}, { step: "done" }, { step: "nope" }, { skipped: ["you", "you"] }, { skipped: ["brenda"] }, { skipped: ["you", "assistant", "how", "seen", "team", "you"] },
      { seen: false }, { nextStepsHidden: "yes" }, { step: 3 }, { other: true }];
    for (const body of bad) expect(welcomePatchSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    for (const body of [{ seen: true }, { step: "welcome" }, { step: "team", skipped: [] }, { nextStepsHidden: false }, { skipped: ["team", "you"] }]) {
      expect(welcomePatchSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
    expect(welcomeDoneSchema.safeParse({ outcome: "later" }).success).toBe(false);
    expect(welcomeDoneSchema.safeParse({}).success).toBe(false);
    expect(welcomeDoneSchema.safeParse({ outcome: "done", skipped: ["you", "you"] }).success).toBe(false);
    expect(welcomeDoneSchema.safeParse({ outcome: "skipped", skipped: ["how"] }).success).toBe(true);
  });

  it("is refused while someone is signed in as the person, and never gates them", async () => {
    const as = impersonated(ada);
    expect(await rejects(markWelcome(as, { step: "you" }))).toMatchObject({ status: 403, message: WELCOME_WORDS.errors.impersonated });
    expect(await rejects(finishWelcome(as, { outcome: "done" }))).toMatchObject({ status: 403 });
    expect(await nextStepsFor(as)).toBeNull();
    const fresh = await joinViaInvitation(a.hrCtx, await createVerifiedUser("imp@company-a.test", "Imp Person"), "employee", null, "EMP-102");
    expect(await welcomeGatePath(fresh)).toBe("/app/company-a/welcome?auto=1");
    expect(await welcomeGatePath(impersonated(fresh))).toBeNull();
    expect((await welcomeState(ada)).step).toBe("seen");
  });

  it("finishes once: done, the assistant's setup marked, one event without anyone's id", async () => {
    expect((await assistantProfiles(ada)).setupDone).toBe(false);
    const s = await finishWelcome(ada, { outcome: "done", skipped: ["you"] });
    expect(s).toMatchObject({ ready: true, done: true, outcome: "done", step: "done", skipped: ["you"] });
    expect((await assistantProfiles(ada)).setupDone).toBe(true);
    const [first] = await adminQuery<{ done: string }>(`SELECT welcome_done_at AS done FROM assistant_private WHERE membership_id = $1`, [ada.membership.id]);
    const events = await finishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ organisation_id: a.ownerCtx.org.id, auth_user_id: null, contact_id: null });
    expect(events[0].payload).toMatchObject({ organisationId: a.ownerCtx.org.id, role: "employee", founder: false, outcome: "done", step: "seen", skipped: ["you"] });
    expect(typeof events[0].payload.seconds).toBe("number");
    expect(Object.keys(events[0].payload).sort()).toEqual(["founder", "organisationId", "outcome", "role", "seconds", "skipped", "step"]);
    expect(JSON.stringify(events[0].payload)).not.toContain(ada.user.profileId);
    expect(JSON.stringify(events[0].payload)).not.toContain("Ada");

    // Again: nothing changes, nothing more is recorded.
    expect(await finishWelcome(ada, { outcome: "skipped" })).toMatchObject({ done: true, outcome: "done" });
    const [again] = await adminQuery<{ done: string }>(`SELECT welcome_done_at AS done FROM assistant_private WHERE membership_id = $1`, [ada.membership.id]);
    expect(again.done).toBe(first.done);
    expect(await finishedEvents()).toHaveLength(1);
  });

  it("once done, ignores steps and views but still hides and shows Next steps", async () => {
    const s = await markWelcome(ada, { step: "you", seen: true, skipped: ["how"] });
    expect(s).toMatchObject({ step: "done", shown: 2, skipped: ["you"], done: true });
    expect((await markWelcome(ada, { nextStepsHidden: true })).nextStepsHidden).toBe(true);
    expect((await markWelcome(ada, { nextStepsHidden: true })).nextStepsHidden).toBe(true);
    expect((await markWelcome(ada, { nextStepsHidden: false })).nextStepsHidden).toBe(false);
  });

  it("is the person's alone: a colleague and the owner read nothing of it", async () => {
    const sql = `SELECT welcome_step, welcome_outcome, welcome_shown FROM assistant_private WHERE membership_id = $1`;
    expect(await appQueryAs(a.employee2.profileId, sql, [ada.membership.id])).toEqual([]);
    expect(await appQueryAs(a.owner.profileId, sql, [ada.membership.id])).toEqual([]);
    expect(await appQueryAs(a.hr.profileId, sql, [ada.membership.id])).toEqual([]);
    expect(await appQueryAs(a.manager.profileId, sql, [ada.membership.id])).toEqual([]);
    expect(await appQueryAs(ada.user.profileId, sql, [ada.membership.id])).toEqual([{ welcome_step: "done", welcome_outcome: "done", welcome_shown: 2 }]);
    // Nor can a colleague write it.
    await expect(appQueryAs(a.employee2.profileId, `UPDATE assistant_private SET welcome_step = 'you' WHERE membership_id = $1 RETURNING 1`, [ada.membership.id])).resolves.toEqual([]);
  });
});

describe("You in a second workspace", () => {
  it("is done once finished elsewhere, or once past You elsewhere", async () => {
    const kemi = await createVerifiedUser("kemi@both.test", "Kemi Bello");
    const inA = await joinViaInvitation(a.hrCtx, kemi, "employee", null, "EMP-103");
    const inB = await joinViaInvitation(b.hrCtx, kemi, "employee", null, "EMP-103");
    expect((await welcomeState(inB)).youDone).toBe(false);
    await markWelcome(inA, { step: "you" });
    expect((await welcomeState(inB)).youDone).toBe(false);
    await markWelcome(inA, { step: "assistant" });
    expect((await welcomeState(inB)).youDone).toBe(true);
    expect((await welcomeState(inA)).youDone).toBe(false);

    const tayo = await createVerifiedUser("tayo@both.test", "Tayo Ade");
    const tA = await joinViaInvitation(a.hrCtx, tayo, "employee", null, "EMP-104");
    const tB = await joinViaInvitation(b.hrCtx, tayo, "employee", null, "EMP-104");
    await finishWelcome(tA, { outcome: "skipped" });
    expect((await welcomeState(tB)).youDone).toBe(true);
  });
});

describe("what the page shows", () => {
  it("knows the founder, and nobody else", async () => {
    const olu = await createVerifiedUser("olu@acme.test", "Olu Adeyemi");
    await createOrganisation(olu.profileId, { name: "Acme", slug: "acme", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const founder = await contextFor(olu, "acme");
    const v = await welcomeView(founder, { replay: false });
    expect(v.founder).toBe(true);
    expect(v.role).toBe("owner");
    expect(v.org).toEqual({ slug: "acme", name: "Acme" });
    expect(v.person).toMatchObject({ displayName: "Olu Adeyemi", firstName: "Olu", avatarKey: null, photoFromGoogle: false });
    expect(v.team).toEqual({ isOwner: true, teams: [], joinCode: { code: null, enabled: false, role: "employee", teamId: null }, invitations: 0, members: 0 });
    expect(v.leadFirstName).toBeNull();
    expect(v.ownerFirstName).toBe("Olu");
    expect(v.notice).toMatchObject({ standard: true, outdated: false, version: 1 });
    expect(v.state).toMatchObject({ ready: true, done: false });
    expect(v.replay).toBe(false);
    expect(await welcomeGatePath(founder)).toBe("/app/acme/welcome?auto=1");

    const second = await joinViaInvitation(founder, await createVerifiedUser("funmi@acme.test", "Funmi Owner"), "owner", null, "OWN-002");
    expect((await welcomeView(second, { replay: false })).founder).toBe(false);
    expect((await welcomeView(a.ownerCtx, { replay: false })).founder).toBe(true);
    expect((await welcomeView(a.hrCtx, { replay: false })).founder).toBe(false);

    // The founder's finish is recorded as a founder's.
    await finishWelcome(founder, { outcome: "done" });
    const ev = (await finishedEvents()).find((e) => e.organisation_id === founder.org.id);
    expect(ev?.payload).toMatchObject({ role: "owner", founder: true, outcome: "done" });
  });

  it("gives owners and HR their team's numbers, leaving themselves and the owners out", async () => {
    const owner = (await welcomeView(b.ownerCtx, { replay: false })).team!;
    expect(owner.isOwner).toBe(true);
    expect(owner.teams).toEqual([{ id: b.teamId, name: "Design" }]);
    const hr = (await welcomeView(b.hrCtx, { replay: false })).team!;
    expect(hr.isOwner).toBe(false);
    const [counts] = await adminQuery<{ inv: number; inv_not_mary: number; members: number }>(
      `SELECT (SELECT count(*)::int FROM invitations WHERE organisation_id = $1) AS inv,
              (SELECT count(*)::int FROM invitations WHERE organisation_id = $1 AND lower(email::text) <> 'mary@company-b.test') AS inv_not_mary,
              (SELECT count(*)::int FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role <> 'owner') AS members`, [b.ownerCtx.org.id]);
    expect(owner.invitations).toBe(counts.inv);
    expect(hr.invitations).toBe(counts.inv_not_mary);
    expect(hr.invitations).toBe(owner.invitations - 1);
    expect(owner.members).toBe(counts.members);
    expect(hr.members).toBe(counts.members - 1);
    const code = await updateJoinCode(b.ownerCtx, { enabled: true, role: "manager", teamId: b.teamId });
    expect((await welcomeView(b.hrCtx, { replay: false })).team!.joinCode).toEqual({ code: code.join_code, enabled: true, role: "manager", teamId: b.teamId });
    await updateJoinCode(b.ownerCtx, { enabled: false });
  });

  it("names a staff member's lead, and gives a lead the team they lead", async () => {
    const staff = await welcomeView(ada, { replay: false });
    expect(staff.leadFirstName).toBe("David");
    expect(staff.leadsTeam).toBeNull();
    expect(staff.team).toBeNull();
    expect(staff.ownerFirstName).toBe("Olu");
    const tolu = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("tolu@company-a.test", "Tolu Bakare"), "manager", a.teamId, "MGR-101");
    const lead = await welcomeView(tolu, { replay: false });
    expect(lead.leadsTeam).toEqual({ id: a.teamId, name: "Design" });
    expect(lead.leadFirstName).toBe("David");
    expect(lead.team).toBeNull();
    const david = await welcomeView(a.managerCtx, { replay: false });
    expect(david.leadsTeam).toEqual({ id: a.teamId, name: "Design" });
    expect(david.leadFirstName).toBe("Tolu");
    // Teams passed in by the page are used as they are.
    expect((await welcomeView(ada, { replay: false, teams: [{ id: a.teamId, name: "Design", is_manager: true }] })).leadsTeam).toEqual({ id: a.teamId, name: "Design" });
  });

  it("says whether the notice in force is the standard one or still describes screen recording", async () => {
    await publishPolicy(b.ownerCtx, { noticeText: "Acme's own words about what is tracked here, and what never is.", reminderMinutesBeforeEnd: 30 });
    const custom = await contextFor(b.employee, "company-b");
    expect((await welcomeView(custom, { replay: false })).notice).toMatchObject({ standard: false, outdated: false, version: 2, text: "Acme's own words about what is tracked here, and what never is." });
    await publishPolicy(b.ownerCtx, { noticeText: PREVIOUS_DEFAULT_NOTICE, reminderMinutesBeforeEnd: 30 });
    const old = await contextFor(b.employee, "company-b");
    expect((await welcomeView(old, { replay: false })).notice).toMatchObject({ standard: false, outdated: true, version: 3 });
  });

  it("is a replay only once the welcome is done", async () => {
    expect((await welcomeView(ada, { replay: true })).replay).toBe(true);
    const fresh = await joinViaInvitation(a.hrCtx, await createVerifiedUser("replay@company-a.test", "Ruth Replay"), "employee", null, "EMP-105");
    expect((await welcomeView(fresh, { replay: true })).replay).toBe(false);
  });

  it("offers the Mac download only when it is an https address", () => {
    expect(desktopDownloadUrl({})).toBeNull();
    expect(desktopDownloadUrl({ DESKTOP_DOWNLOAD_URL: "http://boredroom.test/Brenda.dmg" })).toBeNull();
    expect(desktopDownloadUrl({ DESKTOP_DOWNLOAD_URL: "not a url" })).toBeNull();
    expect(desktopDownloadUrl({ DESKTOP_DOWNLOAD_URL: " https://boredroom.test/Brenda.dmg " })).toBe("https://boredroom.test/Brenda.dmg");
  });
});

describe("Next steps", () => {
  it("waits until the welcome is over or has opened twice, then lists only what is left", async () => {
    const sam = await joinViaInvitation(a.hrCtx, await createVerifiedUser("sam@company-a.test", "Sam Staff"), "employee", a.teamId, "EMP-106");
    expect(await nextStepsFor(sam)).toBeNull();
    await markWelcome(sam, { seen: true });
    expect(await nextStepsFor(sam)).toBeNull();
    await markWelcome(sam, { seen: true });
    expect(await nextStepsFor(sam)).toEqual({ left: 2, items: [
      { key: "finish_welcome", label: "Finish your welcome", href: "/app/company-a/welcome", external: false },
      { key: "plan_today", label: "Write today's to-dos", href: "/app/company-a/todos?add=1", external: false },
    ] });
    await finishWelcome(sam, { outcome: "skipped" });
    expect(await nextStepsFor(sam)).toEqual({ left: 1, items: [{ key: "plan_today", label: "Write today's to-dos", href: "/app/company-a/todos?add=1", external: false }] });
    await quickTodo(sam, { title: "Draft the homepage hero" });
    expect(await nextStepsFor(sam)).toBeNull();
  });

  it("counts a work session as planning too, and stays hidden once hidden", async () => {
    const kunle = await joinViaInvitation(a.hrCtx, await createVerifiedUser("kunle@company-a.test", "Kunle Staff"), "employee", a.teamId, "EMP-107");
    await finishWelcome(kunle, { outcome: "done" });
    expect((await nextStepsFor(kunle))?.items.map((i) => i.key)).toEqual(["plan_today"]);
    await markWelcome(kunle, { nextStepsHidden: true });
    expect(await nextStepsFor(kunle)).toBeNull();
    await markWelcome(kunle, { nextStepsHidden: false });
    expect((await nextStepsFor(kunle))?.items.map((i) => i.key)).toEqual(["plan_today"]);
    await adminQuery(
      `INSERT INTO work_sessions(organisation_id, user_id, membership_id, task_id, state, started_at, ended_at)
       VALUES ($1, $2, $3, $4, 'stopped', now() - interval '1 hour', now())`, [a.ownerCtx.org.id, kunle.user.profileId, kunle.membership.id, a.taskIds.homepage]);
    expect(await nextStepsFor(kunle)).toBeNull();
  });

  it("asks a team's lead to assign a first task on the board (no AI here), until they have", async () => {
    const lead = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("lola@company-a.test", "Lola Lead"), "manager", a.teamId, "MGR-102");
    await finishWelcome(lead, { outcome: "done" });
    expect(await nextStepsFor(lead)).toEqual({ left: 1, items: [{ key: "assign_task", label: "Assign a first task", href: `/app/company-a/teams/${a.teamId}`, external: false }] });
    await quickTodo(lead, { title: "Check the mobile layout", assigneeMembershipId: a.employee2Ctx.membership.id });
    expect(await nextStepsFor(lead)).toBeNull();
  });

  it("asks a lead with no team to plan today", async () => {
    const free = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("femi@company-a.test", "Femi Lead"), "manager", null, "MGR-103");
    await finishWelcome(free, { outcome: "done" });
    expect((await nextStepsFor(free))?.items.map((i) => i.key)).toEqual(["plan_today"]);
  });

  it("asks a founder to invite and to create a team, each gone once done", async () => {
    const zee = await createVerifiedUser("zee@zeta.test", "Zee Founder");
    await createOrganisation(zee.profileId, { name: "Zeta", slug: "zeta", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const z = await contextFor(zee, "zeta");
    await finishWelcome(z, { outcome: "done" });
    expect(await nextStepsFor(z)).toEqual({ left: 2, items: [
      { key: "invite_team", label: "Invite your team", href: "/app/zeta/people?tab=people&invite=1", external: false },
      { key: "create_team", label: "Create your first team", href: "/app/zeta/people?tab=teams&new=team", external: false },
    ] });
    await updateJoinCode(z, { enabled: true, role: "employee" });
    expect((await nextStepsFor(z))?.items.map((i) => i.key)).toEqual(["create_team"]);
    await updateJoinCode(z, { enabled: false });
    expect((await nextStepsFor(z))?.items.map((i) => i.key)).toEqual(["invite_team", "create_team"]);
    await createInvitation(z, { email: "someone@zeta.test", role: "employee", teamId: null, employeeCode: null }, { send: false });
    expect((await nextStepsFor(z))?.items.map((i) => i.key)).toEqual(["create_team"]);
    await createTeam(z, "Design");
    expect(await nextStepsFor(z)).toBeNull();
  });

  it("does not count an owner's or HR's own invitation as inviting the team", async () => {
    const yan = await createVerifiedUser("yan@ypsilon.test", "Yan Founder");
    await createOrganisation(yan.profileId, { name: "Ypsilon", slug: "ypsilon", timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const y = await contextFor(yan, "ypsilon");
    await createTeam(y, "Ops");
    const hr = await joinViaInvitation(y, await createVerifiedUser("hr@ypsilon.test", "Hana HR"), "hr", null, "HR-001");
    await finishWelcome(hr, { outcome: "done" });
    expect((await nextStepsFor(hr))?.items.map((i) => i.key)).toEqual(["invite_team"]);
    expect((await welcomeView(hr, { replay: false })).team).toMatchObject({ invitations: 0, members: 0 });
  });

  it("offers the Mac app only with a download set, until a computer is linked", async () => {
    const mo = await joinViaInvitation(a.hrCtx, await createVerifiedUser("mo@company-a.test", "Mo Staff"), "employee", a.teamId, "EMP-108");
    await finishWelcome(mo, { outcome: "done" });
    expect((await nextStepsFor(mo))?.items.map((i) => i.key)).toEqual(["plan_today"]);
    process.env.DESKTOP_DOWNLOAD_URL = "https://boredroom.test/Brenda.dmg";
    try {
      expect((await nextStepsFor(mo))?.items).toEqual([
        { key: "plan_today", label: "Write today's to-dos", href: "/app/company-a/todos?add=1", external: false },
        { key: "mac_app", label: "Get Brenda for Mac", href: "https://boredroom.test/Brenda.dmg", external: true },
      ]);
      await adminQuery(`INSERT INTO auth_sessions(user_id, token_hash, expires_at, kind) VALUES ($1, $2, now() + interval '30 days', 'desktop')`, [mo.user.authUserId, `desktop-${mo.membership.id}`]);
      expect((await nextStepsFor(mo))?.items.map((i) => i.key)).toEqual(["plan_today"]);
    } finally {
      delete process.env.DESKTOP_DOWNLOAD_URL;
    }
  });

  it("never shows for members from before the welcome, even with something left", async () => {
    expect(await nextStepsFor(a.employeeCtx)).toBeNull();
    expect(await nextStepsFor(b.ownerCtx)).toBeNull();
  });
});
