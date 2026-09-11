import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { submitTask, reviewSubmission, uploadDeliverableFile, authoriseDeliverableDownload, scanDeliverable } from "@/server/services/evidence";
import { submitReport, reviewReport, requestAdjustment, reviewAdjustment, exportTimesheetsCsv, reportForDate } from "@/server/services/reports";
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
    // Organisation accounts supervise only: they cannot hold tasks or run timers at all.
    await expect(createTask(a.ownerCtx, { projectId: a.projectId, title: "Owner task", expectedOutput: "x", reviewerMembershipId: a.managerCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false })).rejects.toMatchObject({ status: 422 });
    const { startSession: start } = await import("@/server/services/sessions");
    await expect(start(a.ownerCtx, { taskId: t, captureMode: "none" })).rejects.toMatchObject({ status: 403 });
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

describe("A12 / A13 / A20 reports, corrections and export", () => {
  it("submits, approves, corrects with a new version and exports reconciled CSV", async () => {
    const ctx = a.employee2Ctx; // Ben: clean timeline
    const today = todayLocal(a.ownerCtx.org.timezone);
    const s = await startSession(ctx, { taskId: a.taskIds.second, captureMode: "none" });
    await stopSession(ctx, s.id, { expectedVersion: s.version, note: "Drafted copy", outcome: "continue_later" });
    // Make the interval 30 minutes long, ending now.
    await adminQuery("ALTER TABLE session_intervals DISABLE TRIGGER session_intervals_immutable");
    await adminQuery("UPDATE session_intervals SET started_at = ended_at - interval '30 minutes' WHERE session_id = $1", [s.id]);
    await adminQuery("ALTER TABLE session_intervals ENABLE TRIGGER session_intervals_immutable");
    const sub = await submitReport(ctx, { localDate: today, blockers: "", nextPriorities: "Finish pricing page" });
    expect(sub.version).toBe(1);
    expect(sub.totalSeconds).toBe(1800);
    // Employee cannot approve own; manager approves.
    await expect(reviewReport(ctx, sub.reportId, { decision: "approved", note: "", version: 1 })).rejects.toMatchObject({ status: 403 });
    await reviewReport(a.managerCtx, sub.reportId, { decision: "approved", note: "", version: 1 });
    let rep = await reportForDate(a.managerCtx, ctx.membership.id, today);
    expect(rep.report?.status).toBe("approved");
    expect(rep.report?.approved_version).toBe(1);

    // A13: proposed correction overlapping Ada's session (other member) is fine; overlapping Ben's own confirmed interval in *another organisation* must be rejected generically.
    const { joinViaInvitation } = await import("@/server/services/fixtures");
    const benInB = await joinViaInvitation(b.hrCtx, a.employee2, "employee", b.teamId);
    const tB = await createTask(b.managerCtx, { projectId: b.projectId, title: "B secret task", expectedOutput: "x", assigneeMembershipId: benInB.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const sB = await startSession(benInB, { taskId: tB.id, captureMode: "none" });
    await stopSession(benInB, sB.id, { expectedVersion: sB.version, note: "", outcome: "continue_later" });
    const bInterval = (await adminQuery<{ started_at: string; ended_at: string }>("SELECT started_at, ended_at FROM session_intervals WHERE session_id = $1", [sB.id]))[0];
    const overlapErr = await requestAdjustment(ctx, { taskId: a.taskIds.second, localDate: today, originalIntervalIds: [], proposedIntervals: [{ startedAt: new Date(new Date(bInterval.started_at).getTime() - 1000).toISOString(), endedAt: bInterval.ended_at }], reason: "Forgot to start the timer" }).catch((e) => e);
    expect(overlapErr).toMatchObject({ code: "INTERVAL_OVERLAP" });
    expect(String(overlapErr.message)).not.toContain("secret");

    // A12: valid correction replaces the 30-minute interval with 45 minutes → new version needs approval; v1 stays approved until then.
    const original = (await adminQuery<{ id: string; started_at: string; ended_at: string }>("SELECT id, started_at, ended_at FROM session_intervals WHERE session_id = $1", [s.id]))[0];
    const adj = await requestAdjustment(ctx, { taskId: a.taskIds.second, localDate: today, originalIntervalIds: [original.id], proposedIntervals: [{ startedAt: new Date(new Date(original.ended_at).getTime() - 45 * 60000).toISOString(), endedAt: original.ended_at }], reason: "Timer started late" });
    expect(adj.reportVersion).toBe(2);
    rep = await reportForDate(a.managerCtx, ctx.membership.id, today);
    expect(rep.report?.status).toBe("submitted");
    expect(rep.report?.approved_version).toBe(1);
    expect(rep.versions.find((v) => v.version === 1)?.status).toBe("approved");
    expect(rep.versions.find((v) => v.version === 2)?.total_seconds).toBe(2700);
    // Export before approval reflects v1 (1800 s).
    let csv = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: ctx.membership.id });
    expect(csv.totalSeconds).toBe(1800);
    // Approve the correction: ledger applied atomically, v2 approved, v1 superseded.
    await reviewAdjustment(a.managerCtx, adj.adjustmentId, { decision: "approved", note: "" });
    rep = await reportForDate(a.managerCtx, ctx.membership.id, today);
    expect(rep.report?.approved_version).toBe(2);
    expect(rep.versions.find((v) => v.version === 1)?.status).toBe("superseded");
    expect(rep.versions.find((v) => v.version === 2)?.status).toBe("approved");
    const ledger = await adminQuery<{ confirmation_status: string; source: string }>("SELECT confirmation_status, source FROM session_intervals WHERE session_id = $1 ORDER BY created_at", [s.id]);
    expect(ledger.map((l) => l.confirmation_status)).toEqual(["superseded", "confirmed"]);
    expect(ledger[1].source).toBe("adjustment");
    csv = await exportTimesheetsCsv(a.hrCtx, { from: today, to: today, membershipId: ctx.membership.id });
    expect(csv.totalSeconds).toBe(2700);
    expect(csv.csv).toContain("EMP-002");
    expect(csv.csv.split("\r\n")[0]).toContain("report_version");
    // Employees cannot export; Company B sees nothing of A.
    await expect(exportTimesheetsCsv(ctx, { from: today, to: today })).rejects.toMatchObject({ status: 403 });
    const bCsv = await exportTimesheetsCsv(b.hrCtx, { from: today, to: today });
    expect(bCsv.rows).toBe(0);
  });

  it("rejects report submission while a session is open", async () => {
    const today = todayLocal(a.ownerCtx.org.timezone);
    const fresh = await createTask(a.managerCtx, { projectId: a.projectId, title: "Fresh task", expectedOutput: "x", assigneeMembershipId: a.employeeCtx.membership.id, category: "work", priority: "normal", captureRequirement: "none", addToMyDay: false });
    const s = await startSession(a.employeeCtx, { taskId: fresh.id, captureMode: "none" });
    await expect(submitReport(a.employeeCtx, { localDate: today, blockers: "", nextPriorities: "" })).rejects.toMatchObject({ code: "SESSION_OPEN" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  });
});
