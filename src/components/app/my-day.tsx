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
import { Alert, EmptyState } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDuration, formatDateTime } from "@/lib/utils";
import type { TaskRow } from "@/server/services/views";
import type { SessionView } from "@/server/services/sessions";

type Props = {
  orgSlug: string; today: string; initialSession: CurrentSessionPayload;
  planned: TaskRow[]; assigned: TaskRow[]; projects: { id: string; name: string }[]; members: { id: string; display_name: string }[];
  membershipId: string; recordingMode: string; reportStatus: string | null;
};

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode}>
      <Board {...props} />
    </CaptureProvider>
  );
}

function Board({ orgSlug, today, initialSession, planned, assigned, projects, members, recordingMode, reportStatus }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(initialSession.session);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { captureGate, onSession, dialogEl, recordingControls } = useCaptureGate();
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

        <section aria-labelledby="plan-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="plan-heading" className="text-lg font-display">Today&apos;s priorities</h2>
            <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}><Plus className="h-4 w-4" aria-hidden />New task</Button>
          </div>
          {showCreate ? <CreateTaskForm orgSlug={orgSlug} projects={projects} members={members} onDone={() => { setShowCreate(false); router.refresh(); }} /> : null}
          {planned.length === 0 ? (
            <EmptyState title="No priorities picked yet" description="Add tasks from your assigned list below. The order is yours; it does not change project priority." />
          ) : (
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
          )}
        </section>

        <section aria-labelledby="assigned-heading" className="space-y-3">
          <h2 id="assigned-heading" className="text-lg font-display">Assigned to you</h2>
          {assigned.length === 0 ? <EmptyState title="Nothing else assigned" description="Tasks assigned to you that are not in today's plan appear here." /> : (
            <ul className="space-y-2">
              {assigned.map((t) => (
                <li key={t.id} className={`tile flex items-center gap-3 px-4 py-3 ${session?.taskId === t.id ? "tile-glow" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate font-semibold hover:underline">{t.title}</Link>
                    <TaskMeta t={t} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => savePlan([...plannedIds, t.id])}>Add to today</Button>
                    <StartButton t={t} session={session} orgSlug={orgSlug} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <div className="tile p-5">
          <h2 className="font-display text-lg">Daily report</h2>
          <p className="mt-1 text-sm text-fg-muted">{reportStatus ? `Status: ${label(reportStatus)}.` : "Not started. It is generated from your sessions and notes; you add blockers and next priorities."}</p>
          <Link href={`/app/${orgSlug}/timesheets?date=${today}`} className="mt-3 inline-block"><Button size="sm" variant={reportStatus === "approved" ? "subtle" : "primary"}>{reportStatus ? "Open report" : "Review and submit"}</Button></Link>
        </div>
        <div className="tile p-5 text-sm text-fg-muted">
          <h2 className="font-display text-lg text-fg">How time works</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Only time between Start and Pause/Stop counts, confirmed by server heartbeats.</li>
            <li>Lost connection? Time stops at the last heartbeat; you can request a correction.</li>
            <li>Nothing here is a productivity score.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function TaskMeta({ t }: { t: TaskRow }) {
  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge>
      <span>{t.project_name}</span>
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
