"use client";

/**
 * The staff page: one card, "Your to-dos for today". Add a to-do, press Start (with or without screen
 * recording), press Done when finished. Done sends the work to the person who checks it; it shows as
 * "Sent for check" and then "Completed". A finished to-do never offers Start again.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Check, Sparkles, ChevronDown, Circle, X, Trash2, ExternalLink, Play, CalendarClock, Hourglass, Timer } from "lucide-react";
import { EditButton } from "@/components/ui/edit-button";
import { Avatar } from "@/components/ui/avatar";
import { SessionTimer, type CurrentSessionPayload, type StartableTask } from "@/components/app/session-timer";
import { CaptureProvider, useCaptureGate, useCaptureContext, captureSupport } from "@/components/app/capture";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { Presence, Expand } from "@/components/ui/motion";
import { Tabs } from "@/components/ui/tabs";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ProgressArc } from "@/components/ui/progress-arc";
import { DurationPicker } from "@/components/ui/duration-picker";
import { successToast } from "@/components/app/tasks-page";
import { Button } from "@/components/ui/button";
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
  const [tab, setTab] = useState<"todo" | "in_progress" | "upcoming" | "done">("todo");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // One list: everything assigned to me that is not finished, running task first.
  const rows: Row[] = useMemo(() => {
    const seen = new Set<string>();
    const all: Row[] = [];
    for (const t of [...planned, ...fromLeads, ...ownTodos]) { if (!seen.has(t.id)) { seen.add(t.id); all.push(t); } }
    return all.sort((a, b) => (session?.taskId === a.id ? -1 : session?.taskId === b.id ? 1 : (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)));
  }, [planned, fromLeads, ownTodos, session?.taskId]);
  const startable: StartableTask[] = useMemo(() => rows.filter((t) => t.status !== "completed" && t.status !== "in_review" && !t.archived_at).map((t) => ({ id: t.id, title: t.title, project_name: t.project_name, status: t.status, capture_requirement: t.capture_requirement, estimate_minutes: t.estimate_minutes, progress_percent: t.progress_percent, version: t.version })), [rows]);
  const canRecord = recordingMode !== "disabled" && policyAcknowledged && captureSupport().supported;
  // The tabs (owner decision, 28 September 2026): to do, in progress, upcoming (a future date, not started), done.
  const groups = useMemo(() => {
    const g = { todo: [] as Row[], in_progress: [] as Row[], upcoming: [] as Row[], done: [] as Row[] };
    for (const t of rows) {
      const future = !!t.due_at && t.due_at.slice(0, 10) > today;
      if (t.status === "in_review" || t.status === "completed") g.done.push(t);
      else if (t.status === "in_progress" || t.status === "blocked" || session?.taskId === t.id) g.in_progress.push(t);
      else if (future) g.upcoming.push(t);
      else g.todo.push(t);
    }
    return g;
  }, [rows, today, session?.taskId]);
  const shown = groups[tab];
  const chosen = shown.filter((t) => selected.has(t.id)).map((t) => t.id);
  const openRow = open ? rows.find((t) => t.id === open) ?? null : null;

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
            <div className="mt-4">
              <Tabs label="To-do status" value={tab} onChange={(v) => { setTab(v as typeof tab); setSelected(new Set()); }} tabs={[
                { value: "todo", label: "To do", count: groups.todo.length },
                { value: "in_progress", label: "In progress", count: groups.in_progress.length },
                { value: "upcoming", label: "Upcoming", count: groups.upcoming.length },
                { value: "done", label: "Done", count: groups.done.length + doneToday.length },
              ]} />
              <Presence show={chosen.length > 0}>
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm">
                  <span className="mr-1 font-semibold tabular-nums">{chosen.length} selected</span>
                  <IconButton aria-label={`Delete ${chosen.length} to-do${chosen.length === 1 ? "" : "s"}`} onClick={() => setConfirmDelete(true)} className="size-9 text-danger hover:text-danger"><Trash2 className="size-4" aria-hidden /></IconButton>
                  <IconButton aria-label="Clear selection" className="ml-auto size-9" onClick={() => setSelected(new Set())}><X className="size-4" aria-hidden /></IconButton>
                </div>
              </Presence>
              <ul className="mt-3 divide-y divide-border-soft">
                {shown.length === 0 && !(tab === "done" && doneToday.length) ? <li className="py-8 text-center text-sm text-fg-subtle">{tab === "todo" ? "Nothing waiting to start." : tab === "in_progress" ? "Nothing started yet. Press a to-do and Start." : tab === "upcoming" ? "Nothing scheduled. Add a to-do with a future date and it waits here." : "Nothing finished yet today."}</li> : null}
                {shown.map((t) => {
                  const running = session?.taskId === t.id;
                  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
                  const waiting = t.status === "in_review";
                  return (
                    <li key={t.id} className={`relative -mx-2 flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 transition-colors duration-[var(--duration-fast)] hover:bg-wash ${running ? "bg-accent-soft/30" : ""} ${selected.has(t.id) ? "bg-wash" : ""}`}>
                      {!waiting ? <input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => setSelected((sel) => { const n = new Set(sel); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="relative z-[1] shrink-0" /> : null}
                      <button type="button" onClick={() => setOpen(t.id)} aria-haspopup="dialog" className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`truncate font-semibold ${waiting ? "text-fg-muted" : ""}`}>{t.title}</span>{running ? <Badge tone="success" dot>Working now</Badge> : waiting ? <Badge tone="info">Sent for check</Badge> : t.status === "blocked" ? <Badge tone="danger">Blocked</Badge> : t.status === "in_progress" ? <Badge tone="accent">Started</Badge> : null}</span>
                        <span className="block truncate text-xs text-fg-subtle">{t.created_by !== membershipId ? `from ${t.created_by_name ?? "your team lead"}` : "your own to-do"}{t.due_at ? <span className={overdue ? "text-danger" : ""}> · {overdue ? "overdue" : "due"} {formatDateTime(t.due_at)}</span> : null}</span>
                      </button>
                      <ProgressArc percent={t.progress_percent} size={40} className="relative z-[1]" />
                    </li>
                  );
                })}
                {tab === "done" ? doneToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-3 text-fg-muted">
                    <Badge tone="success"><Check className="size-3" aria-hidden /> Completed</Badge>
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="min-w-0 flex-1 truncate line-through decoration-fg-faint hover:underline">{t.title}</Link>
                    <span className="text-xs text-fg-subtle">{formatDateTime(t.completed_at)}</span>
                  </li>
                )) : null}
              </ul>
            </div>
          )}
          <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${chosen.length} to-do${chosen.length === 1 ? "" : "s"}?`} description="They leave your list. Their history is kept." confirmLabel="Delete"
            onConfirm={async () => { const r = await api<{ done: number; failed: { title: string; reason: string }[] }>(`/api/orgs/${orgSlug}/tasks/bulk`, { method: "POST", body: { ids: chosen, action: "archive" }, retries: 0 }); if (r.done) successToast(`${r.done} to-do${r.done === 1 ? "" : "s"} deleted`); if (r.failed.length) setError(r.failed.map((f) => `${f.title}: ${f.reason}`).join(" ")); setSelected(new Set()); router.refresh(); }} />
          {openRow ? <TodoSheet t={openRow} orgSlug={orgSlug} self={membershipId} running={session?.taskId === openRow.id} anyRunning={!!session} canRecord={canRecord}
            onStart={(record) => { setOpen(null); start(openRow, record); }} onDone={() => { setOpen(null); void done(openRow); }} onSaved={(msg) => { setNotice(msg); router.refresh(); }} onClose={() => setOpen(null)} /> : null}
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

/** The to-do pop-up: what it is, how far along, and every action on it: start, edit, mark done. */
function TodoSheet({ t, orgSlug, self, running, anyRunning, canRecord, onStart, onDone, onSaved, onClose }: { t: Row; orgSlug: string; self: string; running: boolean; anyRunning: boolean; canRecord: boolean; onStart: (record: boolean) => void; onDone: () => void; onSaved: (msg: string) => void; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [version, setVersion] = useState(t.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
  const waiting = t.status === "in_review";
  const shownProgress = progress ?? t.progress_percent;
  const saveProgress = async (value: number) => {
    setSaving(true); setError(null);
    try { const r = await api<{ version: number }>(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: version, progressPercent: value }, retries: 0 }); setVersion(r.version); router.refresh(); }
    catch (err) { setProgress(null); setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setSaving(false); }
  };
  const fact = (icon: React.ReactNode, name: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-border-soft bg-wash px-3 py-2"><span className="mt-0.5 text-fg-subtle">{icon}</span><span className="min-w-0"><span className="eyebrow block">{name}</span><span className="block truncate text-sm">{value}</span></span></div>
  );
  return (
    <dialog ref={ref} className="sheet !max-w-[min(92vw,36rem)]" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{t.created_by !== self ? `From ${t.created_by_name ?? "your team lead"}` : "Your own to-do"}</p>
            <h2 id={titleId} className="mt-1 font-display text-xl leading-tight">{t.title}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-2">{running ? <Badge tone="success" dot>Working now</Badge> : waiting ? <Badge tone="info">Sent for check</Badge> : t.status === "blocked" ? <Badge tone="danger">Blocked</Badge> : t.status === "in_progress" ? <Badge tone="accent">Started</Badge> : <Badge>To do</Badge>}{overdue ? <Badge tone="danger">Overdue</Badge> : null}{t.capture_requirement === "required" ? <Badge tone="warning">recording required</Badge> : null}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {t.blocked_reason ? <p className="rounded-[var(--radius-sm)] border border-danger/40 bg-danger/10 px-3 py-2 text-sm"><strong>Blocked:</strong> {t.blocked_reason}</p> : null}
        <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-soft bg-wash px-3 py-2">
          <ProgressArc percent={shownProgress} size={56} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">How far along</p>
            {!waiting ? <input type="range" min={0} max={100} step={5} value={shownProgress} disabled={saving} aria-label="Percentage done" className="mt-1 w-full accent-[var(--accent)]" onChange={(e) => setProgress(Number(e.target.value))} onMouseUp={(e) => void saveProgress(Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => void saveProgress(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void saveProgress(Number((e.target as HTMLInputElement).value)); }} />
              : <p className="text-sm text-fg-muted">Waiting for the check.</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {fact(<CalendarClock className="size-4" aria-hidden />, overdue ? "Overdue" : "Due", t.due_at ? <span className={`tabular-nums ${overdue ? "text-danger" : ""}`}>{formatDateTime(t.due_at)}</span> : "No date")}
          {fact(<Hourglass className="size-4" aria-hidden />, "Estimated", t.estimate_minutes ? formatDuration(t.estimate_minutes * 60) : "Not set")}
          {fact(<Timer className="size-4" aria-hidden />, "Tracked", t.tracked_seconds ? formatDuration(t.tracked_seconds) : "Nothing yet")}
          {fact(<Check className="size-4" aria-hidden />, "Project", t.project_name)}
        </div>
        {editing ? <EditTodo orgSlug={orgSlug} t={{ ...t, version }} onClose={() => setEditing(false)} onSaved={(m) => { setEditing(false); onSaved(m); onClose(); }} /> : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="link-action mr-auto"><ExternalLink className="size-3.5" aria-hidden />Full task and evidence</Link>
          {waiting ? null : (
            <>
              {!running && !editing ? <EditButton iconOnly label="Edit to-do" onClick={() => setEditing(true)} /> : null}
              {!running ? <Button size="sm" disabled={anyRunning} data-tip={anyRunning ? "Stop or switch the running timer first" : undefined} onClick={() => onStart(false)}><Play className="size-3.5" aria-hidden />Start</Button> : null}
              {!running && canRecord ? <Button size="sm" variant="outline" disabled={anyRunning} onClick={() => onStart(true)}><Circle className="size-3 fill-danger text-danger" aria-hidden />Start and record</Button> : null}
              {running || t.status === "in_progress" || t.status === "blocked" ? (confirmDone
                ? <><Button size="sm" onClick={() => { setConfirmDone(false); onDone(); }}><Check className="size-4" aria-hidden />Yes, mark done</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDone(false)}>Not yet</Button></>
                : <Button size="sm" variant={running ? "primary" : "outline"} onClick={() => setConfirmDone(true)}><Check className="size-4" aria-hidden />Mark done</Button>) : null}
            </>
          )}
        </div>
      </div>
    </dialog>
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
    <form className="grid gap-3 rounded-[var(--radius-sm)] border border-border bg-inset p-3" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const f = new FormData(e.currentTarget);
      try {
        await api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: t.version, title: f.get("title"), dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, estimateMinutes: f.get("estimate") ? Number(f.get("estimate")) : null } });
        onSaved("To-do updated.");
      } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="To-do" htmlFor={`title-${t.id}`}><Input id={`title-${t.id}`} name="title" defaultValue={t.title} required maxLength={200} /></Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Due date and time" htmlFor={`due-${t.id}`} hint="a future date schedules it"><DatePicker mode="datetime" id={`due-${t.id}`} name="dueAt" defaultValue={toLocalInput(t.due_at)} /></Field>
        <Field label="Estimated time" htmlFor={`est-${t.id}`} hint="optional"><DurationPicker id={`est-${t.id}`} name="estimate" defaultValue={t.estimate_minutes} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

/** Past tasks (owner decision, 28 September 2026): the faces list, five at a time with View all, and one icon to clear. */
function PastTasks({ orgSlug, items, onCleared }: { orgSlug: string; items: PastTask[]; onCleared: (n: number) => void }) {
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 5);
  return (
    <details className="tile group p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-display text-lg"><ChevronDown className="size-4 transition-transform duration-[var(--duration-fast)] group-open:rotate-180" aria-hidden />Past tasks <span className="text-sm text-fg-subtle tabular-nums">({items.length})</span></span>
        <span className="flex items-center gap-2">
          <span className="hidden text-xs text-fg-subtle sm:inline">completed or removed earlier</span>
          <IconButton aria-label="Clear past tasks" disabled={pending} onClick={(e) => { e.preventDefault(); setConfirm(true); }} className="size-9 text-danger hover:text-danger"><Trash2 className="size-4" aria-hidden /></IconButton>
        </span>
      </summary>
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      <ul className="mt-3 divide-y divide-border-soft">{shown.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2.5">
          <Avatar profileId={t.id} name={t.self_made ? "You" : t.created_by_name} size={32} className="opacity-70" />
          <span className="min-w-0 flex-1">
            <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate text-sm font-medium text-fg hover:underline">{t.title}</Link>
            <span className="block truncate text-xs text-fg-subtle">{t.self_made ? "your own to-do" : `from ${t.created_by_name}`}{t.tracked_seconds ? ` · ${formatDuration(t.tracked_seconds)} tracked` : ""}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 text-right text-xs text-fg-muted tabular-nums">
            <span className="hidden sm:block">{t.completed_at ? formatDateTime(t.completed_at) : t.archived_at ? formatDateTime(t.archived_at) : ""}</span>
            {t.status === "completed" ? <Badge tone="success">Completed</Badge> : <Badge tone="neutral">Removed</Badge>}
          </span>
        </li>
      ))}</ul>
      {items.length > 5 ? <div className="mt-3"><button type="button" className="link-action" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `View all ${items.length}`}</button></div> : null}
      <p className="mt-3 text-xs text-fg-subtle">Clearing only tidies your list. Records, reports and your team lead&apos;s views keep everything.</p>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Clear your past tasks?" description="They leave this list. Records, reports and your team lead's views keep everything." confirmLabel="Clear"
        onConfirm={async () => { setPending(true); setError(null); try { const r = await api<{ cleared: number }>(`/api/orgs/${orgSlug}/todos/clear`, { method: "POST", body: {} }); onCleared(r.cleared); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }} />
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
        <div className="relative min-w-[240px] flex-1">
          <Input id="quick-todo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a to-do and press Enter…" maxLength={200} className="w-full pr-12" autoComplete="off" />
          <button type="button" aria-label={assistantOpen ? "Close the assistant" : "Ask the assistant"} aria-expanded={assistantOpen} aria-controls="assistant-panel" onClick={onAssistant} className={`absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full transition-colors duration-[var(--duration-fast)] ${assistantOpen ? "bg-accent-soft text-accent" : "text-accent hover:bg-wash"}`}><Sparkles className="size-4" aria-hidden /></button>
        </div>
        {assignable.length ? (
          <Select aria-label="For" className="h-11 w-44 py-1 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">For: me</option>
            {assignable.some((p) => p.group === "team") ? <optgroup label="Your team">{assignable.filter((p) => p.group !== "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}</option>)}</optgroup> : null}
            {assignable.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{assignable.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
          </Select>
        ) : null}
        <Presence show={!!title.trim()}>
          <span className="flex items-center gap-1.5">
            <IconButton aria-label={details ? "Hide the date and details" : "Add a date and details"} aria-expanded={details} aria-controls="quick-details" onClick={() => setDetails((v) => !v)} className={details ? "border-accent/50 text-accent" : undefined}><CalendarClock className="size-4" aria-hidden /></IconButton>
            <Button type="submit" disabled={pending || !title.trim()}><Plus className="size-4" aria-hidden />{pending ? "Adding…" : person ? "Hand out" : "Add"}</Button>
          </span>
        </Presence>
      </div>
      <Expand show={details && !!title.trim()} id="quick-details">
        <div className="grid gap-2 pt-1 md:grid-cols-[1fr_auto]">
          <Field label="Description" htmlFor="quick-desc" hint="optional" error={fieldErrors.description}><Textarea id="quick-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} placeholder="What does done look like? Any links or context." /></Field>
          <Field label="Due date and time" htmlFor="quick-due" hint="a future date schedules it" error={fieldErrors.dueAt}><DatePicker mode="datetime" id="quick-due" value={dueAt} onChange={(v) => setDueAt(v)} className="w-56" /></Field>
        </div>
      </Expand>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}
