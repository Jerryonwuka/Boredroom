"use client";

/**
 * The staff page: one card, "Your to-dos for today". Add a to-do, press Start (with or without screen
 * recording), press Done when finished. Done sends the work to the person who checks it; it shows as
 * "Sent for check" and then "Completed". A finished to-do never offers Start again.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Check, Sparkles, ChevronDown, Pencil, Circle, X } from "lucide-react";
import { SessionTimer, type CurrentSessionPayload, type StartableTask } from "@/components/app/session-timer";
import { CaptureProvider, useCaptureGate, useCaptureContext, captureSupport } from "@/components/app/capture";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { AnimatedList, AnimatedRow, AnimatePresence, Presence, Expand } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/edit-button";
import { Badge, label } from "@/components/ui/badge";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDuration, formatDateTime } from "@/lib/utils";
import type { TaskRow } from "@/server/services/views";
import type { SessionView } from "@/server/services/sessions";
import { DatePicker } from "@/components/ui/date-picker";

type PastTask = { id: string; title: string; status: string; completed_at: string | null; archived_at: string | null; tracked_seconds: number; created_by_name: string; self_made: boolean };
type Person = { id: string; display_name: string; team_name?: string; group?: "team" | "organisation" };
type Row = TaskRow & { created_by_name?: string };

type Props = {
  orgSlug: string; today: string; initialSession: CurrentSessionPayload;
  planned: TaskRow[]; ownTodos: TaskRow[]; fromLeads: (TaskRow & { created_by_name: string })[]; doneToday: { id: string; title: string; completed_at: string }[]; pastTasks: PastTask[];
  projects: { id: string; name: string }[]; members: Person[];
  /** People this member may hand to-dos to (team leads only; empty for staff). */
  assignable: Person[];
  membershipId: string; recordingMode: string; reportStatus: string | null; assistantConfigured: boolean; policyAcknowledged: boolean; todaySeconds: number;
};

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode}>
      <Board {...props} />
    </CaptureProvider>
  );
}

const ORDER: Record<string, number> = { in_progress: 0, todo: 1, blocked: 2, in_review: 3, completed: 4 };

function Board({ orgSlug, today, initialSession, planned, ownTodos, fromLeads, doneToday, pastTasks, assignable, membershipId, recordingMode, reportStatus, assistantConfigured, policyAcknowledged, todaySeconds }: Props) {
  const router = useRouter();
  const capture = useCaptureContext();
  const [session, setSession] = useState<SessionView | null>(initialSession.session);
  const [showAssistant, setShowAssistant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { captureGate, onSession, dialogEl, recordingControls } = useCaptureGate();
  const recordAfterStart = useRef(false);

  // One list: everything assigned to me that is not finished, running task first.
  const rows: Row[] = useMemo(() => {
    const seen = new Set<string>();
    const all: Row[] = [];
    for (const t of [...planned, ...fromLeads, ...ownTodos]) { if (!seen.has(t.id)) { seen.add(t.id); all.push(t); } }
    return all.sort((a, b) => (session?.taskId === a.id ? -1 : session?.taskId === b.id ? 1 : (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)));
  }, [planned, fromLeads, ownTodos, session?.taskId]);
  const startable: StartableTask[] = useMemo(() => rows.filter((t) => t.status !== "completed" && t.status !== "in_review" && !t.archived_at).map((t) => ({ id: t.id, title: t.title, project_name: t.project_name, status: t.status, capture_requirement: t.capture_requirement, estimate_minutes: t.estimate_minutes })), [rows]);
  const canRecord = recordingMode !== "disabled" && policyAcknowledged && captureSupport().supported;

  function onSessionChange(s: SessionView | null) {
    setSession(s);
    onSession(s);
    if (s && s.state === "running" && recordAfterStart.current) {
      recordAfterStart.current = false;
      if (s.captureMode !== "none" && capture) void capture.startCapture(s.id);
    }
  }
  function start(t: Row, record: boolean) {
    setError(null); setNotice(null);
    recordAfterStart.current = record;
    window.dispatchEvent(new CustomEvent("boredroom:start-task", { detail: { taskId: t.id } }));
  }
  async function done(t: Row) {
    setError(null); setNotice(null);
    try {
      let completed: boolean;
      if (session && session.taskId === t.id) {
        // Running on this task: stop the timer and hand the work over in one step.
        await api(`/api/orgs/${orgSlug}/sessions/${session.id}/stop`, { method: "POST", body: { expectedVersion: session.version, note: "", outcome: "completed" } });
        onSessionChange(null);
        completed = false;
      } else {
        const r = await api<{ completed: boolean }>(`/api/orgs/${orgSlug}/tasks/${t.id}/complete`, { method: "POST", body: {} });
        completed = r.completed;
      }
      setNotice(completed ? `“${t.title}” is completed.` : `“${t.title}” was sent for a check. It shows as Completed once it is approved.`);
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <SessionTimer orgSlug={orgSlug} initial={initialSession} tasks={startable} captureDialog={dialogEl} onSessionChange={onSessionChange} todaySeconds={todaySeconds}
          {...(recordingMode === "disabled" ? {} : { captureGate, recordingControls })} />
        {recordingMode === "disabled" ? <Alert tone="info">Screen recording is switched off for this organisation. An owner can turn it on under Settings, Screen recording.</Alert> : !policyAcknowledged ? <Alert tone="warning">To record your screen, first <Link className="underline" href={`/app/${orgSlug}/policy?next=/app/${orgSlug}/my-day`}>read and acknowledge the monitoring notice</Link>.</Alert> : null}
        <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
        <Presence show={!!notice}><Alert tone="success">{notice}</Alert></Presence>

        <section aria-labelledby="todo-heading" className="tile p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="todo-heading" className="font-display text-xl">Your to-dos for today</h2>
            <span className="text-sm text-fg-subtle tabular-nums">{rows.filter((r) => r.status !== "in_review").length} open, {doneToday.length} done</span>
          </div>
          <QuickTodo orgSlug={orgSlug} assignable={assignable} onDone={(msg) => { setNotice(msg ?? null); router.refresh(); }} onAssistant={() => setShowAssistant((v) => !v)} assistantOpen={showAssistant} />
          <Expand show={showAssistant} id="assistant-panel"><div className="mt-3"><AssistantPanel orgSlug={orgSlug} people={assignable} configured={assistantConfigured} onClose={() => setShowAssistant(false)} onCreated={(n) => { setNotice(`${n} to-do${n === 1 ? "" : "s"} added.`); router.refresh(); }} /></div></Expand>

          {rows.length === 0 && doneToday.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">Nothing on your list yet. Type your first to-do above and press Enter, then press Start when you begin.</p>
          ) : (
            <AnimatedList className="mt-4 divide-y divide-border-soft">
              <AnimatePresence initial={false}>
              {rows.map((t) => (
                <TodoRow key={t.id} t={t} orgSlug={orgSlug} self={membershipId} running={session?.taskId === t.id} anyRunning={!!session} canRecord={canRecord}
                  onStart={(record) => start(t, record)} onDone={() => done(t)} onSaved={(msg) => { setNotice(msg); router.refresh(); }} />
              ))}
              {doneToday.map((t) => (
                <AnimatedRow key={t.id} id={t.id} className="flex items-center gap-3 py-3 text-fg-muted">
                  <Badge tone="success"><Check className="size-3" aria-hidden /> Completed</Badge>
                  <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="min-w-0 flex-1 truncate line-through decoration-fg-faint hover:underline">{t.title}</Link>
                  <span className="text-xs text-fg-subtle">{formatDateTime(t.completed_at)}</span>
                </AnimatedRow>
              ))}
              </AnimatePresence>
            </AnimatedList>
          )}
        </section>

        <PastTasks orgSlug={orgSlug} items={pastTasks} onCleared={(n) => { setNotice(`${n} past task${n === 1 ? "" : "s"} cleared from your list.`); router.refresh(); }} />
      </div>

      <aside className="space-y-4">
        <div className="tile p-5">
          <h2 className="font-display text-lg">Daily report</h2>
          <p className="mt-1 text-sm text-fg-muted">{reportStatus ? `Status: ${label(reportStatus)}.` : "Built from your sessions and notes. Add blockers and next priorities, then submit."}</p>
          <Link href={`/app/${orgSlug}/timesheets?date=${today}`} className="mt-3 inline-block"><Button size="sm" variant={reportStatus === "approved" ? "subtle" : "primary"}>{reportStatus ? "Open report" : "Review and submit"}</Button></Link>
        </div>
        <div className="tile p-5 text-sm text-fg-muted">
          <h2 className="font-display text-lg text-fg">How it works</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>Write your to-dos for today. Your team lead may add some too.</li>
            <li>Press <strong className="text-fg">Start</strong> on the one you are working on{canRecord ? ", with or without screen recording" : ""}.</li>
            <li>Press <strong className="text-fg">Done</strong> when you finish. It goes to your lead for a quick check, then shows as Completed.</li>
            {assignable.length ? <li>As a team lead, use “For” to hand a to-do to someone on your team, or to anyone else in the organisation.</li> : null}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function TodoRow({ t, orgSlug, self, running, anyRunning, canRecord, onStart, onDone, onSaved }: { t: Row; orgSlug: string; self: string; running: boolean; anyRunning: boolean; canRecord: boolean; onStart: (record: boolean) => void; onDone: () => void; onSaved: (msg: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
  const fromLead = t.created_by !== self;
  const waiting = t.status === "in_review";
  return (
    <AnimatedRow id={t.id} className={`py-3 transition-[background-color] duration-[var(--duration)] ${running ? "-mx-4 rounded-[var(--radius-sm)] bg-accent-soft/40 px-4 md:-mx-5 md:px-5" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/app/${orgSlug}/tasks/${t.id}`} className={`font-semibold hover:underline ${waiting ? "text-fg-muted" : ""}`}>{t.title}</Link>
            {running ? <Badge tone="success" dot>Working now</Badge> : waiting ? <Badge tone="info">Sent for check</Badge> : t.status === "blocked" ? <Badge tone="danger">Blocked</Badge> : t.status === "in_progress" ? <Badge tone="accent">Started</Badge> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
            {fromLead ? <span>from {t.created_by_name ?? "your team lead"}</span> : null}
            {t.due_at ? <span className={overdue ? "text-danger" : ""}>due {formatDateTime(t.due_at)}{overdue ? ", overdue" : ""}</span> : null}
            {t.estimate_minutes ? <span>est. {formatDuration(t.estimate_minutes * 60)}</span> : null}
            {t.tracked_seconds ? <span className="tabular-nums">tracked {formatDuration(t.tracked_seconds)}</span> : null}
            {t.blocked_reason ? <span className="text-danger">blocked: {t.blocked_reason}</span> : null}
            {t.capture_requirement === "required" ? <Badge tone="warning">recording required</Badge> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {!waiting && !running ? <EditButton iconOnly label={`Edit ${t.title}`} aria-expanded={editing} onClick={() => { setEditing((v) => !v); setChoosing(false); }} /> : null}
          {waiting ? <Link href={`/app/${orgSlug}/tasks/${t.id}`}><Button size="sm" variant="ghost">View</Button></Link> : running ? (
            confirmDone ? <><Button size="sm" onClick={() => { setConfirmDone(false); onDone(); }}><Check className="size-4" aria-hidden />Yes, send for check</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDone(false)}>Not yet</Button></>
            : <Button size="sm" onClick={() => setConfirmDone(true)}><Check className="size-4" aria-hidden />Done</Button>
          ) : choosing ? (
            <>
              <Button size="sm" onClick={() => { setChoosing(false); onStart(false); }}>Start</Button>
              <Button size="sm" variant="outline" onClick={() => { setChoosing(false); onStart(true); }}><Circle className="size-3 fill-danger text-danger" aria-hidden />Start and record screen</Button>
              <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setChoosing(false)}><X className="size-4" aria-hidden /></Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={anyRunning} title={anyRunning ? "Stop or switch the running timer first" : undefined} onClick={() => (canRecord ? setChoosing(true) : onStart(false))}>{t.status === "in_progress" ? "Start" : "Start"}</Button>
              {t.status === "in_progress" || t.status === "blocked" ? (confirmDone ? <><Button size="sm" variant="outline" onClick={() => { setConfirmDone(false); onDone(); }}><Check className="size-4" aria-hidden />Yes, send for check</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDone(false)}>Not yet</Button></> : <Button size="sm" variant="outline" onClick={() => setConfirmDone(true)}><Check className="size-4" aria-hidden />Done</Button>) : null}
            </>
          )}
        </div>
      </div>
      <Expand show={editing}><EditTodo orgSlug={orgSlug} t={t} onClose={() => setEditing(false)} onSaved={(m) => { setEditing(false); onSaved(m); }} /></Expand>
    </AnimatedRow>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inline edit of a to-do: title, deadline (date and time), estimate. */
function EditTodo({ orgSlug, t, onClose, onSaved }: { orgSlug: string; t: Row; onClose: () => void; onSaved: (msg: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-3 grid gap-2 rounded-[var(--radius-sm)] border border-border bg-inset p-3 md:grid-cols-[1fr_auto_auto_auto]" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const f = new FormData(e.currentTarget);
      try {
        await api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: t.version, title: f.get("title"), dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, estimateMinutes: f.get("estimate") ? Number(f.get("estimate")) : null } });
        onSaved("To-do updated.");
      } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger" className="md:col-span-4">{error}</Alert> : null}
      <Field label="To-do" htmlFor={`title-${t.id}`}><Input id={`title-${t.id}`} name="title" defaultValue={t.title} required maxLength={200} /></Field>
      <Field label="Due date and time" htmlFor={`due-${t.id}`} hint="optional"><DatePicker mode="datetime" id={`due-${t.id}`} name="dueAt" defaultValue={toLocalInput(t.due_at)} className="w-56" /></Field>
      <Field label="Estimate (min)" htmlFor={`est-${t.id}`} hint="optional"><Input id={`est-${t.id}`} name="estimate" type="number" min={1} defaultValue={t.estimate_minutes ?? ""} className="w-28" /></Field>
      <div className="flex items-end gap-1"><Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button><Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button></div>
    </form>
  );
}

function PastTasks({ orgSlug, items, onCleared }: { orgSlug: string; items: PastTask[]; onCleared: (n: number) => void }) {
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <details className="tile group p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <span className="flex items-center gap-2 font-display text-lg"><ChevronDown className="size-4 transition-transform duration-[var(--duration-fast)] group-open:rotate-180" aria-hidden />Past tasks <span className="text-sm text-fg-subtle tabular-nums">({items.length})</span></span>
        <span className="text-xs text-fg-subtle">completed or removed earlier</span>
      </summary>
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      <ul className="mt-3 space-y-1 text-sm">{items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 text-fg-muted">
          {t.status === "completed" ? <Badge tone="success">Completed</Badge> : <Badge tone="neutral">Removed</Badge>}
          <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="text-fg hover:underline">{t.title}</Link>
          <span className="text-xs text-fg-subtle">{t.completed_at ? formatDateTime(t.completed_at) : t.archived_at ? formatDateTime(t.archived_at) : ""}{t.tracked_seconds ? `, ${formatDuration(t.tracked_seconds)}` : ""}{t.self_made ? "" : `, from ${t.created_by_name}`}</span>
        </li>
      ))}</ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirm ? <>
          <Button size="sm" variant="danger" disabled={pending} onClick={async () => { setPending(true); setError(null); try { const r = await api<{ cleared: number }>(`/api/orgs/${orgSlug}/todos/clear`, { method: "POST", body: {} }); setConfirm(false); onCleared(r.cleared); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>Yes, clear my list</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </> : <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Clear past tasks</Button>}
        <span className="text-xs text-fg-subtle">Clearing only tidies your list. Records, reports and your team lead&apos;s views keep everything.</span>
      </div>
    </details>
  );
}

/**
 * The simplest entry point: a title, Enter, done. "Details" adds a description and a deadline;
 * team leads also get "For", which hands the to-do to someone on their team (they are notified).
 */
function QuickTodo({ orgSlug, assignable, onDone, onAssistant, assistantOpen }: { orgSlug: string; assignable: Person[]; onDone: (message?: string) => void; onAssistant: () => void; assistantOpen: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignee, setAssignee] = useState("");
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const person = assignable.find((p) => p.id === assignee);
  return (
    <form className="grid gap-2" onSubmit={async (e) => {
      e.preventDefault(); if (!title.trim()) return; setPending(true); setError(null); setFieldErrors({});
      try {
        await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: title.trim(), description: description.trim() || null, dueAt: dueAt ? new Date(dueAt).toISOString() : null, assigneeMembershipId: assignee || null } });
        setTitle(""); setDescription(""); setDueAt("");
        onDone(person ? `“${title.trim()}” was handed to ${person.display_name}; they have been notified.` : undefined);
      }
      catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); } finally { setPending(false); }
    }}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="quick-todo" className="sr-only">Add a to-do</label>
        <Input id="quick-todo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a to-do and press Enter…" maxLength={200} className="min-w-[240px] flex-1" autoComplete="off" />
        {assignable.length ? (
          <Select aria-label="For" className="h-11 w-44 py-1 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">For: me</option>
            {assignable.some((p) => p.group === "team") ? <optgroup label="Your team">{assignable.filter((p) => p.group !== "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}</option>)}</optgroup> : null}
            {assignable.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{assignable.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
          </Select>
        ) : null}
        <Button type="submit" disabled={pending || !title.trim()}><Plus className="size-4" aria-hidden />{pending ? "Adding…" : person ? "Hand out" : "Add"}</Button>
        <Button type="button" variant="ghost" size="sm" aria-expanded={details} aria-controls="quick-details" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Date and details"}</Button>
        <Button type="button" variant={assistantOpen ? "subtle" : "ghost"} size="sm" aria-expanded={assistantOpen} aria-controls="assistant-panel" onClick={onAssistant}><Sparkles className="size-4 text-accent" aria-hidden />Assistant</Button>
      </div>
      <Expand show={details} id="quick-details">
        <div className="grid gap-2 pt-1 md:grid-cols-[1fr_auto]">
          <Field label="Description" htmlFor="quick-desc" hint="optional" error={fieldErrors.description}><Textarea id="quick-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} placeholder="What does done look like? Any links or context." /></Field>
          <Field label="Due date and time" htmlFor="quick-due" hint="optional" error={fieldErrors.dueAt}><DatePicker mode="datetime" id="quick-due" value={dueAt} onChange={(v) => setDueAt(v)} className="w-56" /></Field>
        </div>
      </Expand>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}
