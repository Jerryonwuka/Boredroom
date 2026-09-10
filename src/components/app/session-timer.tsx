"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, ArrowLeftRight, WifiOff, Circle } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Textarea, Select, Field } from "@/components/ui/input";
import { formatClock, formatDuration } from "@/lib/utils";
import type { SessionView } from "@/server/services/sessions";

export type CurrentSessionPayload = { session: SessionView | null; elsewhere: { organisationName: string; organisationSlug: string } | null };
export type StartableTask = { id: string; title: string; project_name: string; status: string; capture_requirement: string; estimate_minutes: number | null };

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

/** Display counter rebuilt from authoritative state: confirmed seconds + elapsed since the server's own clock reading. */
function elapsedFor(session: SessionView | null, nowMs: number | null, offsetMs: number): number {
  if (!session) return 0;
  if (session.state !== "running" || !session.openIntervalStartedAt || nowMs == null) return session.confirmedSeconds;
  const serverNowAtFetch = new Date(session.serverNow).getTime();
  return session.confirmedSeconds + Math.max(0, Math.floor((nowMs + offsetMs - serverNowAtFetch) / 1000));
}

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
      } else setError("Cannot reach the server. Your timer state is safe on the server; retry when you are back online.");
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
    if (s) { setStopDialog(null); apply(null); if (outcome === "ready_for_review") router.push(`/app/${orgSlug}/tasks/${session.taskId}?submit=1`); }
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
  const syncAgo = nowMs != null && lastHeartbeatOkMs != null ? Math.max(0, Math.round((nowMs - lastHeartbeatOkMs) / 1000)) : 0;

  return (
    <section aria-labelledby="timer-heading" className={`tile p-5 ${session?.state === "running" ? "tile-glow" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="timer-heading" className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-subtle">Work session</h2>
          {session ? (
            <>
              <p className="mt-1 truncate text-xl font-display">{session.taskTitle}</p>
              <p className="text-sm text-fg-muted">{session.projectName}{session.estimateMinutes ? ` · estimate ${formatDuration(session.estimateMinutes * 60)}` : ""}</p>
            </>
          ) : <p className="mt-1 text-fg-muted">No session running. Pick a task below and press Start.</p>}
        </div>
        {session ? (
          <div className="text-right">
            <p className="font-mono text-4xl tabular-nums" aria-label={`Elapsed ${formatDuration(elapsed)}`}>{formatClock(elapsed)}</p>
            <div className="mt-1 flex items-center justify-end gap-2 text-xs text-fg-subtle">
              <Badge tone={SESSION_STATE_TONE[session.state]} dot>{label(session.state)}</Badge>
              {session.state === "running" ? <span>synced {connectionLost ? "— connection lost" : `${syncAgo}s ago`}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {elsewhere ? <Alert tone="warning" className="mt-4" title="Open session in another workspace">You have a session running in {elsewhere.organisationName}. Stop it there before starting work here. <a className="underline" href={`/app/${elsewhere.organisationSlug}/my-day`}>Open that workspace</a>.</Alert> : null}
      {connectionLost ? <Alert tone="danger" className="mt-4" title="Connection lost"><span className="inline-flex items-center gap-2"><WifiOff className="h-4 w-4" aria-hidden />Heartbeats are not reaching the server. Confirmed time stops at the last acknowledged heartbeat; when you reconnect you can resume and request a correction for the gap. Nothing is credited automatically.</span></Alert> : null}
      {session?.state === "interrupted" ? <Alert tone="warning" className="mt-4" title="Session interrupted">The server stopped receiving heartbeats. Confirmed time ends at the last heartbeat; {session.uncertainSeconds > 0 ? `${formatDuration(session.uncertainSeconds)} is marked uncertain` : "the gap will be marked uncertain when you resume or stop"}. Resume to continue, then file a time correction if you kept working.</Alert> : null}
      {estimateReached && session?.state === "running" ? <Alert tone="info" className="mt-4" title="Estimate reached">You have passed the estimate for this task. Consider adding a progress note; the timer keeps running and this is not a judgement of your work.</Alert> : null}
      {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}

      {conflict ? (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="font-semibold">You already have an open session{conflict.sameTask ? " on this task" : ""}.</p>
          <p className="text-sm text-fg-muted">State: {label(conflict.state)}. Resume it, or switch to the task you selected.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { setConflict(null); await refetch(); }}>Show current session</Button>
            {!conflict.sameTask && conflict.wantedTaskId ? <Button size="sm" variant="outline" onClick={() => { setConflict(null); setStopDialog({ mode: "switch", nextTaskId: conflict.wantedTaskId }); }}>Switch to selected task</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Dismiss</Button>
          </div>
        </div>
      ) : null}

      {session ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {session.state === "running" ? <Button variant="subtle" onClick={pause} disabled={!!busy}><Pause className="h-4 w-4" aria-hidden />Pause</Button> : null}
          {session.state === "paused" || session.state === "interrupted" ? <Button onClick={resume} disabled={!!busy}><Play className="h-4 w-4" aria-hidden />Resume</Button> : null}
          <Button variant="outline" onClick={() => setStopDialog({ mode: "switch", nextTaskId: "" })} disabled={!!busy || tasks.filter((t) => t.id !== session.taskId).length === 0}><ArrowLeftRight className="h-4 w-4" aria-hidden />Switch task</Button>
          <Button variant="danger" onClick={() => setStopDialog({ mode: "stop" })} disabled={!!busy}><Square className="h-4 w-4" aria-hidden />Stop</Button>
          {recordingControls ? recordingControls(session) : null}
        </div>
      ) : null}

      {stopDialog ? (
        <StopDialog mode={stopDialog.mode} nextTaskId={stopDialog.mode === "switch" ? stopDialog.nextTaskId : ""} tasks={tasks.filter((t) => t.id !== session?.taskId)} busy={!!busy}
          onCancel={() => setStopDialog(null)} onStop={stop} onSwitch={doSwitch} />
      ) : null}
      {captureDialog}
      {current?.capture_requirement === "required" && session?.captureMode === "exception" ? <p className="mt-3 inline-flex items-center gap-2 text-xs text-warning"><Circle className="h-3 w-3" aria-hidden />Tracked under a capture exception: time is provisional pending review; no recording exists for this session.</p> : null}
    </section>
  );
}

function StopDialog({ mode, nextTaskId, tasks, busy, onCancel, onStop, onSwitch }: { mode: "stop" | "switch"; nextTaskId: string; tasks: StartableTask[]; busy: boolean; onCancel: () => void; onStop: (note: string, outcome: string) => void; onSwitch: (nextTaskId: string, note: string) => void }) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("continue_later");
  const [next, setNext] = useState(nextTaskId || tasks[0]?.id || "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("textarea, select")?.focus(); }, []);
  return (
    <div ref={ref} role="dialog" aria-modal="false" aria-labelledby="stop-heading" className="mt-5 rounded-xl border border-border-strong bg-inset p-4" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <h3 id="stop-heading" className="font-semibold">{mode === "stop" ? "Stop session" : "Switch task"}</h3>
      <p className="text-sm text-fg-muted">{mode === "stop" ? "Add a short progress note and choose what happens to the task." : "The current session closes and a new one starts on the selected task, in one step."}</p>
      <div className="mt-3 grid gap-3">
        {mode === "switch" ? (
          <Field label="Next task" htmlFor="next-task"><Select id="next-task" value={next} onChange={(e) => setNext(e.target.value)}>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title} — {t.project_name}</option>)}</Select></Field>
        ) : null}
        <Field label="Progress note" htmlFor="stop-note" hint={mode === "stop" ? "recommended" : "optional"}><Textarea id="stop-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What did you get done? What is next?" /></Field>
        {mode === "stop" ? (
          <Field label="Task outcome" htmlFor="outcome"><Select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="continue_later">Continue later</option>
            <option value="blocked">Blocked — needs help</option>
            <option value="ready_for_review">Ready for review — submit evidence next</option>
          </Select></Field>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2">
        {mode === "stop" ? <Button variant="danger" disabled={busy} onClick={() => onStop(note, outcome)}>Stop session</Button> : <Button disabled={busy || !next} onClick={() => onSwitch(next, note)}>Switch</Button>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
