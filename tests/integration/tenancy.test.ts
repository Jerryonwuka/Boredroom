import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, appQueryAs, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, type CompanyFixture } from "@/server/services/fixtures";
import { createInvitation, acceptInvitation, changeRole, revokeMembership, previewInvitation } from "@/server/services/orgs";
import { createTask, updateTask } from "@/server/services/tasks";
import { startSession } from "@/server/services/sessions";
import { withUser } from "@/server/db";

let a: CompanyFixture;
let b: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
});

describe("A01 cross-tenant isolation", () => {
  it("company A employee cannot read a company B task through RLS or services", async () => {
    const rows = await appQueryAs(a.employee.profileId, "SELECT id FROM tasks WHERE id = $1", [b.taskIds.homepage]);
    expect(rows).toHaveLength(0);
    // The same id looks non-existent through the service layer (no existence leak).
    await expect(updateTask(a.employeeCtx, b.taskIds.homepage, { expectedVersion: 1, title: "x" })).rejects.toMatchObject({ status: 404 });
    // Direct insert linking A's membership to B's task is rejected by composite FKs even as a privileged writer.
    await expect(adminQuery(`INSERT INTO daily_plan_items(organisation_id, membership_id, local_date, task_id) VALUES ($1, $2, CURRENT_DATE, $3)`,
      [a.ownerCtx.org.id, a.employeeCtx.membership.id, b.taskIds.homepage])).rejects.toThrow(/foreign key/);
  });

  it("company A staff cannot start a session on a company B task; organisation accounts cannot run timers at all", async () => {
    await expect(startSession(a.employeeCtx, { taskId: b.taskIds.homepage, captureMode: "none" })).rejects.toMatchObject({ status: 404 });
    await expect(startSession(a.ownerCtx, { taskId: a.taskIds.homepage, captureMode: "none" })).rejects.toMatchObject({ status: 403 });
  });

  it("organisation list only shows the caller's workspaces", async () => {
    const rows = await appQueryAs(a.employee.profileId, "SELECT slug FROM organisations ORDER BY slug");
    expect(rows.map((r) => r.slug)).toEqual(["company-a"]);
  });
});

describe("A02 manager scope", () => {
  it("a manager cannot read work sessions of an employee outside their teams", async () => {
    // Ben is in David's team; move Ben out and check.
    await adminQuery("DELETE FROM team_members WHERE membership_id = $1", [a.employee2Ctx.membership.id]);
    const s = await startSession(a.employee2Ctx, { taskId: a.taskIds.second, captureMode: "none" });
    const asManager = await appQueryAs(a.manager.profileId, "SELECT id FROM work_sessions WHERE id = $1", [s.id]);
    expect(asManager).toHaveLength(0);
    const asHr = await appQueryAs(a.hr.profileId, "SELECT id FROM work_sessions WHERE id = $1", [s.id]);
    expect(asHr).toHaveLength(1);
    const asSelf = await appQueryAs(a.employee2.profileId, "SELECT id FROM work_sessions WHERE id = $1", [s.id]);
    expect(asSelf).toHaveLength(1);
    // restore team membership for later tests
    await adminQuery("INSERT INTO team_members(organisation_id, team_id, membership_id) VALUES ($1, $2, $3)", [a.ownerCtx.org.id, a.teamId, a.employee2Ctx.membership.id]);
    await adminQuery("UPDATE session_intervals SET ended_at = now() WHERE session_id = $1 AND ended_at IS NULL", [s.id]);
    await adminQuery("UPDATE work_sessions SET state = 'stopped', ended_at = now() WHERE id = $1", [s.id]);
  });
});

describe("A03 invitations", () => {
  it("rejects reuse, expiry, revocation and wrong email", async () => {
    const newcomer = await createVerifiedUser("new@company-a.test", "New Person");
    const other = await createVerifiedUser("other@company-a.test", "Other Person");
    const inv = await createInvitation(a.hrCtx, { email: newcomer.email, role: "employee", teamId: a.teamId, employeeCode: null }, { send: false });
    // A different signed-in email cannot even see the invitation row (RLS), so acceptance fails without leaking it.
    await expect(acceptInvitation(other.profileId, other.email, inv.token!)).rejects.toMatchObject({ status: 404 });
    await acceptInvitation(newcomer.profileId, newcomer.email, inv.token!);
    await expect(acceptInvitation(newcomer.profileId, newcomer.email, inv.token!)).rejects.toMatchObject({ code: "INVITE_USED" });
    const members = await adminQuery("SELECT count(*)::int AS n FROM memberships WHERE user_id = $1", [newcomer.profileId]);
    expect(members[0].n).toBe(1);

    const expired = await createInvitation(a.hrCtx, { email: "late@company-a.test", role: "employee", teamId: null, employeeCode: null }, { send: false });
    await adminQuery("UPDATE invitations SET expires_at = now() - interval '1 hour' WHERE id = $1", [expired.id]);
    const late = await createVerifiedUser("late@company-a.test", "Late Person");
    await expect(acceptInvitation(late.profileId, late.email, expired.token!)).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    expect((await previewInvitation(expired.token!))?.state).toBe("expired");

    const revoked = await createInvitation(a.hrCtx, { email: "rev@company-a.test", role: "employee", teamId: null, employeeCode: null }, { send: false });
    await adminQuery("UPDATE invitations SET revoked_at = now() WHERE id = $1", [revoked.id]);
    const rev = await createVerifiedUser("rev@company-a.test", "Rev Person");
    await expect(acceptInvitation(rev.profileId, rev.email, revoked.token!)).rejects.toMatchObject({ code: "INVITE_REVOKED" });
  });

  it("HR cannot invite owners or HR; role escalation via direct insert is blocked", async () => {
    await expect(createInvitation(a.hrCtx, { email: "x@company-a.test", role: "owner", teamId: null, employeeCode: null }, { send: false })).rejects.toMatchObject({ status: 403 });
    // Employee invited as employee tries to insert an owner membership for themselves directly.
    const sneaky = await createVerifiedUser("sneaky@company-a.test", "Sneaky");
    await createInvitation(a.hrCtx, { email: sneaky.email, role: "employee", teamId: null, employeeCode: null }, { send: false });
    await expect(appQueryAs(sneaky.profileId, "INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, 'SNK-1', 'owner')", [a.ownerCtx.org.id, sneaky.profileId])).rejects.toThrow();
  });
});

describe("A23 last owner and role changes", () => {
  it("refuses to demote or offboard the last owner", async () => {
    await expect(changeRole(a.hrCtx, a.ownerCtx.membership.id, "employee")).rejects.toMatchObject({ status: 403 });
    await expect(adminQuery("UPDATE memberships SET role = 'employee' WHERE id = $1", [a.ownerCtx.membership.id])).rejects.toThrow(/LAST_OWNER/);
    await expect(revokeMembership(a.hrCtx, a.ownerCtx.membership.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("A19 offboarding", () => {
  it("revokes access, interrupts the open session at the confirmed boundary and keeps history", async () => {
    const victim = await createVerifiedUser("leaver@company-a.test", "Leaver");
    const inv = await createInvitation(a.hrCtx, { email: victim.email, role: "employee", teamId: a.teamId, employeeCode: null }, { send: false });
    const { membershipId } = await acceptInvitation(victim.profileId, victim.email, inv.token!);
    const ctx = { ...a.employeeCtx, user: { ...a.employeeCtx.user, profileId: victim.profileId, email: victim.email, displayName: "Leaver" }, membership: { id: membershipId, role: "employee" as const, employee_code: "X" } };
    const task = await createTask(a.managerCtx, { projectId: a.projectId, title: "Leaver task", expectedOutput: "Something", assigneeMembershipId: membershipId, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const s = await startSession(ctx, { taskId: task.id, captureMode: "none" });
    // Simulate a session that started 20 minutes ago and last heartbeat 10 minutes ago.
    await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE session_intervals SET started_at = now() - interval '20 minutes' WHERE session_id = $1", [s.id]);
    await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE work_sessions SET started_at = now() - interval '20 minutes', last_heartbeat_at = now() - interval '10 minutes' WHERE id = $1", [s.id]);
    await revokeMembership(a.hrCtx, membershipId);
    const after = await adminQuery<{ state: string; ended: string; hb: string }>("SELECT s.state, i.ended_at AS ended, s.last_heartbeat_at AS hb FROM work_sessions s JOIN session_intervals i ON i.session_id = s.id WHERE s.id = $1", [s.id]);
    expect(after[0].state).toBe("stopped");
    expect(new Date(after[0].ended).getTime()).toBe(new Date(after[0].hb).getTime());
    const visible = await withUser(victim.profileId, (db) => db.query("SELECT id FROM organisations"));
    expect(visible).toHaveLength(0);
    const history = await adminQuery("SELECT count(*)::int AS n FROM session_intervals WHERE session_id = $1", [s.id]);
    expect(history[0].n).toBe(1);
  });
});
