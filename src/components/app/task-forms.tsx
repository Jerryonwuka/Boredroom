"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { api, isApiFailure } from "@/lib/api-client";

function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setPending(true); setError(null); setFieldErrors({});
    try { const r = await fn(); after?.(r); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, fieldErrors, submit, router };
}

type TaskLite = { id: string; version: number; status: string; archived: boolean; blockedReason: string | null };

export function TaskActions({ orgSlug, task, isAssignee, canManage, members, reviewerId, assigneeId }: { orgSlug: string; task: TaskLite; isAssignee: boolean; canManage: boolean; members: { id: string; display_name: string }[]; reviewerId: string | null; assigneeId: string }) {
  const { pending, error, submit } = useForm();
  const [mode, setMode] = useState<null | "block" | "edit">(null);
  const patch = (body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}`, { method: "PATCH", body: { expectedVersion: task.version, ...body } }), () => setMode(null));
  if (task.archived) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {isAssignee && task.status === "in_progress" ? <Button size="sm" variant="subtle" onClick={() => setMode("block")}>Mark blocked</Button> : null}
        {isAssignee && task.status === "blocked" ? <Button size="sm" variant="subtle" disabled={pending} onClick={() => patch({ status: "in_progress" })}>Unblock</Button> : null}
        {(isAssignee || canManage) && task.status !== "completed" ? <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>Edit</Button> : null}
        {canManage && task.status !== "in_progress" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Archive this task? History is kept; no new sessions can start.")) patch({ archive: true }); }}>Archive</Button> : null}
      </div>
      {mode === "block" ? (
        <form className="tile grid w-80 gap-2 p-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); patch({ status: "blocked", reason: f.get("reason") }); }}>
          <Field label="What is blocking you?" htmlFor="block-reason"><Textarea id="block-reason" name="reason" required maxLength={2000} /></Field>
          <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>Mark blocked</Button><Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button></div>
        </form>
      ) : null}
      {mode === "edit" ? (
        <form className="tile grid w-96 gap-2 p-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, unknown> = { reviewerMembershipId: f.get("reviewerMembershipId") || null, estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null, dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, priority: f.get("priority") }; if (canManage) { body.assigneeMembershipId = f.get("assigneeMembershipId"); body.captureRequirement = f.get("captureRequirement"); } patch(body); }}>
          <Field label="Reviewer" htmlFor="e-rev"><Select id="e-rev" name="reviewerMembershipId" defaultValue={reviewerId ?? ""}><option value="">None yet</option>{members.filter((m) => m.id !== assigneeId).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
          {canManage ? <Field label="Assignee" htmlFor="e-asg" hint="blocked while a session is open"><Select id="e-asg" name="assigneeMembershipId" defaultValue={assigneeId}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field> : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Estimate (min)" htmlFor="e-est"><Input id="e-est" name="estimateMinutes" type="number" min={1} /></Field>
            <Field label="Due" htmlFor="e-due"><Input id="e-due" name="dueAt" type="datetime-local" /></Field>
          </div>
          <Field label="Priority" htmlFor="e-pri"><Select id="e-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
          {canManage ? <Field label="Capture" htmlFor="e-cap"><Select id="e-cap" name="captureRequirement" defaultValue="none"><option value="none">Not requested</option><option value="optional">Optional</option><option value="required">Required</option></Select></Field> : null}
          <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button></div>
        </form>
      ) : null}
    </div>
  );
}

export function SubmissionForm({ orgSlug, taskId, hasReviewer, autoOpen, nextRevision }: { orgSlug: string; taskId: string; hasReviewer: boolean; autoOpen: boolean; nextRevision: number }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(autoOpen);
  const [links, setLinks] = useState<{ url: string; notes: string }[]>([]);
  const [files, setFiles] = useState<{ id: string; fileName: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  if (!open) return <Button onClick={() => setOpen(true)}>Submit for review (revision {nextRevision})</Button>;
  return (
    <form className="tile grid gap-3 p-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/tasks/${taskId}/submissions`, { method: "POST", body: { note: f.get("note"), links: links.filter((l) => l.url), fileIds: files.map((x) => x.id) } }), () => setOpen(false)); }}>
      <h2 className="font-display text-lg">Submit revision {nextRevision} for review</h2>
      {!hasReviewer ? <Alert tone="warning">Set a reviewer (Edit) before submitting. You cannot review your own work.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Progress note" htmlFor="sub-note" error={fieldErrors.note}><Textarea id="sub-note" name="note" maxLength={4000} placeholder="What was delivered and where the reviewer should look." /></Field>
      <div>
        <p className="mb-1 text-sm font-semibold text-fg-muted">Links <span className="font-normal text-fg-subtle">(https only; Boredroom never fetches them)</span></p>
        {links.map((l, i) => (
          <div key={i} className="mb-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input aria-label="Link URL" type="url" placeholder="https://www.figma.com/file/…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <Input aria-label="Link note" placeholder="What this shows" value={l.notes} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
            <Button variant="ghost" size="sm" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setLinks([...links, { url: "", notes: "" }])}>Add link</Button>
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold text-fg-muted">Files <span className="font-normal text-fg-subtle">(PDF, PNG, JPEG, WebP, TXT · up to 20 MB · stored privately, scanned before download)</span></p>
        <ul className="mb-2 text-sm">{files.map((f) => <li key={f.id}>{f.fileName} · {(f.size / 1024).toFixed(0)} KB <Button variant="ghost" size="sm" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>Remove</Button></li>)}</ul>
        <input aria-label="Choose file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" disabled={uploading} onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return; setUploading(true); setUploadError(null);
          try {
            const fd = new FormData(); fd.append("file", file);
            const res = await fetch(`/api/orgs/${orgSlug}/tasks/${taskId}/uploads`, { method: "POST", body: fd, credentials: "same-origin" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message ?? "Upload failed");
            setFiles([...files, data]);
          } catch (err) { setUploadError((err as Error).message); } finally { setUploading(false); e.target.value = ""; }
        }} />
        {uploadError ? <p className="mt-1 text-sm text-danger">{uploadError}</p> : null}
      </div>
      <div className="flex gap-2"><Button type="submit" disabled={pending || uploading || !hasReviewer}>{pending ? "Submitting…" : "Submit for review"}</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function ReviewForm({ orgSlug, submissionId, revision }: { orgSlug: string; submissionId: string; revision: number }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [decision, setDecision] = useState("approved");
  const [note, setNote] = useState("");
  return (
    <form className="tile grid gap-3 border-info/40 p-4" onSubmit={(e) => { e.preventDefault(); submit(() => api(`/api/orgs/${orgSlug}/submissions/${submissionId}/review`, { method: "POST", body: { decision, note } })); }}>
      <h2 className="font-display text-lg">Review revision {revision}</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Decision" htmlFor="rv-dec"><Select id="rv-dec" name="decision" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="approved">Approve — completes the task</option><option value="changes_requested">Request changes — returns to active work</option><option value="question">Ask a question — stays in review</option></Select></Field>
      <Field label="Note" htmlFor="rv-note" hint="required unless approving" error={fieldErrors.note}><Textarea id="rv-note" name="note" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Submit review"}</Button></div>
    </form>
  );
}

export function ReopenForm({ orgSlug, taskId, version }: { orgSlug: string; taskId: string; version: number }) {
  const { pending, error, submit } = useForm();
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="subtle" size="sm" onClick={() => setOpen(true)}>Reopen completed task</Button>;
  return (
    <form className="tile grid gap-2 p-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/tasks/${taskId}`, { method: "PATCH", body: { expectedVersion: version, status: "in_progress", reason: f.get("reason") } }), () => setOpen(false)); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Reason for reopening" htmlFor="ro-reason"><Textarea id="ro-reason" name="reason" required maxLength={2000} /></Field>
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>Reopen</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function CommentForm({ orgSlug, taskId }: { orgSlug: string; taskId: string }) {
  const { pending, error, submit } = useForm();
  return (
    <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); submit(() => api(`/api/orgs/${orgSlug}/tasks/${taskId}/comments`, { method: "POST", body: { body: f.get("body") } }), () => form.reset()); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label htmlFor="c-body" className="sr-only">Comment</label>
      <Textarea id="c-body" name="body" required maxLength={4000} placeholder="Ask a question or leave an update" className="min-h-16" />
      <div><Button size="sm" type="submit" variant="outline" disabled={pending}>Post</Button></div>
    </form>
  );
}

export function DeliverableList({ orgSlug, items }: { orgSlug: string; items: { id: string; kind: string; url: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null; scan_status: string; notes: string | null }[] }) {
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {error ? <li><Alert tone="danger">{error}</Alert></li> : null}
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2">
          {d.kind === "link" ? <><a href={d.url!} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline break-all">{d.url}</a>{d.notes ? <span className="text-fg-muted">— {d.notes}</span> : null}</> : (
            <>
              <span>{d.file_name} <span className="text-fg-subtle">({d.mime_type}, {Math.round((d.size_bytes ?? 0) / 1024)} KB)</span></span>
              <Badge tone={d.scan_status === "clean" ? "success" : d.scan_status === "infected" ? "danger" : "warning"}>{d.scan_status === "pending" ? "scan pending" : d.scan_status}</Badge>
              {d.scan_status === "clean" ? <Button size="sm" variant="ghost" onClick={async () => { setError(null); try { const r = await api<{ url: string }>(`/api/orgs/${orgSlug}/deliverables/${d.id}/download`, { method: "POST" }); window.location.href = r.url; } catch (err) { setError(isApiFailure(err) ? err.error.message : "Download failed"); } }}>Download</Button> : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
