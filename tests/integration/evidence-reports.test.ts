import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { submitTask, reviewSubmission, uploadDeliverableFile, authoriseDeliverableDownload, scanDeliverable } from "@/server/services/evidence";
import { requestAdjustment, reviewAdjustment, exportTimesheetsCsv, timesheetForDate } from "@/server/services/reports";
import { startSession, stopSession } from "@/server/services/sessions";
import { updateTask, createTask } from "@/server/services/tasks";
import { todayLocal } from "@/server/lib/time";
import { storage } from "@/server/lib/storage";

let a: CompanyFixture;
let b: CompanyFixture;

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
});

async function taskVersion(id: string) { return (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [id]))[0].version; }

describe("A10 / A11 evidence and review", () => {
  it("keeps both revisions and reviews; task completes only on approval; self-approval rejected", async () => {
    const t = a.taskIds.homepage;
    // Ada submits revision 1 with a Figma link.
    const r1 = await submitTask(a.employeeCtx, t, { note: "First pass", links: [{ url: "https://www.figma.com/file/abc", notes: "Homepage v1" }], fileIds: [] });
    expect(r1.revision).toBe(1);
    expect((await adminQuery<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [t]))[0].status).toBe("in_review");
    // Self-review is rejected (service and DB).
    await expect(reviewSubmission(a.employeeCtx, r1.submissionId, { decision: "approved", note: "" })).rejects.toMatchObject({ status: 403 });
    await expect(adminQuery("INSERT INTO reviews(organisation_id, submission_id, reviewer_membership_id, decision) VALUES ($1, $2, $3, 'approved')", [a.ownerCtx.org.id, r1.submissionId, a.employeeCtx.membership.id])).rejects.toThrow(/SELF_REVIEW/);
    // Organisation accounts may keep a task for themselves (owner decision, 25 September 2026), but they supervise: no timers.
    const ownerTask = await createTask(a.ownerCtx, { projectId: a.projectId, title: "Owner task", expectedOutput: "x", reviewerMembershipId: a.managerCtx.membership.id, category: "work", priority: "normal", addToMyDay: false });
    expect((await adminQuery<{ assignee_membership_id: string }>("SELECT assignee_membership_id FROM tasks WHERE id = $1", [ownerTask.id]))[0].assignee_membership_id).toBe(a.ownerCtx.membership.id);
    const { startSession: start } = await import("@/server/services/sessions");
    await expect(start(a.ownerCtx, { taskId: t })).rejects.toMatchObject({ status: 403 });
    // David requests changes.
    const rv1 = await reviewSubmission(a.managerCtx, r1.submissionId, { decision: "changes_requested", note: "Mobile layout missing" });
    expect(rv1.taskStatus).toBe("in_progress");
    // Ada resubmits, David approves.
    const r2 = await submitTask(a.employeeCtx, t, { note: "Added mobile", links: [{ url: "https://www.figma.com/file/abc?node=2", notes: "v2" }], fileIds: [] });
    expect(r2.revision).toBe(2);
    await expect(reviewSubmission(a.managerCtx, r1.submissionId, { decision: "approved", note: "" })).rejects.toMatchObject({ code: "STALE_REVISION" });
    const rv2 = await reviewSubmission(a.managerCtx, r2.submissionId, { decision: "approved", note: "" });
    expect(rv2.taskStatus).toBe("completed");
    const subs = await adminQuery("SELECT revision FROM task_submissions WHERE task_id = $1 ORDER BY revision", [t]);
    expect(subs.map((s) => s.revision)).toEqual([1, 2]);
    const reviews = await adminQuery<{ decision: string }>("SELECT decision FROM reviews r JOIN task_submissions s ON s.id = r.submission_id WHERE s.task_id = $1 ORDER BY r.reviewed_at", [t]);
    expect(reviews.map((r) => r.decision)).toEqual(["changes_requested", "approved"]);
    // Reopening requires a reason.
    await expect(updateTask(a.managerCtx, t, { expectedVersion: await taskVersion(t), status: "in_progress" })).rejects.toMatchObject({ status: 422 });
    await updateTask(a.managerCtx, t, { expectedVersion: await taskVersion(t), status: "in_progress", reason: "Client changed the brief" });
  });

  it("A21 validates uploads by magic bytes, keeps them private and quarantined until scanned", async () => {
    const t = a.taskIds.meeting;
    const fakePng = Buffer.from("<html>not a png</html>");
    await expect(uploadDeliverableFile(a.employeeCtx, t, { name: "evil.png", type: "image/png", bytes: fakePng })).rejects.toMatchObject({ status: 422 });
    await expect(uploadDeliverableFile(a.employeeCtx, t, { name: "x.svg", type: "image/svg+xml", bytes: Buffer.from("<svg/>") })).rejects.toMatchObject({ status: 422 });
    const txt = await uploadDeliverableFile(a.employeeCtx, t, { name: "notes.txt", type: "text/plain", bytes: Buffer.from("Meeting notes") });
    // Ben cannot attach evidence to Ada's task.
    await expect(uploadDeliverableFile(a.employee2Ctx, t, { name: "notes.txt", type: "text/plain", bytes: Buffer.from("x") })).rejects.toMatchObject({ status: 403 });
    const sub = await submitTask(a.employeeCtx, t, { note: "Notes attached", links: [], fileIds: [txt.id] });
    const d = (await adminQuery<{ id: string; storage_key: string; scan_status: string }>("SELECT id, storage_key, scan_status FROM deliverables WHERE submission_id = $1", [sub.submissionId]))[0];
    expect(d.storage_key.startsWith("org/")).toBe(true);
    expect(d.scan_status).toBe("pending");
    await expect(authoriseDeliverableDownload(a.managerCtx, d.id)).rejects.toMatchObject({ code: "FILE_PENDING_SCAN" });
    process.env.SCAN_ALLOW_UNSCANNED = "true";
    await scanDeliverable(d.id);
    const auth = await authoriseDeliverableDownload(a.managerCtx, d.id);
    expect(auth.url.startsWith("/api/files/")).toBe(true);
    // Company B cannot reach it by id, and cannot reuse the storage key.
    await expect(authoriseDeliverableDownload(b.managerCtx, d.id)).rejects.toMatchObject({ status: 404 });
    expect(await storage().exists(d.storage_key)).toBe(true);
    // Even privileged code cannot link Company B's row to Company A's submission or reuse the storage key.
    await expect(adminQuery("INSERT INTO deliverables(organisation_id, submission_id, kind, storage_key, uploaded_by) VALUES ($1, $2, 'file', $3, $4)", [b.ownerCtx.org.id, sub.submissionId, "org/x/evidence/other.txt", b.employeeCtx.membership.id])).rejects.toThrow(/foreign key/);
    await expect(adminQuery("INSERT INTO deliverables(organisation_id, submission_id, kind, storage_key, uploaded_by) VALUES ($1, $2, 'file', $3, $4)", [a.ownerCtx.org.id, sub.submissionId, d.storage_key, a.employeeCtx.membership.id])).rejects.toThrow(/unique|duplicate/);
  });
});

describe("A12 / A13 / A20 confirmed time, corrections and export", () => {
  // No staff daily report (owner decision, 6 October 2026): the timesheet and the export read the confirmed ledger.
  it("confirms timer time, corrects it once the lead approves and exports reconciled CSV", async () => {
    const ctx = a.employee2Ctx; // Ben: clean timeline
    const today = todayLocal(a.ownerCtx.org.timezone);
    const s = await startSession(ctx, { taskId: a.taskIds.second });
    await stopSession(ctx, s.id, { expectedVersion: s.version, note: "Drafted copy", outcome: "continue_later" });
    // Make the interval 30 minutes long, ending now.
    await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE session_intervals SET started_at = ended_at - interval '30 minutes' WHERE session_id = $1", [s.id]);
    await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
    let sheet = await timesheetForDate(a.managerCtx, ctx.membership.id, today);
    expect(sheet.day.totalSeconds).toBe(1800);
    let csv = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: ctx.membership.id });
    expect(csv.totalSeconds).toBe(1800);

    // A13: proposed correction overlapping Ada's session (other member) is fine; overlapping Ben's own confirmed interval in *another organisation* must be rejected generically.
    const { joinViaInvitation } = await import("@/server/services/fixtures");
    // Company B's five people fill the Free plan's seats; Pro makes room for Ben.
    await adminQuery("INSERT INTO subscriptions(organisation_id, plan_id, status, billing_interval, current_period_end, updated_at) VALUES ($1, (SELECT id FROM plans WHERE code = 'pro'), 'active', 'monthly', NULL, now()) ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', current_period_end = NULL", [b.ownerCtx.org.id]);
    const benInB = await joinViaInvitation(b.hrCtx, a.employee2, "employee", b.teamId);
    const tB = await createTask(b.managerCtx, { projectId: b.projectId, title: "B secret task", expectedOutput: "x", assigneeMembershipId: benInB.membership.id, category: "work", priority: "normal", addToMyDay: false });
    const sB = await startSession(benInB, { taskId: tB.id });
    await stopSession(benInB, sB.id, { expectedVersion: sB.version, note: "", outcome: "continue_later" });
    const bInterval = (await adminQuery<{ started_at: string; ended_at: string }>("SELECT started_at, ended_at FROM session_intervals WHERE session_id = $1", [sB.id]))[0];
    const overlapErr = await requestAdjustment(ctx, { taskId: a.taskIds.second, localDate: today, originalIntervalIds: [], proposedIntervals: [{ startedAt: new Date(new Date(bInterval.started_at).getTime() - 1000).toISOString(), endedAt: bInterval.ended_at }], reason: "Forgot to start the timer" }).catch((e) => e);
    expect(overlapErr).toMatchObject({ code: "INTERVAL_OVERLAP" });
    expect(String(overlapErr.message)).not.toContain("secret");

    // A12: a valid correction replaces the 30-minute interval with 45 minutes; the ledger is unchanged until the lead approves.
    const original = (await adminQuery<{ id: string; started_at: string; ended_at: string }>("SELECT id, started_at, ended_at FROM session_intervals WHERE session_id = $1", [s.id]))[0];
    const adj = await requestAdjustment(ctx, { taskId: a.taskIds.second, localDate: today, originalIntervalIds: [original.id], proposedIntervals: [{ startedAt: new Date(new Date(original.ended_at).getTime() - 45 * 60000).toISOString(), endedAt: original.ended_at }], reason: "Timer started late" });
    sheet = await timesheetForDate(a.managerCtx, ctx.membership.id, today);
    expect(sheet.day.totalSeconds).toBe(1800);
    expect(sheet.adjustments.find((x) => x.id === adj.adjustmentId)?.status).toBe("pending");
    csv = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: ctx.membership.id });
    expect(csv.totalSeconds).toBe(1800);
    // Ben cannot approve his own correction, and organisation accounts do not decide; his lead does.
    await expect(reviewAdjustment(ctx, adj.adjustmentId, { decision: "approved", note: "" })).rejects.toMatchObject({ status: 403 });
    await expect(reviewAdjustment(a.hrCtx, adj.adjustmentId, { decision: "approved", note: "" })).rejects.toMatchObject({ status: 403 });
    // Approval applies the ledger atomically: the 30 minutes are superseded and the 45 count.
    await reviewAdjustment(a.managerCtx, adj.adjustmentId, { decision: "approved", note: "" });
    const ledger = await adminQuery<{ confirmation_status: string; source: string }>("SELECT confirmation_status, source FROM session_intervals WHERE session_id = $1 ORDER BY created_at", [s.id]);
    expect(ledger.map((l) => l.confirmation_status)).toEqual(["superseded", "confirmed"]);
    expect(ledger[1].source).toBe("adjustment");
    sheet = await timesheetForDate(a.managerCtx, ctx.membership.id, today);
    expect(sheet.day.totalSeconds).toBe(2700);
    csv = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: ctx.membership.id });
    expect(csv.totalSeconds).toBe(2700);
    expect(csv.csv).toContain("EMP-002");
    expect(csv.csv.split("\r\n")[0]).toContain("confirmed_seconds");
    // Employees cannot export; Company B's export holds Ben's time there (the secret task) and nothing of A's.
    await expect(exportTimesheetsCsv(ctx, { from: today, to: today })).rejects.toMatchObject({ status: 403 });
    const bCsv = await exportTimesheetsCsv(b.hrCtx, { from: today, to: today });
    expect(bCsv.rows).toBe(1);
    expect(bCsv.csv.split("\r\n").slice(1).filter(Boolean).every((l) => l.includes("B secret task") && !l.includes(a.ownerCtx.org.name))).toBe(true);
  });

  it("leaves a running timer out of the export until it stops", async () => {
    const today = todayLocal(a.ownerCtx.org.timezone);
    const before = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: a.employeeCtx.membership.id });
    const fresh = await createTask(a.managerCtx, { projectId: a.projectId, title: "Fresh task", expectedOutput: "x", assigneeMembershipId: a.employeeCtx.membership.id, category: "work", priority: "normal", addToMyDay: false });
    const s = await startSession(a.employeeCtx, { taskId: fresh.id });
    const during = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: a.employeeCtx.membership.id });
    expect(during.totalSeconds).toBe(before.totalSeconds);
    expect(during.csv).not.toContain("Fresh task");
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  });
});
