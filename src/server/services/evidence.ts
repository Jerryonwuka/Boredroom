import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { storage, tenantKey } from "@/server/lib/storage";
import { sha256, signPayload, verifyPayload } from "@/server/lib/crypto";
import { audit, notify, enqueueJob } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "text/plain": (b) => !b.subarray(0, 4096).includes(0),
};
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt" };

export const submissionSchema = z.object({
  note: z.string().trim().max(4000).default(""),
  links: z.array(z.object({ url: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Only https links are accepted."), notes: z.string().trim().max(1000).default("") })).max(10).default([]),
  fileIds: z.array(z.string().uuid()).max(10).default([]),
});

/** Stores an uploaded file privately, validated by size, MIME and magic bytes; quarantined until scanned. */
export async function uploadDeliverableFile(ctx: OrgContext, taskId: string, file: { name: string; type: string; bytes: Buffer }) {
  return withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ id: string; assignee_membership_id: string }>(`SELECT id, assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    if (t.assignee_membership_id !== ctx.membership.id) throw forbidden("Only the assignee can attach evidence.");
    const policy = await db.maybeOne<{ attachment_max_bytes: number; attachment_mime_types: string[] }>(`SELECT attachment_max_bytes, attachment_mime_types FROM policies WHERE id = $1`, [ctx.org.current_policy_id]);
    const maxBytes = policy?.attachment_max_bytes ?? 20 * 1024 * 1024;
    const allowed = policy?.attachment_mime_types ?? Object.keys(MAGIC);
    if (file.bytes.length === 0) throw invalid("The file is empty.");
    if (file.bytes.length > maxBytes) throw invalid(`Files must be ${Math.round(maxBytes / 1048576)} MB or smaller.`);
    const type = file.type.split(";")[0].trim().toLowerCase();
    if (!allowed.includes(type) || !MAGIC[type]) throw invalid("Unsupported file type. Allowed: PDF, PNG, JPEG, WebP, TXT.");
    if (!MAGIC[type](file.bytes)) throw invalid("The file content does not match its declared type.");
    const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 120) || `evidence.${EXT[type]}`;
    const key = tenantKey(ctx.org.id, "evidence", taskId, `${crypto.randomUUID()}.${EXT[type]}`);
    const { sha256: digest } = await storage().put(key, file.bytes, type);
    // Staged deliverable: attached to a submission when the employee submits.
    const staged = await db.one<{ id: string }>(
      `INSERT INTO staged_uploads(organisation_id, task_id, membership_id, storage_key, file_name, mime_type, size_bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [ctx.org.id, taskId, ctx.membership.id, key, safeName, type, file.bytes.length, digest]);
    return { id: staged.id, fileName: safeName, size: file.bytes.length, mimeType: type };
  });
}

/** Creates an immutable submission revision with its evidence and moves the task into review. */
export async function submitTask(ctx: OrgContext, taskId: string, input: z.infer<typeof submissionSchema>, requestId?: string) {
  if (input.links.length === 0 && input.fileIds.length === 0 && !input.note) throw invalid("Add a note, a link or a file as evidence.");
  return withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ id: string; title: string; status: string; assignee_membership_id: string; reviewer_membership_id: string | null; version: number; archived_at: string | null }>(
      `SELECT id, title, status, assignee_membership_id, reviewer_membership_id, version, archived_at FROM tasks WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    if (t.assignee_membership_id !== ctx.membership.id) throw forbidden("Only the assignee can submit this task.");
    if (t.archived_at) throw conflict("TASK_ARCHIVED", "Archived tasks cannot be submitted.");
    if (!t.reviewer_membership_id) throw invalid("Choose a reviewer before submitting for review.", { reviewerMembershipId: ["A reviewer is required."] });
    if (t.reviewer_membership_id === ctx.membership.id) throw conflict("SELF_REVIEW", "You cannot review your own work. Ask a manager to set a different reviewer.");
    if (!["todo", "in_progress", "blocked"].includes(t.status)) throw conflict("BAD_TRANSITION", `A ${t.status.replace("_", " ")} task cannot be submitted.`);
    const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE task_id = $1 AND state IN ('running','paused','interrupted')`, [taskId]);
    if (open) throw conflict("SESSION_OPEN", "Stop the running session on this task before submitting.");
    const rev = await db.one<{ next: number }>(`SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM task_submissions WHERE task_id = $1`, [taskId]);
    const sub = await db.one<{ id: string }>(`INSERT INTO task_submissions(organisation_id, task_id, revision, submitted_by, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [ctx.org.id, taskId, rev.next, ctx.membership.id, input.note]);
    for (const l of input.links) {
      await db.query(`INSERT INTO deliverables(organisation_id, submission_id, kind, url, notes, uploaded_by, scan_status) VALUES ($1, $2, 'link', $3, $4, $5, 'not_applicable')`, [ctx.org.id, sub.id, l.url, l.notes || null, ctx.membership.id]);
    }
    for (const fid of input.fileIds) {
      const f = await db.maybeOne<{ storage_key: string; file_name: string; mime_type: string; size_bytes: number; sha256: string }>(
        `DELETE FROM staged_uploads WHERE id = $1 AND task_id = $2 AND membership_id = $3 RETURNING storage_key, file_name, mime_type, size_bytes, sha256`, [fid, taskId, ctx.membership.id]);
      if (!f) throw invalid("One of the attached files is no longer available. Upload it again.");
      const d = await db.one<{ id: string }>(
        `INSERT INTO deliverables(organisation_id, submission_id, kind, storage_key, file_name, mime_type, size_bytes, sha256, uploaded_by, scan_status) VALUES ($1, $2, 'file', $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
        [ctx.org.id, sub.id, f.storage_key, f.file_name, f.mime_type, f.size_bytes, f.sha256, ctx.membership.id]);
      await enqueueJob(db, "deliverable.scan", { deliverableId: d.id }, { dedupKey: `scan:${d.id}` });
    }
    await db.query(`UPDATE tasks SET status = 'in_review', blocked_reason = NULL, version = version + 1 WHERE id = $1`, [taskId]);
    await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, 'in_review', $5)`, [ctx.org.id, taskId, ctx.membership.id, t.status, `Revision ${rev.next} submitted`]);
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: t.reviewer_membership_id, type: "review.requested", title: `Review requested: ${t.title}`, body: `Revision ${rev.next} from ${ctx.user.displayName}`, resourceType: "task", resourceId: taskId, href: `/app/${ctx.org.slug}/tasks/${taskId}`, dedupKey: `review.requested:${sub.id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task.submitted", subjectType: "task_submission", subjectId: sub.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { taskId, revision: rev.next, links: input.links.length, files: input.fileIds.length } });
    return { submissionId: sub.id, revision: rev.next };
  });
}

export const reviewSchema = z.object({ decision: z.enum(["approved", "changes_requested", "question"]), note: z.string().trim().max(4000).default("") });

/** Reviewer decision on the latest revision. Self-review is rejected here and by the database. */
export async function reviewSubmission(ctx: OrgContext, submissionId: string, input: z.infer<typeof reviewSchema>, requestId?: string) {
  if (input.decision !== "approved" && !input.note) throw invalid("Explain what needs to change or what you are asking.", { note: ["Required for this decision."] });
  return withUser(ctx.user.profileId, async (db) => {
    const s = await db.maybeOne<{ id: string; task_id: string; revision: number; submitted_by: string; title: string; status: string; reviewer_membership_id: string | null; assignee_membership_id: string; project_id: string }>(
      `SELECT s.id, s.task_id, s.revision, s.submitted_by, t.title, t.status, t.reviewer_membership_id, t.assignee_membership_id, t.project_id
       FROM task_submissions s JOIN tasks t ON t.id = s.task_id WHERE s.id = $1 AND s.organisation_id = $2`, [submissionId, ctx.org.id]);
    if (!s) throw notFound("Submission not found.");
    if (s.submitted_by === ctx.membership.id || s.assignee_membership_id === ctx.membership.id) throw forbidden("You cannot review your own submission.");
    const scope = await db.one<{ v: boolean }>(`SELECT (app_has_role($1, 'owner', 'hr') OR app_manages($1, $2)) AS v`, [ctx.org.id, s.assignee_membership_id]);
    if (s.reviewer_membership_id !== ctx.membership.id && !scope.v) throw forbidden("Only the designated reviewer (or a manager in scope) can review this task.");
    const latest = await db.one<{ max: number }>(`SELECT MAX(revision) AS max FROM task_submissions WHERE task_id = $1`, [s.task_id]);
    if (latest.max !== s.revision) throw conflict("STALE_REVISION", "A newer revision exists. Review the latest one.");
    if (s.status !== "in_review") throw conflict("BAD_STATE", "This task is not waiting for review.");
    const alreadyDecided = await db.maybeOne(`SELECT 1 FROM reviews WHERE submission_id = $1 AND decision IN ('approved','changes_requested')`, [submissionId]);
    if (alreadyDecided) throw conflict("ALREADY_REVIEWED", "This revision already has a decision.");
    const r = await db.one<{ id: string }>(`INSERT INTO reviews(organisation_id, submission_id, reviewer_membership_id, decision, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [ctx.org.id, submissionId, ctx.membership.id, input.decision, input.note]);
    if (input.decision === "approved") {
      await db.query(`UPDATE tasks SET status = 'completed', completed_at = now(), version = version + 1 WHERE id = $1`, [s.task_id]);
      await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, 'in_review', 'completed', $4)`, [ctx.org.id, s.task_id, ctx.membership.id, `Revision ${s.revision} approved`]);
    } else if (input.decision === "changes_requested") {
      await db.query(`UPDATE tasks SET status = 'in_progress', version = version + 1 WHERE id = $1`, [s.task_id]);
      await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, 'in_review', 'in_progress', $4)`, [ctx.org.id, s.task_id, ctx.membership.id, input.note]);
    }
    const titles = { approved: `Approved: ${s.title}`, changes_requested: `Changes requested: ${s.title}`, question: `Question about ${s.title}` };
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: s.submitted_by, type: `review.${input.decision}`, title: titles[input.decision], body: input.note || undefined, resourceType: "task", resourceId: s.task_id, href: `/app/${ctx.org.slug}/tasks/${s.task_id}`, dedupKey: `review:${r.id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `review.${input.decision}`, subjectType: "task_submission", subjectId: submissionId, subjectMembershipId: s.submitted_by, requestId, metadata: { taskId: s.task_id, revision: s.revision } });
    return { reviewId: r.id, taskStatus: input.decision === "approved" ? "completed" : input.decision === "changes_requested" ? "in_progress" : "in_review" };
  });
}

/** Short-lived, signed download authorisation (60 s). The URL cannot be revoked once the bytes are downloaded. */
export async function authoriseDeliverableDownload(ctx: OrgContext, deliverableId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const d = await db.maybeOne<{ id: string; storage_key: string; file_name: string; mime_type: string; scan_status: string }>(
      `SELECT id, storage_key, file_name, mime_type, scan_status FROM deliverables WHERE id = $1 AND organisation_id = $2 AND kind = 'file'`, [deliverableId, ctx.org.id]);
    if (!d) throw notFound("File not found.");
    if (d.scan_status === "infected") throw conflict("FILE_QUARANTINED", "This file was flagged by the malware scan and cannot be downloaded.");
    if (d.scan_status === "pending") throw conflict("FILE_PENDING_SCAN", "This file is still being scanned. Try again shortly.");
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "deliverable.downloaded", subjectType: "deliverable", subjectId: d.id });
    const token = signPayload({ k: d.storage_key, n: d.file_name, m: d.mime_type, o: ctx.org.id }, 60);
    return { url: `/api/files/${token}`, expiresInSeconds: 60 };
  });
}

export function resolveFileToken(token: string): { key: string; name: string; mime: string; org: string } | null {
  const p = verifyPayload<{ k: string; n: string; m: string; o: string }>(token);
  if (!p) return null;
  return { key: p.k, name: p.n, mime: p.m, org: p.o };
}

/**
 * Malware scan adapter. With SCAN_PROVIDER=none, files stay quarantined (pending) unless
 * SCAN_ALLOW_UNSCANNED=true marks them clean for local development. Real scanning: docs/providers.md.
 */
export async function scanDeliverable(deliverableId: string) {
  const provider = process.env.SCAN_PROVIDER ?? "none";
  await withWorker(async (db) => {
    const d = await db.maybeOne<{ id: string; storage_key: string; sha256: string }>(`SELECT id, storage_key, sha256 FROM deliverables WHERE id = $1 AND scan_status = 'pending'`, [deliverableId]);
    if (!d) return;
    const bytes = await storage().get(d.storage_key);
    if (!bytes) { await db.query(`UPDATE deliverables SET scan_status = 'failed' WHERE id = $1`, [d.id]); return; }
    if (sha256(bytes) !== d.sha256) { await db.query(`UPDATE deliverables SET scan_status = 'failed' WHERE id = $1`, [d.id]); return; }
    if (provider === "none") {
      if (process.env.SCAN_ALLOW_UNSCANNED === "true") await db.query(`UPDATE deliverables SET scan_status = 'clean' WHERE id = $1`, [d.id]);
      return; // stays quarantined
    }
    throw new Error(`SCAN_PROVIDER=${provider} is not implemented`);
  });
}

export type { Db };
