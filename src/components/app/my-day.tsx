"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, GripVertical, ArrowUp, ArrowDown, X, Check, Sparkles, ChevronDown } from "lucide-react";
import { SessionTimer, type CurrentSessionPayload, type StartableTask } from "@/components/app/session-timer";
import { CaptureProvider, useCaptureGate } from "@/components/app/capture";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { Button } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDuration, formatDateTime } from "@/lib/utils";
import type { TaskRow } from "@/server/services/views";
import type { SessionView } from "@/server/services/sessions";

type PastTask = { id: string; title: string; status: string; completed_at: string | null; archived_at: string | null; tracked_seconds: number; created_by_name: string; self_made: boolean };
type Person = { id: string; display_name: string };

type Props = {
  orgSlug: string; today: string; initialSession: CurrentSessionPayload;
  planned: TaskRow[]; ownTodos: TaskRow[]; fromLeads: (TaskRow & { created_by_name: string })[]; doneToday: { id: string; title: string; completed_at: string }[]; pastTasks: PastTask[];
  projects: { id: string; name: string }[]; members: Person[];
  /** People this member may hand to-dos to (team leads only; empty for staff). */
  assignable: Person[];
  membershipId: string; recordingMode: string; reportStatus: string | null; assistantConfigured: boolean;
};

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode}>
      <Board {...props} />
    </CaptureProvider>
  );
}

function Board({ orgSlug, today, initialSession, planned, ownTodos, fromLeads, doneToday, pastTasks, projects, members, assignable, membershipId, recordingMode, reportStatus, assistantConfigured }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(initialSession.session);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { captureGate, onSession, dialogEl, recordingControls } = useCaptureGate();
  const assigned = useMemo(() => [...fromLeads, ...ownTodos], [fromLeads, ownTodos]);
  const all = useMemo(() => [...planned, ...assigned], [planned, assigned]);
  const startable: StartableTask[] = useMemo(() => all.filter((t) => t.status !== "completed" && t.status !== "in_review" && !t.archived_at).map((t) => ({ id: t.id, title: t.title, project_name: t.project_name, status: t.status, capture_requirement: t.capture_requirement, estimate_minutes: t.estimate_minutes })), [all]);

  async function savePlan(ids: string[]) {
    setError(null);
    try { await api(`/api/orgs/${orgSlug}/plan`, { method: "PUT", body: { localDate: today, taskIds: ids } }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Could not save your plan."); }
  }
  async function markDone(t: TaskRow) {
    setError(null); setNotice(null);
    try {
      const r = await api<{ completed: boolean }>(`/api/orgs/${orgSlug}/tasks/${t.id}/complete`, { method: "POST", body: {} });
      setNotice(r.completed ? `“${t.title}” is completed.` : `“${t.title}” was sent to your team lead for a quick check. It shows as completed once they approve it.`);
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  }
  const plannedIds = planned.map((t) => t.id);
  const move = (id: string, dir: -1 | 1) => { const i = plannedIds.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= plannedIds.length) return; const next = [...plannedIds]; [next[i], next[j]] = [next[j], next[i]]; savePlan(next); };
  const rowActions = (t: TaskRow) => <RowActions t={t} session={session} orgSlug={orgSlug} onDone={() => markDone(t)} self={membershipId} />;
  const capture = recordingMode === "disabled" ? {} : { captureGate, onCaptureSession: onSession, recordingControls };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <SessionTimer orgSlug={orgSlug} initial={initialSession} tasks={startable} captureDialog={dialogEl} onSessionChange={setSession} {...capture} />
        {recordingMode === "disabled" && session ? <p className="-mt-3 text-xs text-fg-subtle">Screen recording is switched off for this organisation (Settings → Monitoring policy).</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        <QuickTodo orgSlug={orgSlug} assignable={assignable} onDone={(msg) => { setNotice(msg ?? null); router.refresh(); }} onAssistant={() => setShowAssistant((v) => !v)} assistantOpen={showAssistant} />
        {showAssistant ? <AssistantPanel orgSlug={orgSlug} people={assignable} configured={assistantConfigured} onClose={() => setShowAssistant(false)} onCreated={(n) => { setNotice(`${n} to-do${n === 1 ? "" : "s"} added.`); router.refresh(); }} /> : null}

        {planned.length ? (
          <section aria-labelledby="plan-heading" className="space-y-3">
            <h2 id="plan-heading" className="text-lg font-display">Today&apos;s plan</h2>
            <ol className="space-y-2">
              {planned.map((t, i) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <GripVertical className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(t.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === planned.length - 1} onClick={() => move(t.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Remove from today" onClick={() => savePlan(plannedIds.filter((x) => x !== t.id))}><X className="h-4 w-4" /></Button>
                    {rowActions(t)}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section aria-labelledby="lead-heading" className="space-y-3">
          <h2 id="lead-heading" className="text-lg font-display">From your team lead</h2>
          {fromLeads.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">Nothing assigned to you right now. Tasks your team lead gives you appear here, and you get a notification.</p> : (
            <ul className="space-y-2">
              {fromLeads.map((t) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} by={t.created_by_name} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.status !== "in_review" ? <Button size="sm" variant="ghost" onClick={() => savePlan([...plannedIds, t.id])}>Plan for today</Button> : null}
                    {rowActions(t)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="todo-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="todo-heading" className="text-lg font-display">Your to-dos</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate((v) => !v)}><Plus className="h-4 w-4" aria-hidden />{showCreate ? "Hide full form" : "Full task form"}</Button>
          </div>
          {showCreate ? <CreateTaskForm orgSlug={orgSlug} projects={projects} members={members} onDone={() => { setShowCreate(false); router.refresh(); }} /> : null}
          {ownTodos.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">{planned.length ? "Everything you added is in today's plan above." : "Type a to-do above and press Enter. Then press Start when you begin, and Done when you finish."}</p> : (
            <ul className="space-y-2">
              {ownTodos.map((t) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.status !== "in_review" ? <Button size="sm" variant="ghost" onClick={() => savePlan([...plannedIds, t.id])}>Plan for today</Button> : null}
                    {rowActions(t)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {doneToday.length ? (
          <section aria-labelledby="done-heading" className="space-y-2">
            <h2 id="done-heading" className="text-lg font-display">Done today</h2>
            <ul className="space-y-1 text-sm text-fg-muted">{doneToday.map((t) => <li key={t.id} className="flex items-center gap-2"><Badge tone="success"><Check className="h-3 w-3" aria-hidden /> Completed</Badge><Link href={`/app/${orgSlug}/tasks/${t.id}`} className="hover:underline">{t.title}</Link></li>)}</ul>
          </section>
        ) : null}

        <PastTasks orgSlug={orgSlug} items={pastTasks} onCleared={(n) => { setNotice(`${n} past task${n === 1 ? "" : "s"} cleared from your list.`); router.refresh(); }} />
      </div>

      <aside className="space-y-4">
        <div className="tile p-5">
          <h2 className="font-display text-lg">Daily report</h2>
          <p className="mt-1 text-sm text-fg-muted">{reportStatus ? `Status: ${label(reportStatus)}.` : "Not started. It is generated from your sessions and notes; you add blockers and next priorities."}</p>
          <Link href={`/app/${orgSlug}/timesheets?date=${today}`} className="mt-3 inline-block"><Button size="sm" variant={reportStatus === "approved" ? "subtle" : "primary"}>{reportStatus ? "Open report" : "Review and submit"}</Button></Link>
        </div>
        <div className="tile p-5 text-sm text-fg-muted">
          <h2 className="font-display text-lg text-fg">How it works</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Add a to-do (type it, dictate it to the assistant, or pick one from your team lead).</li>
            <li>Press Start when you begin{recordingMode === "disabled" ? "" : ", and Record screen if you want to"}. Stop when you pause.</li>
            <li>Press Done when you finish. Work from your lead goes to them for a quick check.</li>
            {assignable.length ? <li>As a team lead, use “For” to hand a to-do to someone on your team; they are notified.</li> : null}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function TaskMeta({ t, by }: { t: TaskRow; by?: string }) {
  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <Badge tone={TASK_STATUS_TONE[t.status]}>{t.status === "in_review" ? "Waiting for check" : label(t.status)}</Badge>
      {by ? <span>from {by}</span> : null}
      {t.due_at ? <span className={overdue ? "text-danger" : ""}>due {formatDateTime(t.due_at)}{overdue ? " · overdue" : ""}</span> : null}
      {t.estimate_minutes ? <span>est. {formatDuration(t.estimate_minutes * 60)}</span> : null}
      {t.tracked_seconds ? <span>tracked {formatDuration(t.tracked_seconds)}</span> : null}
      {t.capture_requirement === "required" ? <Badge tone="warning">recording required</Badge> : null}
      {t.blocked_reason ? <span className="text-danger">blocked: {t.blocked_reason}</span> : null}
    </p>
  );
}

/** Start / Done on every open row; a finished row never offers Start again. */
function RowActions({ t, session, orgSlug, onDone, self }: { t: TaskRow; session: SessionView | null; orgSlug: string; onDone: () => void; self: string }) {
  const [confirm, setConfirm] = useState(false);
  if (session?.taskId === t.id) return <Badge tone="success" dot>Active</Badge>;
  if (t.status === "completed") return <Badge tone="success"><Check className="h-3 w-3" aria-hidden /> Completed</Badge>;
  if (t.status === "in_review") return <Link href={`/app/${orgSlug}/tasks/${t.id}`}><Button size="sm" variant="subtle">Waiting for check</Button></Link>;
  const ownTodo = t.created_by === self;
  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <Button size="sm" onClick={() => { setConfirm(false); onDone(); }}><Check className="h-4 w-4" aria-hidden />{ownTodo ? "Yes, done" : "Send for check"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent("boredroom:start-task", { detail: { taskId: t.id } }))}>Start</Button>
      <Button size="sm" variant="outline" title={ownTodo ? "Mark this to-do completed" : "Send this to your team lead for a quick check"} onClick={() => setConfirm(true)}><Check className="h-4 w-4" aria-hidden />Done</Button>
    </span>
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
        <span className="flex items-center gap-2 font-display text-lg"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />Past tasks <span className="text-sm text-fg-subtle">({items.length})</span></span>
        <span className="text-xs text-fg-subtle">completed or removed earlier</span>
      </summary>
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      <ul className="mt-3 space-y-1 text-sm">{items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 text-fg-muted">
          {t.status === "completed" ? <Badge tone="success">Completed</Badge> : <Badge tone="neutral">Removed</Badge>}
          <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="text-fg hover:underline">{t.title}</Link>
          <span className="text-xs text-fg-subtle">{t.completed_at ? formatDateTime(t.completed_at) : t.archived_at ? formatDateTime(t.archived_at) : ""}{t.tracked_seconds ? ` · ${formatDuration(t.tracked_seconds)}` : ""}{t.self_made ? "" : ` · from ${t.created_by_name}`}</span>
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

function CreateTaskForm({ orgSlug, projects, members, onDone }: { orgSlug: string; projects: { id: string; name: string }[]; members: { id: string; display_name: string }[]; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  if (projects.length === 0) return <Alert tone="warning">You are not a member of any active project yet. Ask a manager to add you to one.</Alert>;
  return (
    <form className="tile grid gap-3 p-4" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null); setFieldErrors({});
      const f = new FormData(e.currentTarget);
      const est = f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null;
      const due = f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null;
      try {
        await api(`/api/orgs/${orgSlug}/tasks`, { method: "POST", body: { projectId: f.get("projectId"), title: f.get("title"), expectedOutput: f.get("expectedOutput"), reviewerMembershipId: f.get("reviewerMembershipId") || null, category: f.get("category"), priority: f.get("priority"), estimateMinutes: est, dueAt: due, addToMyDay: true } });
        onDone();
      } catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); }
      finally { setPending(false); }
    }}>
      <h3 className="font-semibold">New task for today</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title" htmlFor="title" error={fieldErrors.title}><Input id="title" name="title" required maxLength={200} /></Field>
        <Field label="Project" htmlFor="projectId" error={fieldErrors.projectId}><Select id="projectId" name="projectId" required>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      </div>
      <Field label="Expected output" htmlFor="expectedOutput" hint="what 'done' looks like" error={fieldErrors.expectedOutput}><Textarea id="expectedOutput" name="expectedOutput" required maxLength={4000} /></Field>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Reviewer" htmlFor="reviewerMembershipId" hint="required before submission" error={fieldErrors.reviewerMembershipId}><Select id="reviewerMembershipId" name="reviewerMembershipId" defaultValue=""><option value="">Choose later</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
        <Field label="Category" htmlFor="category"><Select id="category" name="category" defaultValue="work"><option value="work">Work</option><option value="meeting">Meeting</option><option value="offline">Offline work</option><option value="admin">Admin</option></Select></Field>
        <Field label="Estimate (minutes)" htmlFor="estimateMinutes" hint="optional" error={fieldErrors.estimateMinutes}><Input id="estimateMinutes" name="estimateMinutes" type="number" min={1} /></Field>
        <Field label="Due" htmlFor="dueAt" hint="optional" error={fieldErrors.dueAt}><Input id="dueAt" name="dueAt" type="datetime-local" /></Field>
      </div>
      <input type="hidden" name="priority" value="normal" />
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create and add to today"}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
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
    <form className="tile grid gap-2 p-3" onSubmit={async (e) => {
      e.preventDefault(); if (!title.trim()) return; setPending(true); setError(null); setFieldErrors({});
      try {
        await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: title.trim(), description: description.trim() || null, dueAt: dueAt ? new Date(dueAt).toISOString() : null, assigneeMembershipId: assignee || null } });
        setTitle(""); setDescription(""); setDueAt("");
        onDone(person ? `“${title.trim()}” was handed to ${person.display_name}; they have been notified.` : undefined);
      }
      catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); } finally { setPending(false); }
    }}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="quick-todo" className="sr-only">New to-do</label>
        <Input id="quick-todo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={assignable.length ? "What needs doing? Press Enter to add it (choose “For” to hand it to someone)." : "What do you need to do? Press Enter to add it."} maxLength={200} className="min-w-[240px] flex-1" autoComplete="off" />
        {assignable.length ? (
          <Select aria-label="For" className="h-11 w-44 py-1 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">For: me</option>{assignable.map((p) => <option key={p.id} value={p.id}>For: {p.display_name}</option>)}
          </Select>
        ) : null}
        <Button type="submit" disabled={pending || !title.trim()}><Plus className="h-4 w-4" aria-hidden />{pending ? "Adding…" : person ? "Hand out" : "Add to-do"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</Button>
        <Button type="button" variant={assistantOpen ? "subtle" : "ghost"} size="sm" onClick={onAssistant}><Sparkles className="h-4 w-4 text-accent" aria-hidden />Assistant</Button>
      </div>
      {details ? (
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <Field label="Description" htmlFor="quick-desc" hint="optional" error={fieldErrors.description}><Textarea id="quick-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} placeholder="What does done look like? Any links or context." /></Field>
          <Field label="Deadline" htmlFor="quick-due" hint="optional" error={fieldErrors.dueAt}><Input id="quick-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="w-56" /></Field>
        </div>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}
