/**
 * Permissions fixes from the security audit (23 October 2026): issues 11, 14, 17 and 18. Each test here fails on the code
 * before the fix. 0063 (the database's mirror of 11 and 18) is now applied by the reset too; the last block applies it
 * again (idempotent) and checks the database refuses on its own.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(),
}));

import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTask, updateTask, quickTodo, setProjectMember, hasLeadRights } from "@/server/services/tasks";
import { changeRole, revokeMembership } from "@/server/services/orgs";
import { startImpersonation } from "@/server/admin/ops";
import type { Admin } from "@/server/admin/auth";
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let loner: OrgContext; // staff with no team
let loneProject: string; // their personal to-do project

const taskInput = (projectId: string, extra: Record<string, unknown> = {}) => ({
  projectId, title: "Do the thing", expectedOutput: "The thing, done.", category: "work" as const, priority: "normal" as const, addToMyDay: false, ...extra,
});

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  const u = await createVerifiedUser("loner@company-a.test", "Lone Employee");
  loner = await joinViaInvitation(a.hrCtx, u, "employee", null, "EMP-009");
  const own = await quickTodo(loner, { title: "My own to-do" });
  loneProject = (await adminQuery<{ project_id: string }>("SELECT project_id FROM tasks WHERE id = $1", [own.id]))[0].project_id;
});

describe("issue 11: a personal to-do project grants staff no lead rights", () => {
  it("the personal project exists, made by app_create_personal_project with the employee as lead", async () => {
    const rows = await adminQuery<{ access_role: string }>("SELECT access_role FROM project_members WHERE project_id = $1 AND membership_id = $2", [loneProject, loner.membership.id]);
    expect(rows[0]?.access_role).toBe("lead");
    expect(await withUser(loner.user.profileId, (db) => hasLeadRights(db, loner, loneProject))).toBe(false);
  });

  it("staff cannot file a task for a colleague or the owner, even in their own project", async () => {
    await expect(createTask(loner, taskInput(loneProject, { assigneeMembershipId: a.employee2Ctx.membership.id, reviewerMembershipId: loner.membership.id }))).rejects.toMatchObject({ status: 403 });
    await expect(createTask(loner, taskInput(loneProject, { assigneeMembershipId: a.ownerCtx.membership.id }))).rejects.toMatchObject({ status: 403 });
    const n = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE created_by = $1 AND assignee_membership_id <> $1", [loner.membership.id]);
    expect(n[0].n).toBe(0);
  });

  it("staff cannot file a task for themselves and then hand it on", async () => {
    const own = await createTask(loner, taskInput(loneProject));
    await expect(updateTask(loner, own.id, { expectedVersion: own.version, assigneeMembershipId: a.employee2Ctx.membership.id })).rejects.toMatchObject({ status: 403 });
  });

  it("staff cannot make colleagues lead of their project (setProjectMember)", async () => {
    await expect(setProjectMember(loner, loneProject, a.employee2Ctx.membership.id, "lead")).rejects.toMatchObject({ status: 403 });
    const rows = await adminQuery("SELECT 1 FROM project_members WHERE project_id = $1 AND membership_id = $2", [loneProject, a.employee2Ctx.membership.id]);
    expect(rows).toHaveLength(0);
  });

  it("team leads keep handing work out, and keep lead rights on their own projects", async () => {
    const handed = await quickTodo(a.managerCtx, { title: "Check the copy", assigneeMembershipId: a.employeeCtx.membership.id });
    expect(handed.id).toBeTruthy();
    expect(await withUser(a.manager.profileId, (db) => hasLeadRights(db, a.managerCtx, a.projectId))).toBe(true);
    // A manager who leads the project may still manage who is on it; a manager who does not, may not.
    await setProjectMember(a.managerCtx, a.projectId, loner.membership.id, "viewer");
    const outsider = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("lead2@company-a.test", "Other Lead"), "manager", null, "MGR-002");
    await expect(setProjectMember(outsider, a.projectId, loner.membership.id, "lead")).rejects.toMatchObject({ status: 403 });
  });
});

describe("issue 17: only managers change a task's reviewer", () => {
  it("the assignee cannot route their task to a friendly peer", async () => {
    const t = (await adminQuery<{ version: number; reviewer_membership_id: string }>("SELECT version, reviewer_membership_id FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0];
    await expect(updateTask(a.employeeCtx, a.taskIds.homepage, { expectedVersion: t.version, reviewerMembershipId: a.employee2Ctx.membership.id })).rejects.toMatchObject({ status: 403 });
    await expect(updateTask(a.employeeCtx, a.taskIds.homepage, { expectedVersion: t.version, reviewerMembershipId: null })).rejects.toMatchObject({ status: 403 });
    // Sending the reviewer unchanged (with another edit) is not a change, so it still saves.
    await updateTask(a.employeeCtx, a.taskIds.homepage, { expectedVersion: t.version, reviewerMembershipId: t.reviewer_membership_id, priority: "urgent" });
    const after = (await adminQuery<{ reviewer_membership_id: string }>("SELECT reviewer_membership_id FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0];
    expect(after.reviewer_membership_id).toBe(a.managerCtx.membership.id);
  });

  it("the manager can change it", async () => {
    const t = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.second]))[0];
    await updateTask(a.managerCtx, a.taskIds.second, { expectedVersion: t.version, reviewerMembershipId: a.employeeCtx.membership.id });
    const after = (await adminQuery<{ reviewer_membership_id: string }>("SELECT reviewer_membership_id FROM tasks WHERE id = $1", [a.taskIds.second]))[0];
    expect(after.reviewer_membership_id).toBe(a.employeeCtx.membership.id);
  });

  it("staff filing their own task get their team lead as reviewer, not a peer they pick", async () => {
    await expect(createTask(a.employeeCtx, taskInput(a.projectId, { reviewerMembershipId: a.employee2Ctx.membership.id }))).rejects.toMatchObject({ status: 403 });
    expect((await createTask(a.employeeCtx, taskInput(a.projectId, { reviewerMembershipId: a.managerCtx.membership.id }))).id).toBeTruthy();
    expect((await createTask(a.employeeCtx, taskInput(a.projectId, { reviewerMembershipId: null }))).id).toBeTruthy();
  });
});

describe("issue 18: changes to HR memberships are owner-only", () => {
  let hr2: OrgContext;
  beforeAll(async () => {
    hr2 = await joinViaInvitation(a.ownerCtx, await createVerifiedUser("hr2@company-a.test", "Second HR"), "hr", null, "HR-002");
  });

  it("HR cannot demote or offboard another HR admin", async () => {
    await expect(changeRole(a.hrCtx, hr2.membership.id, "employee")).rejects.toMatchObject({ status: 403 });
    await expect(revokeMembership(a.hrCtx, hr2.membership.id)).rejects.toMatchObject({ status: 403 });
    const row = (await adminQuery<{ role: string; status: string }>("SELECT role, status FROM memberships WHERE id = $1", [hr2.membership.id]))[0];
    expect(row).toEqual({ role: "hr", status: "active" });
  });

  it("HR still manages staff, and the owner still manages HR", async () => {
    await changeRole(a.hrCtx, loner.membership.id, "manager");
    await changeRole(a.hrCtx, loner.membership.id, "employee");
    await changeRole(a.ownerCtx, hr2.membership.id, "manager");
    const row = (await adminQuery<{ role: string }>("SELECT role FROM memberships WHERE id = $1", [hr2.membership.id]))[0];
    expect(row.role).toBe("manager");
    await changeRole(a.ownerCtx, hr2.membership.id, "hr");
  });
});

describe("issue 14: impersonation is stamped on the customer's audit rows", () => {
  it("records the session as an impersonation and marks what staff do while in it", async () => {
    const staff = await createVerifiedUser("support@boredroom.test", "Support Person");
    await adminQuery("INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, 'support', 'active')", [staff.authUserId]);
    const admin = { user: { authUserId: staff.authUserId }, adminId: "x", role: "support", permissions: new Set(), ip: null } as unknown as Admin;
    const imp = await startImpersonation(admin, a.manager.authUserId, "Customer asked for help with a task", {});

    const signIn = await adminQuery<{ metadata: Record<string, unknown> }>(
      "SELECT a.metadata FROM audit_events a JOIN auth_sessions s ON s.id = a.subject_id WHERE a.action = 'auth.sign_in' AND s.impersonation_id = $1", [imp.impersonationId]);
    expect(signIn[0].metadata).toMatchObject({ method: "impersonation", impersonationId: imp.impersonationId });

    // The same action, once in the impersonated session's request and once outside any request.
    const t = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.meeting]))[0];
    reqState.cookie = imp.token;
    try {
      await updateTask(a.managerCtx, a.taskIds.meeting, { expectedVersion: t.version, priority: "high" }, "req-impersonated");
    } finally {
      reqState.cookie = null;
    }
    await updateTask(a.managerCtx, a.taskIds.meeting, { expectedVersion: t.version + 1, priority: "low" }, "req-own");
    const rows = await adminQuery<{ request_id: string; metadata: Record<string, unknown> }>(
      "SELECT request_id, metadata FROM audit_events WHERE request_id IN ('req-impersonated', 'req-own')");
    const byReq = Object.fromEntries(rows.map((r) => [r.request_id, r.metadata]));
    expect(byReq["req-impersonated"]).toMatchObject({ impersonationId: imp.impersonationId });
    expect(byReq["req-own"]).not.toHaveProperty("impersonationId");
  });
});

describe("0063: the database says the same", () => {
  beforeAll(async () => {
    await adminQuery(readFileSync("db/migrations/0063_permissions_hardening.sql", "utf8"));
  });

  it("row security refuses staff filing tasks for others in their personal project, or adding its members", async () => {
    await expect(appQueryAs(loner.user.profileId,
      `INSERT INTO tasks(organisation_id, project_id, assignee_membership_id, reviewer_membership_id, created_by, title, expected_output) VALUES ($1, $2, $3, $4, $4, 'x', 'x')`,
      [a.ownerCtx.org.id, loneProject, a.employee2Ctx.membership.id, loner.membership.id])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(loner.user.profileId,
      `INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'lead')`,
      [a.ownerCtx.org.id, loneProject, a.employee2Ctx.membership.id])).rejects.toThrow(/row-level security/);
    // Their own to-dos still work, and a team lead's lead rights are unchanged.
    expect((await createTask(loner, taskInput(loneProject))).id).toBeTruthy();
    const lead = await appQueryAs(a.manager.profileId, "SELECT app_is_project_lead($1, $2) AS v", [a.ownerCtx.org.id, a.projectId]);
    expect(lead[0].v).toBe(true);
  });

  it("the role trigger refuses HR changing another HR membership, and lets the owner", async () => {
    const hr2 = (await adminQuery<{ id: string }>("SELECT m.id FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE p.email = 'hr2@company-a.test'"))[0].id;
    await expect(appQueryAs(a.hr.profileId, "UPDATE memberships SET status = 'revoked', revoked_at = now() WHERE id = $1", [hr2])).rejects.toThrow(/ROLE_GRANT_FORBIDDEN/);
    await expect(appQueryAs(a.hr.profileId, "UPDATE memberships SET role = 'employee' WHERE id = $1", [hr2])).rejects.toThrow(/ROLE_GRANT_FORBIDDEN/);
    await appQueryAs(a.owner.profileId, "UPDATE memberships SET role = 'manager' WHERE id = $1", [hr2]);
    // HR still changes staff.
    await appQueryAs(a.hr.profileId, "UPDATE memberships SET role = 'manager' WHERE id = $1", [loner.membership.id]);
  });
});
