"use client";

/**
 * The task page's actions and forms, v4: the header's buttons (outline first, the one primary last), Mark blocked in a
 * popover, Edit in a right-hand sheet, and the submission, review and reopen forms as cards in the page. Every form
 * shows a refusal next to the field it is about, and only what changed is sent.
 *
 * Blocked on whom (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"; contract H.5): Mark blocked
 * also asks "Waiting on" ("Nobody in particular" first, then the workspace's people) and, once someone is chosen, "Your
 * question to them" (started from what is blocking it, up to 500 characters). It marks the task blocked first, then names
 * who it waits on; if that second step is refused, the task stays blocked and the server's words show above the buttons
 * (the task page then offers "Waiting on someone?"). Without migration 0048 (`block.ready` false) the fields are hidden
 * and Mark blocked works as before.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/edit-button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge, label } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import { api, isApiFailure } from "@/lib/api-client";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationPicker } from "@/components/ui/duration-picker";
import { WaitingOnFields, blockFailure, putBlock, type BlockPerson } from "@/components/app/blocked-on";
import { LOOP_LIMITS } from "@/lib/commitments";
import { cn } from "@/lib/utils";

function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setPending(true); setError(null); setFieldErrors({});
    try { const r = await fn(); after?.(r); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server. Check your connection and try again."); return null; }
    finally { setPending(false); }
  }
  /** Forgets the last refusal, so a form opened again starts clean. */
  const reset = () => { setError(null); setFieldErrors({}); };
  return { pending, error, fieldErrors, submit, reset, router };
}

/** Statuses the person holding a task can still finish or block. */
const OPEN = ["todo", "in_progress", "blocked"];

type TaskLite = { id: string; version: number; status: string; archived: boolean; blockedReason: string | null };
/** What the edit sheet starts from: the task as it stands, so saving one field never resets the others. */
type TaskEditable = { reviewerId: string | null; assigneeId: string; estimateMinutes: number | null; dueAt: string | null; priority: string };

/** An instant as the date picker's local "yyyy-mm-ddThh:mm". Only runs in the browser: the edit sheet opens on a click. */
function localDateTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TaskActions({ orgSlug, task, isAssignee, canManage, members, current, block }: {
  orgSlug: string; task: TaskLite; isAssignee: boolean; canManage: boolean; members: { id: string; display_name: string }[]; current: TaskEditable;
  /** Phase 7b: who a blocked task can wait on (task-blocks `blockFor`); absent or not ready: Mark blocked as before. */
  block?: { ready: boolean; people: BlockPerson[] };
}) {
  const { pending, error, fieldErrors, submit, reset, router } = useForm();
  const [mode, setModeState] = useState<null | "block" | "edit">(null);
  // Phase 7b: Mark blocked's "Waiting on" and question, and a refusal of that second step (the task stays blocked).
  const [reason, setReason] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [question, setQuestion] = useState("");
  const [naming, setNaming] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const setMode = (m: null | "block" | "edit") => {
    if (m) reset();
    if (m === "block") { setReason(task.blockedReason ?? ""); setWaitingOn(""); setQuestion(""); setBlockError(null); }
    setModeState(m);
  };
  const patch = (body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}`, { method: "PATCH", body: { expectedVersion: task.version, ...body } }), () => setModeState(null));
  const naming0048 = !!block?.ready && block.people.length > 0;
  /** Marks the task blocked, then (phase 7b) names who it waits on. A refusal of the second step keeps it blocked and says why. */
  const markBlocked = async () => {
    const q = question.trim();
    if (waitingOn && !q) { setBlockError("Say what you need from them."); return; }
    let blocked = false;
    await submit(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}`, { method: "PATCH", body: { expectedVersion: task.version, status: "blocked", reason } }), () => { blocked = true; });
    if (!blocked) return;
    setModeState(null);
    if (!waitingOn) return;
    setNaming(true);
    try { await putBlock(orgSlug, task.id, waitingOn, q); setBlockError(null); }
    catch (err) { setBlockError(`The task is blocked, but who it waits on wasn't saved: ${blockFailure(err).replace(/\.$/, "")}.`); }
    finally { setNaming(false); router.refresh(); }
  };
  if (task.archived) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {error && mode !== "edit" && mode !== "block" ? <Alert tone="danger">{error}</Alert> : null}
      {blockError && mode !== "block" ? <Alert tone="danger">{blockError}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(isAssignee || canManage) && task.status !== "completed" ? <EditButton iconOnly label="Edit task" aria-haspopup="dialog" className="size-8 rounded-[10px]" onClick={() => setMode("edit")} /> : null}
        {/* "Delete", as in the task list and its sheet: the same action keeps one name (the task is archived; history stays). */}
        {canManage && task.status !== "in_progress" ? <ConfirmButton size="sm" variant="ghost" disabled={pending} title="Delete this task?" description="It leaves every list. Its history is kept, and nothing can be started on it again." confirmLabel="Delete task" onConfirm={() => patch({ archive: true })}>Delete</ConfirmButton> : null}
        {isAssignee && task.status === "in_progress" ? (
          <Popover label="Mark blocked" align="end" width={320} open={mode === "block"} onOpenChange={(o) => setMode(o ? "block" : null)}
            trigger={<Button size="sm" variant="secondary">Mark blocked</Button>}>
            {/* Cancel closes through the popover, which hands the focus back to Mark blocked (as Escape does). */}
            {(close) => (
              <form id="block-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void markBlocked(); }}>
                {error && !fieldErrors.reason ? <Alert tone="danger">{error}</Alert> : null}
                {blockError ? <Alert tone="danger">{blockError}</Alert> : null}
                <Field label="What is blocking you?" htmlFor="block-reason" error={fieldErrors.reason}><Textarea id="block-reason" name="reason" required maxLength={2000} className="min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                {/* Phase 7b: who it waits on, and the question their assistant brings them. */}
                {naming0048 && block ? (
                  <WaitingOnFields people={block.people} waitingOn={waitingOn} question={question} onQuestion={setQuestion} disabled={pending || naming}
                    onWaitingOn={(v) => { setWaitingOn(v); setBlockError(null); if (v && !question.trim()) setQuestion(reason.trim().slice(0, LOOP_LIMITS.questionMax)); }} />
                ) : null}
                <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={close}>Cancel</Button><Button size="sm" type="submit" loading={pending || naming}>{pending || naming ? "Saving…" : "Mark blocked"}</Button></div>
              </form>
            )}
          </Popover>
        ) : null}
        {isAssignee && task.status === "blocked" ? <Button size="sm" variant="secondary" loading={pending} onClick={() => patch({ status: "in_progress" })}>{pending ? "Unblocking…" : "Unblock"}</Button> : null}
        {isAssignee && OPEN.includes(task.status) ? <ConfirmButton size="sm" variant="primary" disabled={pending} tone="primary" title="Mark this task done?" description="If someone else handed it to you it goes to them for a quick check; your own to-dos complete at once." confirmLabel="Mark done" onConfirm={() => submit(() => api(`/api/orgs/${orgSlug}/tasks/${task.id}/complete`, { method: "POST", body: { note: "" } }))}>Mark done</ConfirmButton> : null}
      </div>
      {mode === "edit" ? (
        <EditTaskSheet onClose={() => setMode(null)} pending={pending} error={error} fieldErrors={fieldErrors} canManage={canManage} members={members} current={current}
          onSubmit={(body) => { if (Object.keys(body).length === 0) setMode(null); else void patch(body); }} />
      ) : null}
    </div>
  );
}

/**
 * The task's edit form in a right-hand sheet (owner decision, 28 September 2026): reviewer, assignee, estimate, due,
 * priority. Every field starts at the task's own value and only what changed is sent, so editing the reviewer
 * cannot clear the due date or reset the priority. A refusal shows here, next to the field it is about.
 */
function EditTaskSheet({ onClose, onSubmit, pending, error, fieldErrors, canManage, members, current }: { onClose: () => void; onSubmit: (body: Record<string, unknown>) => void; pending: boolean; error: string | null; fieldErrors: Record<string, string[]>; canManage: boolean; members: { id: string; display_name: string }[]; current: TaskEditable }) {
  const formId = useId();
  const [due] = useState(() => localDateTime(current.dueAt));
  const submitChanges = (f: FormData) => {
    const body: Record<string, unknown> = {};
    const reviewer = String(f.get("reviewerMembershipId") ?? "") || null;
    if (reviewer !== current.reviewerId) body.reviewerMembershipId = reviewer;
    const estimate = f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null;
    if (estimate !== current.estimateMinutes) body.estimateMinutes = estimate;
    const dueAt = String(f.get("dueAt") ?? "");
    if (dueAt !== due) body.dueAt = dueAt ? new Date(dueAt).toISOString() : null;
    const priority = String(f.get("priority") ?? current.priority);
    if (priority !== current.priority) body.priority = priority;
    if (canManage) {
      const assignee = String(f.get("assigneeMembershipId") ?? current.assigneeId);
      if (assignee !== current.assigneeId) body.assigneeMembershipId = assignee;
    }
    onSubmit(body);
  };
  const unplaced = error && !["reviewerMembershipId", "assigneeMembershipId", "estimateMinutes", "dueAt", "priority"].some((k) => fieldErrors[k]?.length);
  return (
    <Sheet open onClose={onClose} dismissible={false} title="Edit task" description="Only what you change is saved."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Saving…" : "Save changes"}</Button></>}>
      <form id={formId} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submitChanges(new FormData(e.currentTarget)); }}>
        {unplaced ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Reviewer" htmlFor="e-rev" error={fieldErrors.reviewerMembershipId}><Select id="e-rev" name="reviewerMembershipId" defaultValue={current.reviewerId ?? ""}><option value="">None yet</option>{members.filter((m) => m.id !== current.assigneeId).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
        {canManage ? <Field label="Assignee" htmlFor="e-asg" hint="Can't change while a work session is open" error={fieldErrors.assigneeMembershipId}><Select id="e-asg" name="assigneeMembershipId" defaultValue={current.assigneeId}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estimated time" htmlFor="e-est" error={fieldErrors.estimateMinutes}><DurationPicker id="e-est" name="estimateMinutes" defaultValue={current.estimateMinutes} /></Field>
          <Field label="Due" htmlFor="e-due" hint="Optional" error={fieldErrors.dueAt}><DatePicker mode="datetime" id="e-due" name="dueAt" defaultValue={due} /></Field>
        </div>
        <Field label="Priority" htmlFor="e-pri" error={fieldErrors.priority}><Select id="e-pri" name="priority" defaultValue={current.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
      </form>
    </Sheet>
  );
}

export function SubmissionForm({ orgSlug, taskId, hasReviewer, autoOpen, nextRevision }: { orgSlug: string; taskId: string; hasReviewer: boolean; autoOpen: boolean; nextRevision: number }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(autoOpen);
  const [links, setLinks] = useState<{ url: string; notes: string }[]>([]);
  const [files, setFiles] = useState<{ id: string; fileName: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const formId = useId();
  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-fill-0 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Ready to hand it in?</p>
          <p className="text-meta font-normal text-secondary">Send revision {nextRevision} with a note, links and files for review.</p>
        </div>
        <Button size="sm" variant="secondary" aria-label={`Submit for review (revision ${nextRevision})`} onClick={() => setOpen(true)}><Upload aria-hidden />Submit for review</Button>
      </div>
    );
  }
  return (
    <Card>
      <form id={formId} className="grid gap-4" aria-labelledby={`${formId}-title`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/tasks/${taskId}/submissions`, { method: "POST", body: { note: f.get("note"), links: links.filter((l) => l.url), fileIds: files.map((x) => x.id) } }), () => setOpen(false)); }}>
        <CardHeader title={<span id={`${formId}-title`}>Submit revision {nextRevision} for review</span>} className="mb-0" />
        {!hasReviewer ? <Alert tone="warning">Set a reviewer first: press the pencil (Edit task) at the top and choose who checks it. You cannot review your own work.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Progress note" htmlFor="sub-note" error={fieldErrors.note}><Textarea id="sub-note" name="note" maxLength={4000} autoFocus placeholder="What was delivered and where the reviewer should look." /></Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Links <span className="font-normal text-secondary">https only; Boredroom never fetches them</span></legend>
          {links.map((l, i) => {
            // Empty rows are left out when sending, so the server numbers the links it was sent, not the rows on screen.
            const linkError = l.url ? fieldErrors[`links.${links.slice(0, i).filter((x) => x.url).length}.url`]?.[0] : undefined;
            const errorId = `${formId}-link-${i}-error`;
            return (
              <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <Input aria-label={`Link ${i + 1} address`} type="url" placeholder="https://www.figma.com/file/…" value={l.url} aria-invalid={linkError ? true : undefined} aria-describedby={linkError ? errorId : undefined} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <Input aria-label={`Link ${i + 1} note`} placeholder="What this shows" value={l.notes} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" className="justify-self-start md:self-center" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</Button>
                {linkError ? <p id={errorId} role="alert" className="text-meta font-medium text-danger md:col-span-3">{linkError}</p> : null}
              </div>
            );
          })}
          <div><Button variant="secondary" size="sm" onClick={() => setLinks([...links, { url: "", notes: "" }])}>Add link</Button></div>
        </fieldset>
        <div>
          <label htmlFor={`${formId}-file`} className="mb-1.5 block text-sm font-medium text-foreground">Files <span className="font-normal text-secondary">PDF, PNG, JPEG, WebP, TXT, up to 20 MB, stored privately, scanned before download</span></label>
          {files.length ? <ul className="mb-2 space-y-1">{files.map((f) => <li key={f.id} className="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-fill-0 py-1 pl-3 pr-1 text-sm"><span className="min-w-0 truncate">{f.fileName} <span className="tabular-nums text-secondary">{(f.size / 1024).toFixed(0)} KB</span></span><Button variant="ghost" size="xs" aria-label={`Remove ${f.fileName}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>Remove</Button></li>)}</ul> : null}
          {/* The native picker, its button drawn as the small outline button so it matches the rest of the form. */}
          <input id={`${formId}-file`} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" disabled={uploading} aria-describedby={uploadError ? `${formId}-file-error` : undefined}
            className="block w-full max-w-full text-meta font-normal text-secondary file:mr-3 file:h-8 file:cursor-pointer file:rounded-[10px] file:border file:border-solid file:border-border-input file:bg-background file:px-2.5 file:text-meta file:font-medium file:text-foreground file:transition-colors hover:file:border-border-input-hover disabled:opacity-50"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0]; if (!file) return; setUploading(true); setUploadError(null);
              try {
                const fd = new FormData(); fd.append("file", file);
                const res = await fetch(`/api/orgs/${orgSlug}/tasks/${taskId}/uploads`, { method: "POST", body: fd, credentials: "same-origin" });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message ?? `Upload failed (${res.status}). Try again, or attach a smaller file.`);
                setFiles((prev) => [...prev, data]);
              } catch (err) { setUploadError(err instanceof TypeError ? "Cannot reach the server. Check your connection and try again." : (err as Error).message); } finally { setUploading(false); input.value = ""; }
            }} />
          {uploading ? <p role="status" className="mt-1.5 text-meta text-secondary">Uploading…</p> : null}
          {uploadError ? <p id={`${formId}-file-error`} role="alert" className="mt-1.5 text-meta font-medium text-danger">{uploadError}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={uploading || !hasReviewer} loading={pending}>{pending ? "Submitting…" : "Submit for review"}</Button></div>
      </form>
    </Card>
  );
}

/** The decision on a revision. `bare` drops the card (inside a sheet). */
export function ReviewForm({ orgSlug, submissionId, revision, onDone, bare = false }: { orgSlug: string; submissionId: string; revision: number; onDone?: () => void; bare?: boolean }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [decision, setDecision] = useState("approved");
  const [note, setNote] = useState("");
  const ids = useId();
  const form = (
    <form className="grid gap-4" aria-labelledby={`${ids}-title`} onSubmit={(e) => { e.preventDefault(); submit(() => api(`/api/orgs/${orgSlug}/submissions/${submissionId}/review`, { method: "POST", body: { decision, note } }), () => onDone?.()); }}>
      {bare ? <h3 id={`${ids}-title`} className="text-sm font-semibold text-foreground">Review revision {revision}</h3> : <CardHeader title={<span id={`${ids}-title`}>Review revision {revision}</span>} className="mb-0" />}
      {error && !fieldErrors.note ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Decision" htmlFor={`${ids}-dec`} error={fieldErrors.decision}><Select id={`${ids}-dec`} name="decision" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="approved">Approve: completes the task</option><option value="changes_requested">Request changes: back to active work</option><option value="question">Ask a question: stays in review</option></Select></Field>
      <Field label="Note" htmlFor={`${ids}-note`} hint={decision === "approved" ? "Optional" : "Required: say what to change or what you need to know"} error={fieldErrors.note}><Textarea id={`${ids}-note`} name="note" maxLength={4000} required={decision !== "approved"} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={pending}>{pending ? "Sending…" : decision === "approved" ? "Approve" : decision === "changes_requested" ? "Request changes" : "Ask the question"}</Button></div>
    </form>
  );
  return bare ? <div className="rounded-2xl border border-border p-4">{form}</div> : <Card>{form}</Card>;
}

export function ReopenForm({ orgSlug, taskId, version }: { orgSlug: string; taskId: string; version: number }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(false);
  const formId = useId();
  if (!open) return <div><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Reopen completed task</Button></div>;
  return (
    <Card>
      <form id={formId} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/tasks/${taskId}`, { method: "PATCH", body: { expectedVersion: version, status: "in_progress", reason: f.get("reason") } }), () => setOpen(false)); }}>
        {error && !fieldErrors.reason ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Reason for reopening" htmlFor="ro-reason" error={fieldErrors.reason}><Textarea id="ro-reason" name="reason" required maxLength={2000} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" type="submit" loading={pending}>{pending ? "Reopening…" : "Reopen task"}</Button></div>
      </form>
    </Card>
  );
}

export function DeliverableList({ orgSlug, items }: { orgSlug: string; items: { id: string; kind: string; url: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null; scan_status: string; notes: string | null }[] }) {
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1">
      {error ? <li><Alert tone="danger">{error}</Alert></li> : null}
      {items.map((d) => (
        <li key={d.id} className={cn("flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-fill-0 px-3 py-2 text-sm")}>
          {d.kind === "link" ? <><a href={d.url!} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-all font-medium text-foreground underline decoration-border-input-hover underline-offset-4 transition-colors hover:decoration-foreground">{d.url}</a>{d.notes ? <span className="font-normal text-secondary">{d.notes}</span> : null}</> : (
            <>
              <span className="min-w-0 flex-1 break-words font-medium">{d.file_name} <span className="font-normal text-secondary">{d.mime_type}, <span className="tabular-nums">{Math.round((d.size_bytes ?? 0) / 1024)} KB</span></span></span>
              <Badge tone={d.scan_status === "clean" ? "success" : d.scan_status === "infected" ? "danger" : "warning"}>{d.scan_status === "pending" ? "Scan pending" : label(d.scan_status)}</Badge>
              {d.scan_status === "clean" ? <Button size="xs" variant="secondary" loading={fetching === d.id} onClick={async () => { setError(null); setFetching(d.id); try { const r = await api<{ url: string }>(`/api/orgs/${orgSlug}/deliverables/${d.id}/download`, { method: "POST" }); window.location.href = r.url; } catch (err) { setError(isApiFailure(err) ? err.error.message : "The download could not start: cannot reach the server. Try again."); } finally { setFetching(null); } }}>{fetching === d.id ? "Preparing…" : "Download"}</Button> : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
