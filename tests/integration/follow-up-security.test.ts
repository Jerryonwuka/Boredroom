/**
 * Security and privacy review of follow-ups between assistants (personal assistants, phase 4; review, 8 October 2026).
 * Each test pins down one way a follow-up could tell someone more about a colleague than they could already see. They run
 * against the local test database only and never call the model (useModel: false; NODE_ENV test keeps it away anyway).
 *
 * Company A: Olu Owner (owner), Mary HR, David Manager (leads Design: Ada and Ben), Ada Employee, Ben Employee; Ifeoma
 * joined with no team. "Ops checklist" is Ifeoma's task in the Ops project (Ifeoma and Ben), checked by Ben, made by Olu:
 * David is not in Ops and does not lead Ifeoma, so he cannot see it on any page.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { addComment, createProject, createTask, updateTask } from "@/server/services/tasks";
import { localTimeOn, todayLocal } from "@/server/lib/time";
import {
  cancelFollowUp, collectWorkspaceUpdates, createFollowUps, getFollowUp, getFollowUpBatch, processFollowUp, processFollowUpIds, saveFollowUpSettings,
  workspaceUpdatesFor,
} from "@/server/services/follow-ups";
import { teamReportNow } from "@/server/services/daily-report";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let olu: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, ifeoma: OrgContext;
let ops: string;
const org = () => a.ownerCtx.org.id;
const id = (ctx: OrgContext) => ctx.membership.id;
const SECRET = "Board approved buying Acme, keep it quiet";

const refusal = async (ctx: OrgContext, subject: string, taskId: string | null = null) =>
  (await appQueryAs(ctx.user.profileId, "SELECT app_follow_up_refusal($1, $2, $3::uuid) AS r", [org(), subject, taskId]))[0].r as string | null;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Olu Owner" } });
  olu = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const ife = await createVerifiedUser("ifeoma@company-a.test", "Ifeoma Nwosu");
  ifeoma = await joinViaInvitation(a.hrCtx, ife, "employee", null, "EMP-003");
  const opsProject = await createProject(olu, { name: "Ops", description: "Operations", requiresDueDate: false, requiresEstimate: false, memberIds: [id(ifeoma), id(ben)] });
  ops = (await createTask(olu, { projectId: opsProject.id, title: "Ops checklist", expectedOutput: "Done.", assigneeMembershipId: id(ifeoma), reviewerMembershipId: id(ben), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
});

describe("the workspace's collection never shows a lead more than they can see", () => {
  it("does not hand David the title and comment of a task he cannot see", async () => {
    // David cannot see the Ops checklist or its comments on any page.
    expect(await appQueryAs(david.user.profileId, "SELECT id FROM tasks WHERE id = $1", [ops])).toEqual([]);
    // Ben's newest signal today is a comment on it (he checks it).
    await addComment(ben, ops, SECRET);
    // Ada is blocked today, so the collection covers more than Ben and David's report has something to say.
    const version = async () => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0].version;
    await updateTask(ada, a.taskIds.homepage, { expectedVersion: await version(), status: "in_progress" });
    await updateTask(ada, a.taskIds.homepage, { expectedVersion: await version(), status: "blocked", reason: "Waiting on the brand images" });
    expect(await appQueryAs(david.user.profileId, "SELECT id FROM task_comments WHERE task_id = $1", [ops])).toEqual([]);

    const tz = olu.org.timezone;
    const today = todayLocal(tz);
    await adminQuery("INSERT INTO brenda_settings(organisation_id, daily_report_time) VALUES ($1, '23:59') ON CONFLICT (organisation_id) DO UPDATE SET daily_report_time = '23:59'", [org()]);
    await saveFollowUpSettings(olu, { collect: true });
    const c = await collectWorkspaceUpdates({ organisationId: org(), localDate: today, reportAt: localTimeOn(today, "23:59", tz) });
    expect(c.status).toBe("created");
    await processFollowUpIds(c.pendingIds);
    const benRow = (await adminQuery<{ id: string }>("SELECT id FROM follow_ups WHERE batch_id = $1 AND subject_membership_id = $2", [c.batchId, id(ben)]))[0];

    // David reads Ben's workspace update (he leads Ben), on the follow-up's page, in the report's data and in the report.
    const view = await getFollowUp(david, benRow.id);
    expect(view?.viewer).toBe("reader");
    const leaked = JSON.stringify({ facts: view?.facts, answer: view?.answer });
    expect.soft(leaked, "facts/answer shown to David name a task he cannot see").not.toContain("Ops checklist");
    expect.soft(leaked, "facts/answer shown to David quote a comment he cannot see").not.toContain("Acme");

    const updates = await workspaceUpdatesFor(david, today, [id(ben)]);
    expect.soft(JSON.stringify(updates), "the report's Updates data for David").not.toContain("Acme");

    const report = await teamReportNow(david, { useAssistant: false });
    expect(report).toHaveProperty("docId");
    const body = (await adminQuery<{ body: string }>("SELECT body FROM documents WHERE id = $1", [(report as { docId: string }).docId]))[0].body;
    expect.soft(body, "David's team report document").not.toContain("Acme");
  });

  it("does not tell a plain employee how the whole organisation answered", async () => {
    const batch = (await adminQuery<{ id: string; summary: string | null; size: number }>("SELECT id, summary, size FROM follow_up_batches WHERE organisation_id = $1 AND kind = 'workspace'", [org()]))[0];
    // Ada can read her own row only; the batch she gets should not summarise everyone else's.
    const forAda = await getFollowUpBatch(ada, batch.id);
    expect(batch.size).toBeGreaterThanOrEqual(2);
    expect(forAda).not.toBeNull();
    expect(forAda!.items.map((i) => i.subject.membershipId)).toEqual([id(ada)]);
    expect(forAda!.summary ?? null, "organisation-wide summary shown to Ada").toBeNull();
  });
});

describe("the audit trail", () => {
  it("does not show a lead the title of a task they cannot see", async () => {
    // Olu (owner) asks Ben about the Ops checklist: Ben checks it, so it is allowed.
    const r = await createFollowUps(olu, { subjectMembershipIds: [id(ben)], taskId: ops, question: "Where is the Ops checklist?" });
    expect(r.created).toHaveLength(1);
    // David leads Ben, so he reads audit rows about Ben, but he cannot see the task.
    const rows = await appQueryAs(david.user.profileId, "SELECT metadata FROM audit_events WHERE action = 'followup.requested' AND subject_membership_id = $1", [id(ben)]);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((x) => x.metadata)), "followup.requested metadata seen by David").not.toContain("Ops checklist");
  });
});

describe("who may ask", () => {
  it("does not let an employee make anyone followable by naming them as the checker of her own task", async () => {
    // Ada and Ifeoma share no work: Ada may not follow up on her.
    expect(await refusal(ada, id(ifeoma))).toBe("not_allowed");
    // Ada holds "Homepage design" (David made it): as its assignee she may set any active member as its checker.
    const v = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0].version;
    await updateTask(ada, a.taskIds.homepage, { expectedVersion: v, reviewerMembershipId: id(ifeoma) });
    expect(await refusal(ada, id(ifeoma)), "Ada self-granted follow-up rights over Ifeoma").toBe("not_allowed");
  });

  it("does not let one colleague use up the asks a person can be sent in a day", async () => {
    // Ada legitimately shares one task with Ifeoma (the owner made it: Ifeoma holds it, Ada checks it). She asks, cancels
    // and asks again, about the task and about what Ifeoma is working on.
    const NO_MODEL = { useModel: false } as const;
    const shared = (await createTask(olu, { projectId: a.projectId, title: "Vendor list", expectedOutput: "Done.", assigneeMembershipId: id(ifeoma), reviewerMembershipId: id(ada), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
    const askAndCancel = async (taskId: string | null) => {
      const r = await createFollowUps(ada, { subjectMembershipIds: [id(ifeoma)], taskId, question: "Any news?" });
      const fid = r.created[0].id;
      const status = await processFollowUp(fid, NO_MODEL);
      if (status === "asking") await cancelFollowUp(ada, fid);
      return status;
    };
    // Only her first ask reaches Ifeoma; the rest are answered from Ifeoma's work, and say so.
    expect([await askAndCancel(shared), await askAndCancel(shared), await askAndCancel(null), await askAndCancel(null)]).toEqual(["asking", "answered", "answered", "answered"]);
    const asks = await adminQuery<{ read_at: string | null; body: string }>("SELECT read_at, body FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.followup_ask'", [id(ifeoma)]);
    expect(asks).toHaveLength(1);
    // The cancelled ask is closed for Ifeoma: read, and it says why.
    expect(asks[0].read_at).not.toBeNull();
    expect(asks[0].body).toBe("Ada cancelled this follow-up. Nothing more is needed from you.");
    // The owner's own follow-up still reaches her.
    const r = await createFollowUps(olu, { subjectMembershipIds: [id(ifeoma)], taskId: null, question: "What are you on?" });
    const status = await processFollowUp(r.created[0].id, NO_MODEL);
    const row = (await adminQuery<{ capped: boolean }>("SELECT capped FROM follow_ups WHERE id = $1", [r.created[0].id]))[0];
    expect({ status, capped: row.capped }, "the owner's ask after Ada's").toEqual({ status: "asking", capped: false });
  });
});
