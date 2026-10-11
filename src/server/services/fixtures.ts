/**
 * Shared fixture builder used by the seed script and integration tests.
 * Builds Company A (owner, Mary HR, David manager, Ada employee) and Company B.
 */
import { withSystem, withUser } from "@/server/db";
import { hashPassword } from "@/server/lib/crypto";
import { createOrganisation, createTeam, setTeamMember, createInvitation, acceptInvitation } from "@/server/services/orgs";
import { createProject, createTask } from "@/server/services/tasks";
import type { OrgContext } from "@/server/lib/api";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { schema0056Ready } from "@/server/lib/schema-0056";

export type FixtureUser = { profileId: string; authUserId: string; email: string; displayName: string; password: string };

export async function createVerifiedUser(email: string, displayName: string, password = "correct-horse-battery"): Promise<FixtureUser> {
  const hash = await hashPassword(password);
  return withSystem(async (db) => {
    const u = await db.one<{ id: string }>(`INSERT INTO auth_users(email, password_hash, email_verified_at) VALUES ($1, $2, now()) RETURNING id`, [email, hash]);
    const p = await db.one<{ id: string }>(`INSERT INTO profiles(auth_user_id, display_name, email) VALUES ($1, $2, $3) RETURNING id`, [u.id, displayName, email]);
    return { profileId: p.id, authUserId: u.id, email, displayName, password };
  });
}

export async function contextFor(user: FixtureUser, orgSlug: string): Promise<OrgContext> {
  const row = await withUser(user.profileId, (db) => db.one<{ org_id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string; membership_id: string; role: OrgContext["membership"]["role"]; employee_code: string }>(
    `SELECT o.id AS org_id, o.slug, o.name, o.timezone, o.current_policy_id, o.status, m.id AS membership_id, m.role, m.employee_code
     FROM organisations o JOIN memberships m ON m.organisation_id = o.id WHERE o.slug = $1 AND m.user_id = $2 AND m.status = 'active'`, [orgSlug, user.profileId]));
  return {
    user: { profileId: user.profileId, authUserId: user.authUserId, email: user.email, displayName: user.displayName, emailVerified: true, sessionId: "fixture", avatarKey: null, title: null, statusText: null, presence: "active" },
    org: { id: row.org_id, slug: row.slug, name: row.name, timezone: row.timezone, current_policy_id: row.current_policy_id, status: row.status },
    membership: { id: row.membership_id, role: row.role, employee_code: row.employee_code },
    plan: await withSystem((db) => resolveEntitlements(db, row.org_id)),
  };
}

export async function joinViaInvitation(inviter: OrgContext, user: FixtureUser, role: "owner" | "hr" | "manager" | "employee", teamId?: string | null, employeeCode?: string) {
  const inv = await createInvitation(inviter, { email: user.email, role, teamId: teamId ?? null, employeeCode: employeeCode ?? null }, { send: false });
  await acceptInvitation(user.profileId, user.email, inv.token!);
  return contextFor(user, inviter.org.slug);
}

/**
 * The fixture companies' people have used Boredroom before (owner request, 11 October 2026: the first-run welcome): once
 * migration 0056 is applied they are marked as it marks everyone already a member ('existing'), so seeded accounts and
 * the browser tests open straight onto their pages. Rows already there keep their values; the assistant's setup is left
 * as it is (assistant-profiles.test expects it not done). Before 0056 nothing is marked. Members that tests add later
 * (joinViaInvitation) are new and get the welcome.
 */
export async function markWelcomeDone(membershipIds: string[]): Promise<void> {
  if (!membershipIds.length) return;
  await withSystem(async (db) => {
    if (!(await schema0056Ready(db))) return;
    await db.query(
      `INSERT INTO assistant_private(membership_id, organisation_id, welcome_done_at, welcome_outcome)
       SELECT m.id, m.organisation_id, now(), 'existing' FROM memberships m WHERE m.id = ANY($1::uuid[])
       ON CONFLICT (membership_id) DO UPDATE
         SET welcome_done_at = COALESCE(assistant_private.welcome_done_at, EXCLUDED.welcome_done_at),
             welcome_outcome = COALESCE(assistant_private.welcome_outcome, EXCLUDED.welcome_outcome)`, [membershipIds]);
  });
}

/**
 * The fixture companies' "someone joined" notifications are history as well (integration of the first-run welcome,
 * 11 October 2026): their people joined long before anyone looked, so a seeded owner's bell does not open on four unread
 * "… joined as …" lines, and tests that count a supervisor's unread notifications see what they saw before. Marked read
 * by each recipient (only a recipient may update their own notifications). Joins that tests make later notify as usual.
 */
export async function readFixtureJoins(recipients: OrgContext[], joinedMembershipIds: string[]): Promise<void> {
  for (const r of recipients) {
    await withUser(r.user.profileId, (db) => db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE type = 'member.joined' AND recipient_membership_id = $1 AND resource_id = ANY($2::uuid[])`,
      [r.membership.id, joinedMembershipIds]));
  }
}

export type CompanyFixture = {
  slug: string;
  owner: FixtureUser; hr: FixtureUser; manager: FixtureUser; employee: FixtureUser; employee2: FixtureUser;
  ownerCtx: OrgContext; hrCtx: OrgContext; managerCtx: OrgContext; employeeCtx: OrgContext; employee2Ctx: OrgContext;
  teamId: string; projectId: string; taskIds: { homepage: string; meeting: string; second: string };
};

export async function buildCompany(prefix: "a" | "b", opts: { names?: Partial<Record<"owner" | "hr" | "manager" | "employee" | "employee2", string>> } = {}): Promise<CompanyFixture> {
  const n = { owner: "Olu Owner", hr: "Mary HR", manager: "David Manager", employee: "Ada Employee", employee2: "Ben Employee", ...(opts.names ?? {}) };
  const domain = prefix === "a" ? "company-a.test" : "company-b.test";
  const owner = await createVerifiedUser(`owner@${domain}`, n.owner);
  const hr = await createVerifiedUser(`mary@${domain}`, n.hr);
  const manager = await createVerifiedUser(`david@${domain}`, n.manager);
  const employee = await createVerifiedUser(`ada@${domain}`, n.employee);
  const employee2 = await createVerifiedUser(`ben@${domain}`, n.employee2);
  const slug = prefix === "a" ? "company-a" : "company-b";
  await createOrganisation(owner.profileId, { name: prefix === "a" ? "Company A" : "Company B", slug, timezone: "Africa/Lagos", employeeCode: "OWN-001" });
  const ownerCtx = await contextFor(owner, slug);
  const team = await createTeam(ownerCtx, "Design");
  const hrCtx = await joinViaInvitation(ownerCtx, hr, "hr", null, "HR-001");
  const managerCtx = await joinViaInvitation(ownerCtx, manager, "manager", team.id, "MGR-001");
  const employeeCtx = await joinViaInvitation(hrCtx, employee, "employee", team.id, "EMP-001");
  const employee2Ctx = await joinViaInvitation(hrCtx, employee2, "employee", team.id, "EMP-002");
  await setTeamMember(ownerCtx, team.id, managerCtx.membership.id, { isManager: true });
  await markWelcomeDone([ownerCtx, hrCtx, managerCtx, employeeCtx, employee2Ctx].map((c) => c.membership.id));
  await readFixtureJoins([ownerCtx, hrCtx, managerCtx], [hrCtx, managerCtx, employeeCtx, employee2Ctx].map((c) => c.membership.id));
  const project = await createProject(managerCtx, { name: "Website relaunch", description: "Marketing site refresh", requiresDueDate: false, requiresEstimate: false, memberIds: [employeeCtx.membership.id, employee2Ctx.membership.id] });
  const homepage = await createTask(managerCtx, { projectId: project.id, title: "Homepage design", expectedOutput: "Figma link to the approved homepage layout (desktop and mobile).", assigneeMembershipId: employeeCtx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "work", priority: "high", estimateMinutes: 240, dueAt: new Date(Date.now() + 3 * 86400000).toISOString(), addToMyDay: false });
  const meeting = await createTask(managerCtx, { projectId: project.id, title: "Client kickoff meeting", expectedOutput: "Meeting notes with agreed scope and next steps.", assigneeMembershipId: employeeCtx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "meeting", priority: "normal", estimateMinutes: 60, dueAt: null, addToMyDay: false });
  const second = await createTask(managerCtx, { projectId: project.id, title: "Pricing page copy", expectedOutput: "Draft copy document for the pricing page.", assigneeMembershipId: employee2Ctx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "work", priority: "normal", estimateMinutes: 120, dueAt: null, addToMyDay: false });
  return { slug, owner, hr, manager, employee, employee2, ownerCtx, hrCtx, managerCtx, employeeCtx, employee2Ctx, teamId: team.id, projectId: project.id, taskIds: { homepage: homepage.id, meeting: meeting.id, second: second.id } };
}
