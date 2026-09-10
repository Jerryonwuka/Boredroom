/**
 * Shared fixture builder used by the seed script and integration tests.
 * Builds Company A (owner, Mary HR, David manager, Ada employee) and Company B.
 */
import { withSystem, withUser } from "@/server/db";
import { hashPassword } from "@/server/lib/crypto";
import { createOrganisation, createTeam, setTeamMember, createInvitation, acceptInvitation } from "@/server/services/orgs";
import { createProject, createTask } from "@/server/services/tasks";
import type { OrgContext } from "@/server/lib/api";

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
    user: { profileId: user.profileId, authUserId: user.authUserId, email: user.email, displayName: user.displayName, emailVerified: true, sessionId: "fixture" },
    org: { id: row.org_id, slug: row.slug, name: row.name, timezone: row.timezone, current_policy_id: row.current_policy_id, status: row.status },
    membership: { id: row.membership_id, role: row.role, employee_code: row.employee_code },
  };
}

export async function joinViaInvitation(inviter: OrgContext, user: FixtureUser, role: "owner" | "hr" | "manager" | "employee", teamId?: string | null, employeeCode?: string) {
  const inv = await createInvitation(inviter, { email: user.email, role, teamId: teamId ?? null, employeeCode: employeeCode ?? null }, { send: false });
  await acceptInvitation(user.profileId, user.email, inv.token!);
  return contextFor(user, inviter.org.slug);
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
  const project = await createProject(managerCtx, { name: "Website relaunch", description: "Marketing site refresh", requiresDueDate: false, requiresEstimate: false, memberIds: [employeeCtx.membership.id, employee2Ctx.membership.id] });
  const homepage = await createTask(managerCtx, { projectId: project.id, title: "Homepage design", expectedOutput: "Figma link to the approved homepage layout (desktop and mobile).", assigneeMembershipId: employeeCtx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "work", priority: "high", estimateMinutes: 240, dueAt: new Date(Date.now() + 3 * 86400000).toISOString(), captureRequirement: "none", addToMyDay: false });
  const meeting = await createTask(managerCtx, { projectId: project.id, title: "Client kickoff meeting", expectedOutput: "Meeting notes with agreed scope and next steps.", assigneeMembershipId: employeeCtx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "meeting", priority: "normal", estimateMinutes: 60, dueAt: null, captureRequirement: "none", addToMyDay: false });
  const second = await createTask(managerCtx, { projectId: project.id, title: "Pricing page copy", expectedOutput: "Draft copy document for the pricing page.", assigneeMembershipId: employee2Ctx.membership.id, reviewerMembershipId: managerCtx.membership.id, category: "work", priority: "normal", estimateMinutes: 120, dueAt: null, captureRequirement: "none", addToMyDay: false });
  return { slug, owner, hr, manager, employee, employee2, ownerCtx, hrCtx, managerCtx, employeeCtx, employee2Ctx, teamId: team.id, projectId: project.id, taskIds: { homepage: homepage.id, meeting: meeting.id, second: second.id } };
}
