import { z } from "zod";
import { randomUUID } from "node:crypto";
import { withUser, withWorker, isUniqueViolation, type Db } from "@/server/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { storage, tenantKey } from "@/server/lib/storage";
import { sha256, signPayload, verifyPayload } from "@/server/lib/crypto";
import { audit, notify, enqueueJob, managersOf } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export const RECORDING_LIMITS = {
  maxChunkBytes: 25 * 1024 * 1024,
  maxRecordingBytes: 2 * 1024 * 1024 * 1024,
  maxChunksPerRecording: 5000,
  supportedMime: ["video/webm", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4"],
};

export const createRecordingSchema = z.object({
  sessionId: z.string().uuid(),
  recorderInstance: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  mimeType: z.string().max(80),
  sourceType: z.enum(["monitor", "window", "browser", "unknown"]).default("unknown"),
  sourceLabel: z.string().max(200).optional().nullable(),
});

async function loadPolicy(db: Db, policyId: string | null) {
  const p = policyId ? await db.maybeOne<{ id: string; recording_mode: string; retention_days: number }>(`SELECT id, recording_mode, retention_days FROM policies WHERE id = $1`, [policyId]) : null;
  return p;
}

/** Authorises a new recorder instance for the caller's own open session and allocates a server-owned storage prefix. */
export async function createRecording(ctx: OrgContext, input: z.infer<typeof createRecordingSchema>, requestId?: string) {
  const baseMime = input.mimeType.split(";")[0].trim().toLowerCase();
  if (!["video/webm", "video/mp4"].includes(baseMime)) throw invalid("Unsupported recording format.", { mimeType: ["Use video/webm or video/mp4."] });
  return withUser(ctx.user.profileId, async (db) => {
    const s = await db.maybeOne<{ id: string; state: string; membership_id: string; capture_mode: string; policy_id: string | null }>(`SELECT id, state, membership_id, capture_mode, policy_id FROM work_sessions WHERE id = $1 AND organisation_id = $2`, [input.sessionId, ctx.org.id]);
    if (!s) throw notFound("Session not found.");
    if (s.membership_id !== ctx.membership.id) throw forbidden("You can only record your own sessions.");
    if (s.state === "stopped") throw conflict("BAD_STATE", "This session is stopped.");
    if (s.capture_mode === "none" || s.capture_mode === "exception") throw conflict("CAPTURE_NOT_ENABLED", "Capture is not enabled for this session.");
    const policy = await loadPolicy(db, s.policy_id ?? ctx.org.current_policy_id);
    if (!policy || policy.recording_mode === "disabled") throw conflict("RECORDING_DISABLED", "Recording is disabled by the current policy.");
    const ack = await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id]);
    if (!ack) throw conflict("POLICY_NOT_ACKNOWLEDGED", "Acknowledge the current policy before recording.");
    // Idempotent per recorder instance (a retry after a timeout returns the same recording).
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`recording:${s.id}`]);
    const existing = await db.maybeOne<{ id: string; expires_at: string }>(`SELECT id, expires_at FROM recordings WHERE session_id = $1 AND recorder_instance = $2`, [s.id, input.recorderInstance]);
    if (existing) return { id: existing.id, expiresAt: existing.expires_at, limits: RECORDING_LIMITS };
    const seg = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM recordings WHERE session_id = $1`, [s.id]);
    const prefix = tenantKey(ctx.org.id, "recordings", s.id, randomUUID());
    let rec: { id: string; expires_at: string };
    try {
      rec = await db.one(
        `INSERT INTO recordings(organisation_id, session_id, membership_id, policy_id, recorder_instance, segment_index, source_type, source_label, mime_type, capture_state, upload_state, storage_prefix, max_bytes, capture_started_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'recording', 'uploading', $10, $11, now(), now() + make_interval(days => $12)) RETURNING id, expires_at`,
        [ctx.org.id, s.id, ctx.membership.id, policy.id, input.recorderInstance, seg.n, input.sourceType, input.sourceLabel ?? null, input.mimeType, prefix, RECORDING_LIMITS.maxRecordingBytes, policy.retention_days]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("RECORDING_EXISTS", "This recorder instance is already registered. Retry the request.");
      throw err;
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "recording.started", subjectType: "recording", subjectId: rec.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { sessionId: s.id, sourceType: input.sourceType, segment: seg.n } });
    return { id: rec.id, expiresAt: rec.expires_at, limits: RECORDING_LIMITS };
  });
}

export const authoriseChunkSchema = z.object({ sequence: z.number().int().min(0).max(RECORDING_LIMITS.maxChunksPerRecording), checksum: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(RECORDING_LIMITS.maxChunkBytes) });

/** Registers a chunk slot. Duplicate sequence with the same checksum is idempotent; a conflicting checksum is rejected. */
export async function authoriseChunk(ctx: OrgContext, recordingId: string, input: z.infer<typeof authoriseChunkSchema>) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ id: string; membership_id: string; upload_state: string; storage_prefix: string; received_bytes: number; max_bytes: number; finalised_at: string | null }>(`SELECT id, membership_id, upload_state, storage_prefix, received_bytes, max_bytes, finalised_at FROM recordings WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [recordingId, ctx.org.id]);
    if (!r) throw notFound("Recording not found.");
    if (r.membership_id !== ctx.membership.id) throw forbidden();
    if (r.finalised_at || !["uploading", "pending", "partial"].includes(r.upload_state)) throw conflict("BAD_STATE", "This recording no longer accepts chunks.");
    const existing = await db.maybeOne<{ id: string; checksum: string; state: string; storage_key: string }>(`SELECT id, checksum, state, storage_key FROM recording_chunks WHERE recording_id = $1 AND sequence = $2`, [recordingId, input.sequence]);
    if (existing) {
      if (existing.checksum !== input.checksum) throw conflict("CHUNK_CONFLICT", `Chunk ${input.sequence} was already registered with different content.`);
      return { chunkId: existing.id, state: existing.state, uploadToken: existing.state === "authorised" ? uploadToken(existing.id, ctx.org.id) : null, alreadyReceived: existing.state !== "authorised" };
    }
    if (r.received_bytes + input.size > r.max_bytes) throw conflict("RECORDING_QUOTA", "This recording exceeds the size limit. Stop and request an exception if capture is required.");
    const key = `${r.storage_prefix}/chunk-${String(input.sequence).padStart(6, "0")}.part`;
    const c = await db.one<{ id: string }>(`INSERT INTO recording_chunks(organisation_id, recording_id, sequence, checksum, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [ctx.org.id, recordingId, input.sequence, input.checksum, input.size, key]);
    return { chunkId: c.id, state: "authorised", uploadToken: uploadToken(c.id, ctx.org.id), alreadyReceived: false };
  });
}

function uploadToken(chunkId: string, orgId: string) { return signPayload({ c: chunkId, o: orgId }, 300); }

/** Receives chunk bytes; validates size and checksum against the authorised slot. */
export async function receiveChunk(ctx: OrgContext, recordingId: string, chunkId: string, token: string, bytes: Buffer) {
  const t = verifyPayload<{ c: string; o: string }>(token);
  if (!t || t.c !== chunkId || t.o !== ctx.org.id) throw forbidden("Upload authorisation expired. Re-authorise the chunk.");
  const digest = sha256(bytes);
  return withUser(ctx.user.profileId, async (db) => {
    const c = await db.maybeOne<{ id: string; checksum: string; size_bytes: number; storage_key: string; state: string; membership_id: string }>(
      `SELECT c.id, c.checksum, c.size_bytes, c.storage_key, c.state, r.membership_id FROM recording_chunks c JOIN recordings r ON r.id = c.recording_id WHERE c.id = $1 AND c.recording_id = $2 AND c.organisation_id = $3 FOR UPDATE OF c`, [chunkId, recordingId, ctx.org.id]);
    if (!c) throw notFound("Chunk not found.");
    if (c.membership_id !== ctx.membership.id) throw forbidden();
    if (c.state !== "authorised") return { state: c.state, duplicate: true };
    if (bytes.length !== c.size_bytes) throw invalid("Chunk size does not match the authorised size.");
    if (digest !== c.checksum) throw invalid("Chunk checksum mismatch.");
    await storage().put(c.storage_key, bytes, "application/octet-stream");
    await db.query(`UPDATE recording_chunks SET state = 'verified', received_at = now() WHERE id = $1`, [c.id]);
    await db.query(`UPDATE recordings SET received_bytes = received_bytes + $2 WHERE id = $1`, [recordingId, bytes.length]);
    return { state: "verified", duplicate: false };
  });
}

export const finaliseSchema = z.object({ declaredChunkCount: z.number().int().min(0).max(RECORDING_LIMITS.maxChunksPerRecording), captureEnded: z.enum(["stopped", "interrupted", "failed"]).default("stopped") });

/** Closes capture; validates the manifest. Complete → assembly job; gaps → explicitly partial. */
export async function finaliseRecording(ctx: OrgContext, recordingId: string, input: z.infer<typeof finaliseSchema>, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ id: string; membership_id: string; finalised_at: string | null; upload_state: string; session_id: string }>(`SELECT id, membership_id, finalised_at, upload_state, session_id FROM recordings WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [recordingId, ctx.org.id]);
    if (!r) throw notFound("Recording not found.");
    if (r.membership_id !== ctx.membership.id) throw forbidden();
    if (r.finalised_at) return { state: r.upload_state, alreadyFinalised: true };
    const received = await db.query<{ sequence: number }>(`SELECT sequence FROM recording_chunks WHERE recording_id = $1 AND state = 'verified' ORDER BY sequence`, [recordingId]);
    const complete = input.declaredChunkCount > 0 && received.length === input.declaredChunkCount && received.every((c, i) => c.sequence === i);
    const state = input.declaredChunkCount === 0 ? "failed" : complete ? "processing" : "partial";
    const captureState = input.captureEnded === "stopped" ? "ended" : input.captureEnded;
    await db.query(`UPDATE recordings SET finalised_at = now(), declared_chunk_count = $2, upload_state = $3, capture_state = $4, capture_ended_at = now(), failure_reason = $5 WHERE id = $1`,
      [recordingId, input.declaredChunkCount, state, captureState, state === "failed" ? "No media chunks were received." : state === "partial" ? `Received ${received.length} of ${input.declaredChunkCount} chunks.` : null]);
    if (state === "processing") await enqueueJob(db, "recording.assemble", { recordingId }, { dedupKey: `assemble:${recordingId}` });
    if (input.captureEnded !== "stopped") {
      await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, metadata) VALUES ($1, $2, $3, 'capture_gap', $4)`, [ctx.org.id, r.session_id, ctx.user.profileId, JSON.stringify({ recordingId, reason: input.captureEnded })]);
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "recording.finalised", subjectType: "recording", subjectId: recordingId, subjectMembershipId: ctx.membership.id, requestId, metadata: { state, received: received.length, declared: input.declaredChunkCount, captureEnded: input.captureEnded } });
    return { state, alreadyFinalised: false, received: received.length };
  });
}

/** Worker: concatenates verified chunks of one recorder instance in sequence order and validates the container header. Idempotent. */
export async function assembleRecording(recordingId: string) {
  await withWorker(async (db) => {
    const r = await db.maybeOne<{ id: string; upload_state: string; storage_prefix: string; declared_chunk_count: number; mime_type: string; assembled_key: string | null }>(`SELECT id, upload_state, storage_prefix, declared_chunk_count, mime_type, assembled_key FROM recordings WHERE id = $1 FOR UPDATE`, [recordingId]);
    if (!r || r.upload_state !== "processing") return;
    const chunks = await db.query<{ sequence: number; storage_key: string; size_bytes: number }>(`SELECT sequence, storage_key, size_bytes FROM recording_chunks WHERE recording_id = $1 AND state = 'verified' ORDER BY sequence`, [recordingId]);
    const ok = chunks.length === r.declared_chunk_count && chunks.every((c, i) => c.sequence === i);
    if (!ok) { await db.query(`UPDATE recordings SET upload_state = 'partial', failure_reason = 'Manifest incomplete at assembly time' WHERE id = $1`, [recordingId]); return; }
    for (const c of chunks) {
      const size = await storage().size(c.storage_key);
      if (size !== c.size_bytes) { await db.query(`UPDATE recordings SET upload_state = 'failed', failure_reason = $2 WHERE id = $1`, [recordingId, `Chunk ${c.sequence} missing or corrupt in storage`]); return; }
    }
    const dest = r.assembled_key ?? `${r.storage_prefix}/assembled.${r.mime_type.startsWith("video/mp4") ? "mp4" : "webm"}`;
    await storage().concat(dest, chunks.map((c) => c.storage_key));
    const head = (await storage().get(dest))?.subarray(0, 12) ?? Buffer.alloc(0);
    const isWebm = head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3;
    const isMp4 = head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp";
    if (!(isWebm || isMp4)) { await db.query(`UPDATE recordings SET upload_state = 'failed', failure_reason = 'Assembled media failed container validation' WHERE id = $1`, [recordingId]); return; }
    await db.query(`UPDATE recordings SET upload_state = 'ready', assembled_key = $2 WHERE id = $1`, [recordingId, dest]);
    await audit(db, { organisationId: null, action: "recording.assembled", subjectType: "recording", subjectId: recordingId, metadata: { chunks: chunks.length } });
  });
}

/** Denials are logged in their own transaction so the audit row survives the thrown error. */
async function logDenied(ctx: OrgContext, recordingId: string, reason: string) {
  await withUser(ctx.user.profileId, (db) => db.query(
    `INSERT INTO recording_access_log(organisation_id, recording_id, actor_membership_id, action, metadata) VALUES ($1, $2, $3, 'playback_denied', $4)`,
    [ctx.org.id, recordingId, ctx.membership.id, JSON.stringify({ reason })])).catch(() => undefined);
}

/** Playback authorisation: owner of the footage or an explicit grant; restricted/expired/deleted denied; every attempt logged. */
export async function authorisePlayback(ctx: OrgContext, recordingId: string) {
  try {
    return await authorisePlaybackInner(ctx, recordingId);
  } catch (err) {
    const reason = (err as { details?: { denyReason?: string } }).details?.denyReason;
    if (reason) await logDenied(ctx, recordingId, reason);
    throw err;
  }
}

async function authorisePlaybackInner(ctx: OrgContext, recordingId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ id: string; membership_id: string; upload_state: string; assembled_key: string | null; mime_type: string; expires_at: string; restricted_at: string | null; deleted_at: string | null }>(`SELECT id, membership_id, upload_state, assembled_key, mime_type, expires_at, restricted_at, deleted_at FROM recordings WHERE id = $1 AND organisation_id = $2`, [recordingId, ctx.org.id]);
    if (!r) {
      // RLS hides recordings the caller has no grant for. If it exists in this organisation, log the denied attempt.
      const exists = await db.maybeOne<{ ok: boolean }>(`SELECT app_recording_in_org($1, $2) AS ok`, [ctx.org.id, recordingId]);
      if (exists?.ok) throw new AppError(403, "FORBIDDEN", "You do not have a recording access grant covering this person.", { details: { denyReason: "no_grant" } });
      throw notFound("Recording not found.");
    }
    const own = r.membership_id === ctx.membership.id;
    const granted = own ? false : (await db.one<{ v: boolean }>(`SELECT app_can_review_recording($1, $2) AS v`, [ctx.org.id, r.membership_id])).v;
    const privacyAdmin = (await db.one<{ v: boolean }>(`SELECT app_is_privacy_admin($1) AS v`, [ctx.org.id])).v;
    const deny = (reason: string, status: number, code: string, message: string): never => { throw new AppError(status, code, message, { details: { denyReason: reason } }); };
    if (!own && !granted && !privacyAdmin) deny("no_grant", 403, "FORBIDDEN", "You do not have a recording access grant covering this person.");
    if (r.deleted_at || r.upload_state === "deleted" || r.upload_state === "deleting") deny("deleted", 409, "RECORDING_DELETED", "This recording has been deleted.");
    if (new Date(r.expires_at) <= new Date()) deny("expired", 409, "RECORDING_EXPIRED", "This recording has passed its retention period and is no longer available.");
    if (r.restricted_at && !privacyAdmin) deny("restricted", 409, "RECORDING_RESTRICTED", "This recording is restricted while a privacy incident is open.");
    if (r.upload_state !== "ready" || !r.assembled_key) deny("not_ready", 409, "RECORDING_NOT_READY", `This recording is ${r.upload_state}; playback is only available once it is ready.`);
    await db.query(`INSERT INTO recording_access_log(organisation_id, recording_id, actor_membership_id, action, metadata) VALUES ($1, $2, $3, 'playback_authorised', $4)`, [ctx.org.id, r.id, ctx.membership.id, JSON.stringify({ own, granted, privacyAdmin })]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "recording.playback", subjectType: "recording", subjectId: r.id, subjectMembershipId: r.membership_id });
    const token = signPayload({ k: r.assembled_key!, m: r.mime_type.split(";")[0], o: ctx.org.id, r: r.id }, 60);
    return { url: `/api/media/${token}`, expiresInSeconds: 60, notice: "This URL expires in 60 seconds. Content already downloaded cannot be revoked." };
  });
}

export function resolveMediaToken(token: string) {
  return verifyPayload<{ k: string; m: string; o: string; r: string }>(token);
}

/** Employee flags sensitive footage: ordinary reviewer playback is denied immediately. */
export async function flagRecording(ctx: OrgContext, recordingId: string, reason: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ id: string; membership_id: string }>(`SELECT id, membership_id FROM recordings WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [recordingId, ctx.org.id]);
    if (!r) throw notFound("Recording not found.");
    if (r.membership_id !== ctx.membership.id) throw forbidden("You can only flag your own recordings.");
    const inc = await db.one<{ id: string }>(`INSERT INTO privacy_incidents(organisation_id, recording_id, reporter_membership_id, reason) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.org.id, recordingId, ctx.membership.id, reason]);
    await db.query(`UPDATE recordings SET restricted_at = COALESCE(restricted_at, now()), upload_state = CASE WHEN upload_state IN ('ready','partial','processing','uploading') THEN 'restricted' ELSE upload_state END WHERE id = $1`, [recordingId]);
    const admins = await db.query<{ grantee_membership_id: string }>(`SELECT grantee_membership_id FROM recording_grants WHERE organisation_id = $1 AND scope_type = 'privacy_admin' AND revoked_at IS NULL`, [ctx.org.id]);
    for (const a of admins) await notify(db, { organisationId: ctx.org.id, recipientMembershipId: a.grantee_membership_id, type: "incident.opened", title: "Sensitive recording flagged", body: "A recording was restricted and needs a deletion or release decision.", resourceType: "privacy_incident", resourceId: inc.id, href: `/app/${ctx.org.slug}/reviews`, dedupKey: `incident:${inc.id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "incident.opened", subjectType: "privacy_incident", subjectId: inc.id, subjectMembershipId: ctx.membership.id, metadata: { recordingId } });
    return inc;
  });
}

export async function resolveIncident(ctx: OrgContext, incidentId: string, input: { disposition: "deleted" | "released"; note: string }) {
  return withUser(ctx.user.profileId, async (db) => {
    const admin = await db.one<{ v: boolean }>(`SELECT app_is_privacy_admin($1) AS v`, [ctx.org.id]);
    if (!admin.v) throw forbidden("Only a privacy administrator can resolve incidents.");
    const inc = await db.maybeOne<{ id: string; recording_id: string; disposition: string; reporter_membership_id: string }>(`SELECT id, recording_id, disposition, reporter_membership_id FROM privacy_incidents WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [incidentId, ctx.org.id]);
    if (!inc) throw notFound("Incident not found.");
    if (inc.disposition !== "open") throw conflict("BAD_STATE", "This incident is already resolved.");
    await db.query(`UPDATE privacy_incidents SET disposition = $2, resolved_by = $3, resolution_note = $4, resolved_at = now() WHERE id = $1`, [incidentId, input.disposition, ctx.membership.id, input.note]);
    if (input.disposition === "deleted") {
      await db.query(`UPDATE recordings SET upload_state = 'deleting' WHERE id = $1`, [inc.recording_id]);
      await enqueueJob(db, "recording.retention_delete", { recordingId: inc.recording_id, reason: "incident" }, { dedupKey: `recording.delete:${inc.recording_id}` });
    } else {
      const otherOpen = await db.maybeOne(`SELECT 1 FROM privacy_incidents WHERE recording_id = $1 AND disposition = 'open' AND id <> $2`, [inc.recording_id, incidentId]);
      if (!otherOpen) {
        const assembled = await db.one<{ assembled_key: string | null; finalised_at: string | null }>(`SELECT assembled_key, finalised_at FROM recordings WHERE id = $1`, [inc.recording_id]);
        await db.query(`UPDATE recordings SET restricted_at = NULL, upload_state = $2 WHERE id = $1`, [inc.recording_id, assembled.assembled_key ? "ready" : assembled.finalised_at ? "partial" : "uploading"]);
      }
    }
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: inc.reporter_membership_id, type: "incident.resolved", title: `Flagged recording ${input.disposition === "deleted" ? "deleted" : "released"}`, body: input.note, dedupKey: `incident.resolved:${incidentId}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `incident.${input.disposition}`, subjectType: "privacy_incident", subjectId: incidentId, subjectMembershipId: inc.reporter_membership_id, metadata: { recordingId: inc.recording_id } });
  });
}

/** Worker: deletes chunks, assembled media and derivatives; keeps a tombstone. Idempotent and safe to retry. */
export async function deleteRecording(recordingId: string, reason: "retention" | "incident" | "offboarding") {
  await withWorker(async (db) => {
    const r = await db.maybeOne<{ id: string; organisation_id: string; storage_prefix: string; assembled_key: string | null; deleted_at: string | null; membership_id: string }>(`SELECT id, organisation_id, storage_prefix, assembled_key, deleted_at, membership_id FROM recordings WHERE id = $1 FOR UPDATE`, [recordingId]);
    if (!r || r.deleted_at) return;
    await db.query(`UPDATE recordings SET upload_state = 'deleting' WHERE id = $1`, [recordingId]);
    const chunks = await db.query<{ id: string; storage_key: string }>(`SELECT id, storage_key FROM recording_chunks WHERE recording_id = $1 AND state <> 'deleted'`, [recordingId]);
    const keys: string[] = [];
    for (const c of chunks) { await storage().delete(c.storage_key); keys.push(c.storage_key); await db.query(`UPDATE recording_chunks SET state = 'deleted' WHERE id = $1`, [c.id]); }
    if (r.assembled_key) { await storage().delete(r.assembled_key); keys.push(r.assembled_key); }
    await db.query(`INSERT INTO deletion_tombstones(organisation_id, subject_type, subject_id, storage_keys, reason) VALUES ($1, 'recording', $2, $3, $4) ON CONFLICT (subject_type, subject_id) DO NOTHING`, [r.organisation_id, recordingId, keys, reason]);
    await db.query(`UPDATE recordings SET upload_state = 'deleted', deleted_at = now(), assembled_key = NULL WHERE id = $1`, [recordingId]);
    await audit(db, { organisationId: r.organisation_id, action: "recording.deleted", subjectType: "recording", subjectId: recordingId, subjectMembershipId: r.membership_id, metadata: { reason, objects: keys.length } });
  });
}

// ---------------------------------------------------------------------------
// Capture exceptions
// ---------------------------------------------------------------------------
export const exceptionSchema = z.object({
  taskId: z.string().uuid().optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
  reasonCode: z.enum(["permission_denied", "unsupported_browser", "capture_failed", "quota_exceeded", "sensitive_context", "other"]),
  reason: z.string().trim().min(1).max(2000),
});

export async function requestCaptureException(ctx: OrgContext, input: z.infer<typeof exceptionSchema>) {
  if (!input.taskId && !input.sessionId) throw invalid("An exception needs a task or session.");
  return withUser(ctx.user.profileId, async (db) => {
    const ex = await db.one<{ id: string }>(`INSERT INTO capture_exceptions(organisation_id, membership_id, session_id, task_id, reason_code, reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [ctx.org.id, ctx.membership.id, input.sessionId ?? null, input.taskId ?? null, input.reasonCode, input.reason]);
    if (input.sessionId) await db.query(`UPDATE work_sessions SET capture_mode = 'exception', capture_exception_id = $2 WHERE id = $1 AND membership_id = $3`, [input.sessionId, ex.id, ctx.membership.id]);
    for (const mgr of await managersOf(db, ctx.org.id, ctx.membership.id)) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "capture.exception", title: `${ctx.user.displayName} requested a capture exception`, body: input.reason, resourceType: "capture_exception", resourceId: ex.id, href: `/app/${ctx.org.slug}/reviews`, dedupKey: `cex:${ex.id}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "capture_exception.requested", subjectType: "capture_exception", subjectId: ex.id, subjectMembershipId: ctx.membership.id, metadata: { reasonCode: input.reasonCode } });
    return ex;
  });
}

export async function reviewCaptureException(ctx: OrgContext, id: string, input: { decision: "accepted" | "rejected"; note: string }) {
  return withUser(ctx.user.profileId, async (db) => {
    const ex = await db.maybeOne<{ id: string; membership_id: string; status: string }>(`SELECT id, membership_id, status FROM capture_exceptions WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [id, ctx.org.id]);
    if (!ex) throw notFound("Exception not found.");
    if (ex.membership_id === ctx.membership.id) throw forbidden("You cannot review your own exception.");
    if (ex.status !== "pending") throw conflict("BAD_STATE", "Already decided.");
    await db.query(`UPDATE capture_exceptions SET status = $2, reviewer_membership_id = $3, decision_note = $4, reviewed_at = now() WHERE id = $1`, [id, input.decision, ctx.membership.id, input.note]);
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: ex.membership_id, type: `capture.exception.${input.decision}`, title: `Capture exception ${input.decision}`, body: input.note || undefined, dedupKey: `cex.review:${id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `capture_exception.${input.decision}`, subjectType: "capture_exception", subjectId: id, subjectMembershipId: ex.membership_id });
  });
}

export async function listSessionRecordings(ctx: OrgContext, sessionId: string) {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; segment_index: number; source_type: string; capture_state: string; upload_state: string; received_bytes: number; capture_started_at: string | null; capture_ended_at: string | null; expires_at: string; restricted_at: string | null; deleted_at: string | null; failure_reason: string | null }>(
    `SELECT id, segment_index, source_type, capture_state, upload_state, received_bytes, capture_started_at, capture_ended_at, expires_at, restricted_at, deleted_at, failure_reason FROM recordings WHERE session_id = $1 AND organisation_id = $2 ORDER BY segment_index`, [sessionId, ctx.org.id]));
}
