"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, GripVertical, ArrowUp, ArrowDown, X } from "lucide-react";
import { SessionTimer, type CurrentSessionPayload, type StartableTask } from "@/components/app/session-timer";
import { CaptureProvider, useCaptureGate } from "@/components/app/capture";
import { Button } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDuration, formatDateTime } from "@/lib/utils";
import type { TaskRow } from "@/server/services/views";
import type { SessionView } from "@/server/services/sessions";

type Props = {
  orgSlug: string; today: string; initialSession: CurrentSessionPayload;
  planned: TaskRow[]; ownTodos: TaskRow[]; fromLeads: (TaskRow & { created_by_name: string })[]; doneToday: { id: string; title: string; completed_at: string }[];
  projects: { id: string; name: string }[]; members: { id: string; display_name: string }[];
  membershipId: string; recordingMode: string; reportStatus: string | null;
};

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode}>
      <Board {...props} />
    </CaptureProvider>
  );
}

function Board({ orgSlug, today, initialSession, planned, ownTodos, fromLeads, doneToday, projects, members, recordingMode, reportStatus }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(initialSession.session);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { captureGate, onSession, dialogEl, recordingControls } = useCaptureGate();
  const assigned = useMemo(() => [...fromLeads, ...ownTodos], [fromLeads, ownTodos]);
  const all = useMemo(() => [...planned, ...assigned], [planned, assigned]);
  const startable: StartableTask[] = useMemo(() => all.filter((t) => t.status !== "completed" && t.status !== "in_review" && !t.archived_at).map((t) => ({ id: t.id, title: t.title, project_name: t.project_name, status: t.status, capture_requirement: t.capture_requirement, estimate_minutes: t.estimate_minutes })), [all]);

  async function savePlan(ids: string[]) {
    setError(null);
    try { await api(`/api/orgs/${orgSlug}/plan`, { method: "PUT", body: { localDate: today, taskIds: ids } }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Could not save your plan."); }
  }
  const plannedIds = planned.map((t) => t.id);
  const move = (id: string, dir: -1 | 1) => { const i = plannedIds.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= plannedIds.length) return; const next = [...plannedIds]; [next[i], next[j]] = [next[j], next[i]]; savePlan(next); };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <SessionTimer orgSlug={orgSlug} initial={initialSession} tasks={startable} captureGate={recordingMode === "disabled" ? undefined : captureGate} onCaptureSession={recordingMode === "disabled" ? undefined : onSession} captureDialog={dialogEl} onSessionChange={setSession} recordingControls={recordingMode === "disabled" ? undefined : recordingControls} />
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <QuickTodo orgSlug={orgSlug} onDone={() => router.refresh()} />

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
                    <StartButton t={t} session={session} orgSlug={orgSlug} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section aria-labelledby="lead-heading" className="space-y-3">
          <h2 id="lead-heading" className="text-lg font-display">From your team lead</h2>
          {fromLeads.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">Nothing assigned to you right now. Tasks your team lead gives you appear here.</p> : (
            <ul className="space-y-2">
              {fromLeads.map((t) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} by={t.created_by_name} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => savePlan([...plannedIds, t.id])}>Plan for today</Button>
                    <StartButton t={t} session={session} orgSlug={orgSlug} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="todo-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="todo-heading" className="text-lg font-display">Your to-dos</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate((v) => !v)}><Plus className="h-4 w-4" aria-hidden />{showCreate ? "Hide details" : "Add with details"}</Button>
          </div>
          {showCreate ? <CreateTaskForm orgSlug={orgSlug} projects={projects} members={members} onDone={() => { setShowCreate(false); router.refresh(); }} /> : null}
          {ownTodos.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">Type a to-do above and press Enter. Then press Start when you begin.</p> : (
            <ul className="space-y-2">
              {ownTodos.map((t) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => savePlan([...plannedIds, t.id])}>Plan for today</Button>
                    <StartButton t={t} session={session} orgSlug={orgSlug} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {doneToday.length ? (
          <section aria-labelledby="done-heading" className="space-y-2">
            <h2 id="done-heading" className="text-lg font-display">Done today</h2>
            <ul className="space-y-1 text-sm text-fg-muted">{doneToday.map((t) => <li key={t.id}>✓ <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="hover:underline">{t.title}</Link></li>)}</ul>
          </section>
        ) : null}
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
            <li>Add a to-do, or pick a task from your team lead.</li>
            <li>Press Start when you begin, Stop when you finish.</li>
            <li>Submit finished work for your lead to check.</li>
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
      <Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge>
      {by ? <span>from {by}</span> : null}
      {t.due_at ? <span className={overdue ? "text-danger" : ""}>due {formatDateTime(t.due_at)}{overdue ? " · overdue" : ""}</span> : null}
      {t.estimate_minutes ? <span>est. {formatDuration(t.estimate_minutes * 60)}</span> : null}
      {t.tracked_seconds ? <span>tracked {formatDuration(t.tracked_seconds)}</span> : null}
      {t.capture_requirement === "required" ? <Badge tone="warning">capture required</Badge> : null}
      {t.blocked_reason ? <span className="text-danger">blocked: {t.blocked_reason}</span> : null}
    </p>
  );
}

function StartButton({ t, session, orgSlug }: { t: TaskRow; session: SessionView | null; orgSlug: string }) {
  if (session?.taskId === t.id) return <Badge tone="success" dot>Active</Badge>;
  if (t.status === "in_review") return <Link href={`/app/${orgSlug}/tasks/${t.id}`}><Button size="sm" variant="subtle">In review</Button></Link>;
  // Starting is done through the timer component (it owns conflict handling); this deep-links to the task for context.
  return <StartViaTimer taskId={t.id} />;
}

function StartViaTimer({ taskId }: { taskId: string }) {
  return <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent("boredroom:start-task", { detail: { taskId } }))}>Start</Button>;
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

/** The simplest possible entry point for staff: a title, Enter, done. */
function QuickTodo({ orgSlug, onDone }: { orgSlug: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="tile flex flex-wrap items-center gap-2 p-3" onSubmit={async (e) => {
      e.preventDefault(); if (!title.trim()) return; setPending(true); setError(null);
      try { await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: title.trim() } }); setTitle(""); onDone(); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
    }}>
      <label htmlFor="quick-todo" className="sr-only">New to-do</label>
      <Input id="quick-todo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you need to do? Press Enter to add it." maxLength={200} className="min-w-0 flex-1" autoComplete="off" />
      <Button type="submit" disabled={pending || !title.trim()}><Plus className="h-4 w-4" aria-hidden />{pending ? "Adding…" : "Add to-do"}</Button>
      {error ? <Alert tone="danger" className="w-full">{error}</Alert> : null}
    </form>
  );
}
