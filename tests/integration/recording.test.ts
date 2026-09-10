import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { publishPolicy, acknowledgePolicy, grantRecordingAccess } from "@/server/services/orgs";
import { contextFor } from "@/server/services/fixtures";
import { startSession, stopSession } from "@/server/services/sessions";
import { updateTask } from "@/server/services/tasks";
import { createRecording, authoriseChunk, receiveChunk, finaliseRecording, assembleRecording, authorisePlayback, flagRecording, resolveIncident, deleteRecording, requestCaptureException } from "@/server/services/recording";
import { storage } from "@/server/lib/storage";
import { handlers } from "../../worker/handlers";

let a: CompanyFixture;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const WEBM_HEAD = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
  await publishPolicy(a.ownerCtx, { recordingMode: "required_on_designated_tasks", retentionDays: 7, noticeText: "Recording is required on designated tasks. Video only.", reminderMinutesBeforeEnd: 30 });
  // refresh contexts (current_policy_id changed)
  a.employeeCtx = await contextFor(a.employee, a.slug); a.managerCtx = await contextFor(a.manager, a.slug); a.hrCtx = await contextFor(a.hr, a.slug); a.ownerCtx = await contextFor(a.owner, a.slug);
  const v = (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [a.taskIds.homepage]))[0].version;
  await updateTask(a.managerCtx, a.taskIds.homepage, { expectedVersion: v, captureRequirement: "required" });
});

describe("A14 policy gates and exceptions", () => {
  it("requires acknowledgement and capture (or an exception) on designated tasks", async () => {
    await expect(startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "none" })).rejects.toMatchObject({ code: "CAPTURE_REQUIRED" });
    await expect(startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "required" })).rejects.toMatchObject({ code: "POLICY_NOT_ACKNOWLEDGED" });
    await acknowledgePolicy(a.employeeCtx);
    await expect(startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "exception" })).rejects.toMatchObject({ status: 422 });
    const ex = await requestCaptureException(a.employeeCtx, { taskId: a.taskIds.homepage, reasonCode: "unsupported_browser", reason: "Firefox ESR without getDisplayMedia" });
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "exception", captureExceptionId: ex.id });
    expect(s.captureMode).toBe("exception");
    // No recording can be claimed for an exception session.
    await expect(createRecording(a.employeeCtx, { sessionId: s.id, recorderInstance: "abcdefgh12345678", mimeType: "video/webm", sourceType: "window" })).rejects.toMatchObject({ code: "CAPTURE_NOT_ENABLED" });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    const pendingEx = await adminQuery("SELECT 1 FROM capture_exceptions WHERE id = $1 AND status = 'pending'", [ex.id]);
    expect(pendingEx).toHaveLength(1);
  });
});

describe("A15 / A16 / A17 / A18 upload, playback, restriction, retention", () => {
  it("validates ordered manifests, rejects conflicting chunks, assembles, authorises playback only with grants, restricts and deletes", async () => {
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.homepage, captureMode: "required" });
    const rec = await createRecording(a.employeeCtx, { sessionId: s.id, recorderInstance: "recorderinstance01", mimeType: "video/webm;codecs=vp9", sourceType: "window", sourceLabel: "Figma" });
    // Same instance again is idempotent.
    const again = await createRecording(a.employeeCtx, { sessionId: s.id, recorderInstance: "recorderinstance01", mimeType: "video/webm", sourceType: "window" });
    expect(again.id).toBe(rec.id);
    const chunks = [Buffer.concat([WEBM_HEAD, Buffer.alloc(1000, 1)]), Buffer.alloc(1000, 2), Buffer.alloc(1000, 3)];
    // Upload out of order: 2, 0, 1 (retry scenario).
    for (const i of [2, 0, 1]) {
      const auth = await authoriseChunk(a.employeeCtx, rec.id, { sequence: i, checksum: sha(chunks[i]), size: chunks[i].length });
      const r = await receiveChunk(a.employeeCtx, rec.id, auth.chunkId, auth.uploadToken!, chunks[i]);
      expect(r.state).toBe("verified");
    }
    // Duplicate with the same checksum is accepted idempotently; conflicting checksum is rejected; wrong bytes rejected.
    const dup = await authoriseChunk(a.employeeCtx, rec.id, { sequence: 1, checksum: sha(chunks[1]), size: 1000 });
    expect(dup.alreadyReceived).toBe(true);
    await expect(authoriseChunk(a.employeeCtx, rec.id, { sequence: 1, checksum: sha(Buffer.alloc(1000, 9)), size: 1000 })).rejects.toMatchObject({ code: "CHUNK_CONFLICT" });
    const bad = await authoriseChunk(a.employeeCtx, rec.id, { sequence: 3, checksum: sha(Buffer.alloc(10, 4)), size: 10 });
    await expect(receiveChunk(a.employeeCtx, rec.id, bad.chunkId, bad.uploadToken!, Buffer.alloc(10, 5))).rejects.toMatchObject({ status: 422 });
    // Another member cannot push chunks into this recording.
    await expect(authoriseChunk(a.employee2Ctx, rec.id, { sequence: 5, checksum: sha(chunks[0]), size: 10 })).rejects.toMatchObject({ status: 404 });
    // A16: finalising with a declared count larger than received → partial, honest state.
    const partialRec = await createRecording(a.employeeCtx, { sessionId: s.id, recorderInstance: "recorderinstance02", mimeType: "video/webm", sourceType: "window" });
    const pa = await authoriseChunk(a.employeeCtx, partialRec.id, { sequence: 0, checksum: sha(chunks[0]), size: chunks[0].length });
    await receiveChunk(a.employeeCtx, partialRec.id, pa.chunkId, pa.uploadToken!, chunks[0]);
    const pf = await finaliseRecording(a.employeeCtx, partialRec.id, { declaredChunkCount: 3, captureEnded: "interrupted" });
    expect(pf.state).toBe("partial");
    // A15: complete manifest → processing → assembled and ready.
    const fin = await finaliseRecording(a.employeeCtx, rec.id, { declaredChunkCount: 3, captureEnded: "stopped" });
    expect(fin.state).toBe("processing");
    await assembleRecording(rec.id);
    await assembleRecording(rec.id); // idempotent
    const state = (await adminQuery<{ upload_state: string; assembled_key: string }>("SELECT upload_state, assembled_key FROM recordings WHERE id = $1", [rec.id]))[0];
    expect(state.upload_state).toBe("ready");
    expect(await storage().size(state.assembled_key)).toBe(3 * 1000 + WEBM_HEAD.length);
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });

    // A17: HR without a grant is denied and logged; the employee can play their own; a scoped grant succeeds with an audit event.
    await expect(authorisePlayback(a.hrCtx, rec.id)).rejects.toMatchObject({ status: 403 });
    const own = await authorisePlayback(a.employeeCtx, rec.id);
    expect(own.url.startsWith("/api/media/")).toBe(true);
    await expect(grantRecordingAccess(a.hrCtx, { granteeMembershipId: a.managerCtx.membership.id, scopeType: "team", scopeId: a.teamId })).rejects.toMatchObject({ status: 403 });
    await grantRecordingAccess(a.ownerCtx, { granteeMembershipId: a.managerCtx.membership.id, scopeType: "team", scopeId: a.teamId });
    const mgr = await authorisePlayback(a.managerCtx, rec.id);
    expect(mgr.expiresInSeconds).toBe(60);
    const log = await adminQuery<{ action: string }>("SELECT action FROM recording_access_log WHERE recording_id = $1 ORDER BY occurred_at", [rec.id]);
    expect(log.map((l) => l.action)).toEqual(["playback_denied", "playback_authorised", "playback_authorised"]);
    expect(await adminQuery("SELECT 1 FROM audit_events WHERE action = 'recording.playback' AND subject_id = $1", [rec.id])).toHaveLength(2);

    // A18: employee flags footage → manager denied immediately; privacy admin resolves with deletion → objects gone, tombstone kept.
    await flagRecording(a.employeeCtx, rec.id, "Personal banking window was visible");
    await expect(authorisePlayback(a.managerCtx, rec.id)).rejects.toMatchObject({ code: "RECORDING_RESTRICTED" });
    await expect(resolveIncident(a.ownerCtx, (await adminQuery<{ id: string }>("SELECT id FROM privacy_incidents WHERE recording_id = $1", [rec.id]))[0].id, { disposition: "deleted", note: "Agreed" })).rejects.toMatchObject({ status: 403 });
    await grantRecordingAccess(a.ownerCtx, { granteeMembershipId: a.ownerCtx.membership.id, scopeType: "privacy_admin" });
    const ownerAsAdmin = await contextFor(a.owner, a.slug);
    const incidentId = (await adminQuery<{ id: string }>("SELECT id FROM privacy_incidents WHERE recording_id = $1", [rec.id]))[0].id;
    await resolveIncident(ownerAsAdmin, incidentId, { disposition: "deleted", note: "Deleted at employee's request" });
    // Run the deletion job twice (A22: duplicate execution is safe).
    const job = (await adminQuery<{ id: string; payload: Record<string, unknown> }>("SELECT id, payload FROM jobs WHERE type = 'recording.retention_delete' AND payload->>'recordingId' = $1", [rec.id]))[0];
    await handlers["recording.retention_delete"](job.payload, { jobId: job.id, attempt: 1 });
    await handlers["recording.retention_delete"](job.payload, { jobId: job.id, attempt: 2 });
    expect(await storage().exists(state.assembled_key)).toBe(false);
    const after = (await adminQuery<{ upload_state: string; deleted_at: string | null }>("SELECT upload_state, deleted_at FROM recordings WHERE id = $1", [rec.id]))[0];
    expect(after.upload_state).toBe("deleted");
    expect(after.deleted_at).toBeTruthy();
    expect(await adminQuery("SELECT 1 FROM deletion_tombstones WHERE subject_id = $1", [rec.id])).toHaveLength(1);
    expect(await adminQuery("SELECT 1 FROM recording_chunks WHERE recording_id = $1 AND state <> 'deleted'", [rec.id])).toHaveLength(0);
    await expect(authorisePlayback(a.employeeCtx, rec.id)).rejects.toMatchObject({ code: "RECORDING_DELETED" });
    // Retention expiry denies playback immediately even before the worker runs.
    await adminQuery("UPDATE recordings SET expires_at = now() - interval '1 minute' WHERE id = $1", [partialRec.id]);
    await expect(authorisePlayback(a.employeeCtx, partialRec.id)).rejects.toMatchObject({ code: "RECORDING_EXPIRED" });
    await deleteRecording(partialRec.id, "retention");
    expect((await adminQuery<{ upload_state: string }>("SELECT upload_state FROM recordings WHERE id = $1", [partialRec.id]))[0].upload_state).toBe("deleted");
  });
});

describe("A22 duplicate reminder jobs", () => {
  it("does not create duplicate notifications when the reminder handler runs twice", async () => {
    const payload = { organisationId: a.ownerCtx.org.id, membershipId: a.employeeCtx.membership.id, localDate: "2026-09-10", slug: a.slug };
    await handlers["report.reminder"](payload, { jobId: "x", attempt: 1 });
    await handlers["report.reminder"](payload, { jobId: "x", attempt: 2 });
    const n = await adminQuery("SELECT 1 FROM notifications WHERE recipient_membership_id = $1 AND type = 'report.reminder'", [a.employeeCtx.membership.id]);
    expect(n).toHaveLength(1);
  });
});
