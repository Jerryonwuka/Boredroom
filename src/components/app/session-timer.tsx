"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, ArrowLeftRight, CircleDashed } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ProgressArc } from "@/components/ui/progress-arc";
import { label } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Textarea, Select, Field } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { ProgressSlider } from "@/components/app/progress-slider";
import { cn, formatClock, formatDuration } from "@/lib/utils";
import { Swap } from "@/components/ui/motion";
import type { RecordingRules, SessionView } from "@/server/services/sessions";

/** `recording`: the workspace's recording rules and whether you have agreed (the consent prompt reads them). */
export type CurrentSessionPayload = { session: SessionView | null; elsewhere: { organisationName: string; organisationSlug: string } | null; recording?: RecordingRules | null };
export type StartableTask = { id: string; title: string; project_name: string; status: string; capture_requirement: string; estimate_minutes: number | null; progress_percent?: number; version?: number };

/** Capture integration point (recording pilot). Returns the capture mode to start with, or null to abort. */
export type CaptureGate = (task: StartableTask, sessionIdForRecording: (id: string) => void) => Promise<{ captureMode: "none" | "optional" | "required" | "exception"; captureExceptionId?: string | null } | null>;

type Props = {
  orgSlug: string;
  initial: CurrentSessionPayload;
  tasks: StartableTask[];
  captureGate?: CaptureGate;
  /** Called with every authoritative session change (capture client starts/stops recording from it). */
  onCaptureSession?: (s: SessionView | null) => void;
  captureDialog?: React.ReactNode;
  onSessionChange?: (s: SessionView | null) => void;
  recordingControls?: (session: SessionView) => React.ReactNode;
};

type Conflict = { sessionId: string; taskId: string; state: string; sameTask: boolean; wantedTaskId: string };
type StopDialogState = null | { mode: "stop" } | { mode: "switch"; nextTaskId: string };
/** What the timer says while a request is out, so a disabled control never looks merely broken. */
const BUSY: Record<string, string> = { start: "Starting…", pause: "Pausing…", resume: "Resuming…", stop: "Stopping…", switch: "Switching…" };

/** Display counter rebuilt from authoritative state: confirmed seconds + elapsed since the server's own clock reading. */
function elapsedFor(session: SessionView | null, nowMs: number | null, offsetMs: number): number {
  if (!session) return 0;
  if (session.state !== "running" || !session.openIntervalStartedAt || nowMs == null) return session.confirmedSeconds;
  const serverNowAtFetch = new Date(session.serverNow).getTime();
  return session.confirmedSeconds + Math.max(0, Math.floor((nowMs + offsetMs - serverNowAtFetch) / 1000));
}

/**
 * The running timer (owner decision, 5 October 2026: compact, and only while something is on the clock). v4: a stat
 * card. The label ("On the clock", with a status dot and when it last synced) over the time in 24/30 bold mono, the
 * task under it, the controls as 40px outline icon buttons on the right (named for screen readers and the tooltip),
 * then "How far along". The estimate runs as a thin orange line along the bottom edge. Stop and Switch open a sheet.
 */
export function SessionTimer({ orgSlug, initial, tasks, captureGate, onCaptureSession, captureDialog, onSessionChange, recordingControls }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(initial.session);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [lastHeartbeatOkMs, setLastHeartbeatOkMs] = useState<number | null>(null);
  const [offsetMs, setOffsetMs] = useState(0); // serverNow - clientNow, set from responses
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [stopDialog, setStopDialog] = useState<StopDialogState>(null);
  const [progress, setProgress] = useState<{ taskId: string; value: number; version: number } | null>(null);
  const base = `/api/orgs/${orgSlug}/sessions`;
  const elsewhere = initial.elsewhere;

  const apply = useCallback((s: SessionView | null) => {
    const now = Date.now();
    if (s) setOffsetMs(new Date(s.serverNow).getTime() - now);
    setSession(s);
    setNowMs(now);
    setLastHeartbeatOkMs(now);
    setConnectionLost(false);
    onSessionChange?.(s);
    onCaptureSession?.(s);
    router.refresh();
  }, [onSessionChange, onCaptureSession, router]);

  // Seed the clock offset from the server-rendered payload.
  useEffect(() => {
    const now = Date.now();
    const off = initial.session ? new Date(initial.session.serverNow).getTime() - now : 0;
    const id = setTimeout(() => { setOffsetMs(off); setNowMs(now); setLastHeartbeatOkMs(now); }, 0);
    return () => clearTimeout(id);
  }, [initial.session]);

  // One-second display tick while running.
  useEffect(() => {
    if (!session || session.state !== "running") return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  // Heartbeats while running; connection lost after the stale threshold without an acknowledged heartbeat.
  useEffect(() => {
    if (!session || session.state !== "running") return;
    let cancelled = false;
    let lastOk = Date.now();
    const beat = async () => {
      try {
        const s = await api<SessionView>(`${base}/${session.id}/heartbeat`, { method: "POST", retries: 0 });
        if (cancelled) return;
        lastOk = Date.now();
        setLastHeartbeatOkMs(lastOk);
        setConnectionLost(false);
        setOffsetMs(new Date(s.serverNow).getTime() - Date.now());
        if (s.state !== session.state || s.version !== session.version) apply(s);
      } catch {
        if (cancelled) return;
        if (Date.now() - lastOk > session.staleAfterSeconds * 1000) setConnectionLost(true);
      }
    };
    const t = setInterval(beat, session.heartbeatSeconds * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void beat(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", beat);
    return () => { cancelled = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", beat); };
  }, [session, base, apply]);

  const refetch = useCallback(async () => {
    try { const cur = await api<CurrentSessionPayload>(`${base}/current`); apply(cur.session); } catch { /* keep state */ }
  }, [base, apply]);

  const run = useCallback(async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(name); setError(null);
    try { return await fn(); }
    catch (err) {
      if (isApiFailure(err)) {
        const e = err.error;
        if (e.code === "SESSION_OPEN" && e.details?.sessionId) {
          setConflict({ sessionId: String(e.details.sessionId), taskId: String(e.details.taskId), state: String(e.details.state), sameTask: !!e.details.sameTask, wantedTaskId: name.startsWith("start:") ? name.slice(6) : "" });
          await refetch();
        } else if (e.code === "VERSION_CONFLICT" || e.code === "BAD_STATE") { setError("The session changed elsewhere; showing its current state."); await refetch(); }
        else setError(e.message);
      } else setError(`Cannot reach the server. Your timer state is safe on the server; retry when you are back online.${process.env.NODE_ENV !== "production" ? ` (${(err as Error).message})` : ""}`);
      return null;
    } finally { setBusy(null); }
  }, [refetch]);

  const start = useCallback(async (task: StartableTask) => {
    let capture: Awaited<ReturnType<CaptureGate>> = { captureMode: "none" };
    if (captureGate) { capture = await captureGate(task, () => undefined); if (!capture) return; }
    const s = await run(`start:${task.id}`, () => api<SessionView>(`${base}/start`, { method: "POST", body: { taskId: task.id, ...capture } }));
    if (s) apply(s);
  }, [apply, base, captureGate, run]);

  // Task lists elsewhere on the page ask the timer to start a task so conflict handling lives in one place.
  useEffect(() => {
    const onStart = (e: Event) => { const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId; const task = tasks.find((t) => t.id === id); if (task) void start(task); };
    window.addEventListener("boredroom:start-task", onStart);
    return () => window.removeEventListener("boredroom:start-task", onStart);
  }, [tasks, start]);

  async function pause() { if (!session) return; const s = await run("pause", () => api<SessionView>(`${base}/${session.id}/pause`, { method: "POST", body: { expectedVersion: session.version } })); if (s) apply(s); }
  async function resume() {
    if (!session) return;
    if (captureGate && session.captureMode !== "none") { const task = tasks.find((t) => t.id === session.taskId); if (task) { const c = await captureGate(task, () => undefined); if (!c) return; } }
    const s = await run("resume", () => api<SessionView>(`${base}/${session.id}/resume`, { method: "POST", body: { expectedVersion: session.version } })); if (s) apply(s);
  }
  async function stop(note: string, outcome: string) {
    if (!session) return;
    const s = await run("stop", () => api<SessionView>(`${base}/${session.id}/stop`, { method: "POST", body: { expectedVersion: session.version, note, outcome } }));
    if (s) { setStopDialog(null); apply(null); if (outcome === "ready_for_review") router.push(`/app/${orgSlug}/tasks/${session.taskId}?submit=1`); else router.refresh(); }
  }
  async function doSwitch(nextTaskId: string, note: string) {
    if (!session) return;
    const task = tasks.find((t) => t.id === nextTaskId);
    let capture: Awaited<ReturnType<CaptureGate>> = { captureMode: "none" };
    if (captureGate && task) { capture = await captureGate(task, () => undefined); if (!capture) return; }
    const s = await run("switch", () => api<SessionView>(`${base}/${session.id}/switch`, { method: "POST", body: { expectedVersion: session.version, nextTaskId, note, ...capture } }));
    if (s) { setStopDialog(null); apply(s); }
  }

  const elapsed = elapsedFor(session, nowMs, offsetMs);
  const estimateReached = session?.estimateMinutes ? elapsed >= session.estimateMinutes * 60 : false;
  const current = session ? tasks.find((t) => t.id === session.taskId) : undefined;
  // The progress ring on the clock (owner decision, 28 September 2026): the person updates it while they work.
  const shownProgress = progress && progress.taskId === session?.taskId ? progress.value : current?.progress_percent ?? 0;
  const saveProgress = async (value: number) => {
    if (!session || !current || current.version === undefined) return;
    const version = progress?.taskId === session.taskId ? progress.version : current.version;
    try { const r = await api<{ version: number }>(`/api/orgs/${orgSlug}/tasks/${session.taskId}`, { method: "PATCH", body: { expectedVersion: version, progressPercent: value }, retries: 0 }); setProgress({ taskId: session.taskId, value, version: r.version }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); router.refresh(); }
  };
  const syncAgo = nowMs != null && lastHeartbeatOkMs != null ? Math.max(0, Math.round((nowMs - lastHeartbeatOkMs) / 1000)) : 0;
  const live = session?.state === "running";

  const alerts = (
    <>
      {elsewhere ? <Alert tone="warning" title="Open session in another workspace">You have a session running in {elsewhere.organisationName}. Stop it there before starting work here. <a className="font-medium text-foreground underline underline-offset-4" href={`/app/${elsewhere.organisationSlug}/my-day`}>Open that workspace</a>.</Alert> : null}
      {connectionLost ? <Alert tone="danger" title="Connection lost">Heartbeats are not reaching the server. Confirmed time stops at the last acknowledged heartbeat; when you reconnect you can resume and request a correction for the gap. Nothing is credited automatically.</Alert> : null}
      {session?.state === "interrupted" ? <Alert tone="warning" title="Session interrupted">The server stopped receiving heartbeats. Confirmed time ends at the last heartbeat; {session.uncertainSeconds > 0 ? `${formatDuration(session.uncertainSeconds)} is marked uncertain` : "the gap will be marked uncertain when you resume or stop"}. Resume to continue, then file a time correction if you kept working.</Alert> : null}
      {estimateReached && live ? <Alert tone="info" title="Estimate reached">You have passed the estimate for this task. Consider adding a progress note; the timer keeps running and this is not a judgement of your work.</Alert> : null}
      {error && !stopDialog ? <Alert tone="danger">{error}</Alert> : null}
      {conflict ? (
        <Alert tone="warning" title={`You already have an open session${conflict.sameTask ? " on this task" : ""}`}>
          <p>State: {label(conflict.state)}. Resume it, or switch to the task you selected.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { setConflict(null); await refetch(); }}>Show current session</Button>
            {!conflict.sameTask && conflict.wantedTaskId ? <Button size="sm" variant="secondary" onClick={() => { setConflict(null); setStopDialog({ mode: "switch", nextTaskId: conflict.wantedTaskId }); }}>Switch to selected task</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Dismiss</Button>
          </div>
        </Alert>
      ) : null}
    </>
  );
  const hasAlerts = !!(elsewhere || connectionLost || session?.state === "interrupted" || (estimateReached && live) || (error && !stopDialog) || conflict);

  // Nothing on the clock (owner decision, 5 October 2026): no card and no idle clock, the page header already says how
  // long you worked today. Only what a Start needs to say is shown: that it is starting, a problem, the recording dialog.
  if (!session) {
    const starting = !!busy?.startsWith("start:");
    if (!starting && !hasAlerts && !captureDialog) return null;
    return (
      <div className="space-y-3">
        {starting ? <p role="status" className="inline-flex h-8 items-center gap-2 rounded-[10px] bg-fill-0 px-3 text-meta font-medium text-secondary"><span className="size-1.5 rounded-full bg-success" aria-hidden />Starting the timer…</p> : null}
        {alerts}
        {captureDialog}
      </div>
    );
  }

  const canSwitch = tasks.some((t) => t.id !== session.taskId);
  const paused = session.state === "paused" || session.state === "interrupted";
  return (
    <section aria-labelledby="timer-heading" className="card-stat relative overflow-hidden">
      <Swap id={`s:${session.id}`} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 id="timer-heading" className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-secondary">
            <span className={cn("size-2 shrink-0 rounded-full", live ? "bg-success" : session.state === "paused" ? "bg-warning" : "bg-danger")} aria-hidden />
            {live ? "On the clock" : session.state === "paused" ? "Paused" : "Connection interrupted"}
            {live ? <span className="text-meta font-normal text-subtle">{connectionLost ? "connection lost" : `synced ${syncAgo}s ago`}</span> : null}
          </h2>
          <p role="timer" className={cn("type-stat mt-1 font-mono", !live && "text-secondary")} aria-label={`Elapsed ${formatDuration(elapsed)}`}>{formatClock(elapsed)}</p>
          <p className="mt-3 truncate text-sm font-semibold text-foreground">{session.taskTitle}</p>
          <p className="truncate text-meta font-normal text-secondary">{session.projectName}{session.estimateMinutes ? `, estimated ${formatDuration(session.estimateMinutes * 60)}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live ? <IconButton variant="outline" aria-label="Pause" onClick={pause} disabled={!!busy}><Pause aria-hidden /></IconButton> : null}
          {paused ? <Button size="icon" aria-label="Resume" onClick={resume} disabled={!!busy}><Play aria-hidden /></Button> : null}
          <IconButton variant="outline" aria-label="Switch task" onClick={() => setStopDialog({ mode: "switch", nextTaskId: "" })} disabled={!!busy || !canSwitch} aria-describedby={canSwitch ? undefined : "timer-no-switch"}><ArrowLeftRight aria-hidden /></IconButton>
          <IconButton variant="outline" aria-label="Stop" className="text-danger hover:text-danger" onClick={() => setStopDialog({ mode: "stop" })} disabled={!!busy}><Square className="fill-current !size-3.5" aria-hidden /></IconButton>
          {recordingControls ? recordingControls(session) : null}
          {!canSwitch ? <span id="timer-no-switch" className="sr-only">Nothing else on your list to switch to.</span> : null}
        </div>
      </Swap>

      {busy ? <p role="status" className="mt-3 text-meta font-normal text-secondary">{BUSY[busy.startsWith("start:") ? "start" : busy] ?? "Working…"}</p> : null}
      {hasAlerts ? <div className="mt-4 space-y-2">{alerts}</div> : null}

      {current?.version !== undefined ? (
        <div className="mt-4 flex items-center gap-3 sm:max-w-sm">
          <ProgressArc percent={shownProgress} size={36} tone="accent" />
          <div className="min-w-0 flex-1">
            <span aria-hidden className="block text-meta font-medium text-secondary">How far along</span>
            <ProgressSlider label="How far along" value={shownProgress}
              onChange={(v) => setProgress({ taskId: session.taskId, value: v, version: progress?.taskId === session.taskId ? progress.version : current.version! })}
              onCommit={(v) => void saveProgress(v)} />
          </div>
        </div>
      ) : null}

      {stopDialog ? (
        <StopDialog mode={stopDialog.mode} nextTaskId={stopDialog.mode === "switch" ? stopDialog.nextTaskId : ""} tasks={tasks.filter((t) => t.id !== session.taskId)} busy={!!busy} error={error}
          onCancel={() => { setStopDialog(null); setError(null); }} onStop={stop} onSwitch={doSwitch} />
      ) : null}
      {captureDialog}
      {current?.capture_requirement === "required" && session.captureMode === "exception" ? <p className="mt-3 inline-flex items-center gap-2 text-meta font-normal text-warning"><CircleDashed className="size-3.5" aria-hidden />Tracked under a capture exception: time is provisional pending review; no recording exists for this session.</p> : null}
      {session.estimateMinutes ? (
        // The estimate as a thin line along the bottom edge; it grows by transform, so the browser only composites it.
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-fill-1" aria-hidden>
          <div className="h-full origin-left bg-accent transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${Math.min(1, elapsed / (session.estimateMinutes * 60))})` }} />
        </div>
      ) : null}
    </section>
  );
}

/** Stop or Switch, in a right-hand sheet: a progress note, and what happens to the task (stop) or the next task (switch). */
function StopDialog({ mode, nextTaskId, tasks, busy, error, onCancel, onStop, onSwitch }: { mode: "stop" | "switch"; nextTaskId: string; tasks: StartableTask[]; busy: boolean; error: string | null; onCancel: () => void; onStop: (note: string, outcome: string) => void; onSwitch: (nextTaskId: string, note: string) => void }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("continue_later");
  const [next, setNext] = useState(nextTaskId || tasks[0]?.id || "");
  return (
    <Sheet open size="sm" onClose={onCancel} dismissible={false}
      title={mode === "stop" ? "Stop session" : "Switch task"}
      description={mode === "stop" ? "Add a short progress note and choose what happens to the task." : "The current session closes and a new one starts on the selected task, in one step."}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        {mode === "stop"
          ? <Button variant="destructive" loading={busy} onClick={() => onStop(note, outcome)}>{busy ? "Stopping…" : "Stop session"}</Button>
          : <Button loading={busy} disabled={!next} onClick={() => onSwitch(next, note)}>{busy ? "Switching…" : "Switch"}</Button>}
      </>}>
      <div className="grid gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {mode === "switch" ? (
          <Field label="Next task" htmlFor="next-task"><Select id="next-task" value={next} onChange={(e) => setNext(e.target.value)}>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title} — {t.project_name}</option>)}</Select></Field>
        ) : null}
        <Field label="Progress note" htmlFor="stop-note" hint={mode === "stop" ? "Recommended" : "Optional"}><Textarea id="stop-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What did you get done? What is next?" /></Field>
        {mode === "stop" ? (
          <Field label="Task outcome" htmlFor="outcome" description={outcome === "completed" ? "Your own to-dos are completed straight away. A task your team lead gave you goes to them for a quick check first." : undefined}>
            <Select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="continue_later">Continue later</option>
              <option value="completed">Done: mark the task completed</option>
              <option value="blocked">Blocked: needs help</option>
              <option value="ready_for_review">Ready for review: attach evidence next</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
