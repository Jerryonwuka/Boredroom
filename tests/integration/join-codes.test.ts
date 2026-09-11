import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, contextFor, type CompanyFixture } from "@/server/services/fixtures";
import { updateJoinCode, previewJoinCode, joinWithCode, createTeam, setTeamMember } from "@/server/services/orgs";
import { createTask } from "@/server/services/tasks";
import { teamBoard, orgDashboard } from "@/server/services/views";

let a: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
});

describe("organisation join codes", () => {
  it("staff can only join with an enabled code; role comes from the code; rotation invalidates the old code", async () => {
    await expect(updateJoinCode(a.employeeCtx, { rotate: true, enabled: true })).rejects.toMatchObject({ status: 403 });
    const team = await createTeam(a.ownerCtx, "Graphics");
    const jc = await updateJoinCode(a.hrCtx, { rotate: true, enabled: true, role: "employee", teamId: team.id });
    expect(jc.join_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const code = jc.join_code!;
    const preview = await previewJoinCode(code.toLowerCase());
    expect(preview).toMatchObject({ name: "Company A", role: "employee", enabled: true });
    expect(await previewJoinCode("ZZZZ-0000")).toBeNull();

    const newbie = await createVerifiedUser("newbie@company-a.test", "New Staff");
    const joined = await joinWithCode(newbie.profileId, ` ${code.toLowerCase()} `);
    expect(joined.orgSlug).toBe("company-a");
    const m = await adminQuery<{ role: string; employee_code: string }>("SELECT role, employee_code FROM memberships WHERE id = $1", [joined.membershipId]);
    expect(m[0].role).toBe("employee");
    expect(m[0].employee_code).toMatch(/^EMP-\d{3}$/);
    // Placed in the code's team, and given access to the team's working project.
    expect(await adminQuery("SELECT 1 FROM team_members WHERE team_id = $1 AND membership_id = $2", [team.id, joined.membershipId])).toHaveLength(1);
    expect(await adminQuery("SELECT 1 FROM project_members pm JOIN teams t ON t.project_id = pm.project_id WHERE t.id = $1 AND pm.membership_id = $2", [team.id, joined.membershipId])).toHaveLength(1);
    await expect(joinWithCode(newbie.profileId, code)).rejects.toMatchObject({ code: "ALREADY_MEMBER" });

    // Paused code cannot be used; rotated code replaces the old one.
    await updateJoinCode(a.ownerCtx, { enabled: false });
    const other = await createVerifiedUser("other@company-a.test", "Other Staff");
    await expect(joinWithCode(other.profileId, code)).rejects.toMatchObject({ code: "JOIN_DISABLED" });
    const rotated = await updateJoinCode(a.ownerCtx, { rotate: true, enabled: true, teamId: null });
    expect(rotated.join_code).not.toBe(code);
    await expect(joinWithCode(other.profileId, code)).rejects.toMatchObject({ status: 404 });
    await joinWithCode(other.profileId, rotated.join_code!);
    // Without a team on the code, the joiner has no team yet.
    const otherCtx = await contextFor(other, "company-a");
    expect(await adminQuery("SELECT 1 FROM team_members WHERE membership_id = $1", [otherCtx.membership.id])).toHaveLength(0);
    // The join code can never hand out owner/HR roles.
    await expect(adminQuery("UPDATE organisations SET join_code_role = 'owner' WHERE id = $1", [a.ownerCtx.org.id])).rejects.toThrow(/check/);
  });

  it("direct self-insert with a wrong code is rejected by RLS even with the org id", async () => {
    const sneaky = await createVerifiedUser("sneaky2@company-a.test", "Sneaky");
    const { appQueryAs } = await import("../helpers/db");
    await expect(appQueryAs(sneaky.profileId, "INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, 'SNK-2', 'employee')", [a.ownerCtx.org.id, sneaky.profileId])).rejects.toThrow(/row-level security/);
  });
});

describe("teams, leads and the team board", () => {
  it("team creation makes a working project; leads create, assign and remove tasks for their team only", async () => {
    const team = await createTeam(a.ownerCtx, "Tech");
    const t = await adminQuery<{ project_id: string }>("SELECT project_id FROM teams WHERE id = $1", [team.id]);
    expect(t[0].project_id).toBeTruthy();
    // Ben becomes the Tech lead (raised to team lead role), Ada joins as staff.
    await setTeamMember(a.hrCtx, team.id, a.employee2Ctx.membership.id, { isManager: true });
    await setTeamMember(a.hrCtx, team.id, a.employeeCtx.membership.id, { isManager: false });
    const ben = await contextFor(a.employee2, "company-a");
    expect(ben.membership.role).toBe("manager");
    const board = await teamBoard(ben, team.id);
    expect(board?.isLead).toBe(true);
    expect(board?.members.map((m) => m.display_name)).toEqual(["Ben Employee", "Ada Employee"]);
    // Lead creates and assigns a task in the team's project.
    const task = await createTask(ben, { projectId: t[0].project_id, title: "Set up CI", expectedOutput: "Green pipeline", assigneeMembershipId: a.employeeCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const after = await teamBoard(ben, team.id);
    expect(after?.tasks.map((x) => x.id)).toContain(task.id);
    // The lead cannot assign into a team they do not lead (David's Design project member without lead rights).
    await expect(createTask(ben, { projectId: a.projectId, title: "Nope", expectedOutput: "x", assigneeMembershipId: a.managerCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false })).rejects.toMatchObject({ status: 403 });
    // Staff see the board but are not leads.
    const adaBoard = await teamBoard(a.employeeCtx, team.id);
    expect(adaBoard?.isLead).toBe(false);
  });

  it("organisation dashboard counts people, teams, connected sessions and tasks", async () => {
    const d = await orgDashboard(a.ownerCtx);
    expect(d.counts.people).toBeGreaterThanOrEqual(5);
    expect(d.counts.teams).toBeGreaterThanOrEqual(3);
    expect(d.teams.find((t) => t.name === "Tech")?.leads).toEqual(["Ben Employee"]);
    await expect(orgDashboard(a.employeeCtx)).resolves.toBeTruthy(); // service returns; page layer restricts to owner/HR
  });
});

describe("staff quick to-dos", () => {
  it("creates a to-do with only a title, in the team project, reviewed by the team lead, planned for today", async () => {
    const { quickTodo } = await import("@/server/services/tasks");
    const { myDay } = await import("@/server/services/views");
    const todo = await quickTodo(a.employeeCtx, { title: "Export final logo files" });
    const row = await adminQuery<{ project_id: string; reviewer_membership_id: string; expected_output: string }>("SELECT project_id, reviewer_membership_id, expected_output FROM tasks WHERE id = $1", [todo.id]);
    expect(row[0].reviewer_membership_id).toBe(a.managerCtx.membership.id);
    expect(row[0].expected_output).toBe("Export final logo files");
    const day = await myDay(a.employeeCtx);
    expect(day.planned.map((t) => t.id)).toContain(todo.id);
    // Organisation accounts cannot add to-dos.
    await expect(quickTodo(a.ownerCtx, { title: "x" })).rejects.toMatchObject({ status: 403 });
    // A member with no team gets a personal to-do project.
    const { createVerifiedUser: mk, contextFor: ctxFor } = await import("@/server/services/fixtures");
    const { updateJoinCode: setCode, joinWithCode: join } = await import("@/server/services/orgs");
    const jc = await setCode(a.ownerCtx, { rotate: true, enabled: true, role: "employee", teamId: null });
    const solo = await mk("solo@company-a.test", "Solo Staff");
    await join(solo.profileId, jc.join_code!);
    const soloCtx = await ctxFor(solo, "company-a");
    const soloTodo = await quickTodo(soloCtx, { title: "Read onboarding docs" });
    const p = await adminQuery<{ name: string }>("SELECT p.name FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1", [soloTodo.id]);
    expect(p[0].name).toBe("Solo Staff's to-dos");
  });
});
