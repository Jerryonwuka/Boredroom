"use client";

/**
 * Browser screen capture for the recording pilot.
 * - Explicit employee action, video only (audio disabled), visible indicator.
 * - Chunks (~10 s) are buffered in IndexedDB, uploaded with bounded concurrency/retry,
 *   kept until the server acknowledges them; 100 MB pending warns, 200 MB stops capture.
 * - Every recorder instance is its own server-side recording (segment). Resume = new instance.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Square, AlertTriangle } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Textarea, Select, Field } from "@/components/ui/input";
import type { StartableTask, CaptureGate } from "@/components/app/session-timer";
import type { SessionView } from "@/server/services/sessions";

const WARN_BYTES = 100 * 1024 * 1024;
const STOP_BYTES = 200 * 1024 * 1024;
const CHUNK_MS = 10000;

type PendingChunk = { key: string; recordingId: string; sequence: number; blob: Blob };

// ---- IndexedDB buffer (best effort) ---------------------------------------
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open("boredroom-capture", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("chunks", { keyPath: "key" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function idbPut(c: PendingChunk) { const db = await openDb(); if (!db) return; await new Promise<void>((res) => { const tx = db.transaction("chunks", "readwrite"); tx.objectStore("chunks").put(c); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
async function idbDelete(key: string) { const db = await openDb(); if (!db) return; await new Promise<void>((res) => { const tx = db.transaction("chunks", "readwrite"); tx.objectStore("chunks").delete(key); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
async function idbAll(): Promise<PendingChunk[]> { const db = await openDb(); if (!db) return []; return new Promise((res) => { const tx = db.transaction("chunks", "readonly"); const r = tx.objectStore("chunks").getAll(); r.onsuccess = () => res(r.result as PendingChunk[]); r.onerror = () => res([]); }); }

async function sha256Hex(blob: Blob) {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function captureSupport() {
  if (typeof navigator === "undefined") return { supported: false, reason: "Server render" };
  const md = navigator.mediaDevices;
  if (!md || typeof md.getDisplayMedia !== "function") return { supported: false, reason: "This browser does not support screen capture (getDisplayMedia)." };
  if (typeof MediaRecorder === "undefined") return { supported: false, reason: "This browser does not support MediaRecorder." };
  if (!window.isSecureContext) return { supported: false, reason: "Screen capture requires HTTPS (or localhost)." };
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return { supported: false, reason: "No supported recording format." };
  return { supported: true, mime };
}

type CaptureState = {
  status: "idle" | "requesting" | "recording" | "uploading" | "error";
  recordingId: string | null; sessionId: string | null; sourceLabel: string | null;
  pendingBytes: number; uploadedChunks: number; error: string | null; segments: number;
};

type Ctx = {
  state: CaptureState;
  startCapture: (sessionId: string) => Promise<boolean>;
  stopCapture: (reason: "stopped" | "interrupted" | "failed") => Promise<void>;
  requestPermissionOnly: () => Promise<{ stream: MediaStream; label: string } | null>;
  pendingStream: React.MutableRefObject<MediaStream | null>;
  orgSlug: string; recordingMode: string;
};
const CaptureContext = createContext<Ctx | null>(null);

export function CaptureProvider({ orgSlug, recordingMode, children }: { orgSlug: string; recordingMode: string; children: React.ReactNode }) {
  const [state, setState] = useState<CaptureState>({ status: "idle", recordingId: null, sessionId: null, sourceLabel: null, pendingBytes: 0, uploadedChunks: 0, error: null, segments: 0 });
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pendingStream = useRef<MediaStream | null>(null);
  const queue = useRef<PendingChunk[]>([]);
  const inflight = useRef(0);
  const seq = useRef(0);
  const recId = useRef<string | null>(null);
  const declared = useRef(0);
  const pendingBytes = useRef(0);
  const stopping = useRef(false);
  const pumpRef = useRef<() => Promise<void>>(async () => undefined);

  const patch = (p: Partial<CaptureState>) => setState((s) => ({ ...s, ...p }));

  const pump = useCallback(async () => {
    while (inflight.current < 2 && queue.current.length) {
      const c = queue.current.shift()!;
      inflight.current++;
      (async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const checksum = await sha256Hex(c.blob);
            const auth = await api<{ chunkId: string; uploadToken: string | null; alreadyReceived: boolean }>(`/api/orgs/${orgSlug}/recordings/${c.recordingId}/chunks/authorise`, { method: "POST", body: { sequence: c.sequence, checksum, size: c.blob.size }, retries: 0 });
            if (!auth.alreadyReceived && auth.uploadToken) {
              const res = await fetch(`/api/orgs/${orgSlug}/recordings/${c.recordingId}/chunks/${auth.chunkId}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Upload-Token": auth.uploadToken }, body: c.blob, credentials: "same-origin" });
              if (!res.ok) throw new Error(`upload failed ${res.status}`);
            }
            await idbDelete(c.key);
            pendingBytes.current -= c.blob.size;
            setState((s) => ({ ...s, pendingBytes: Math.max(0, pendingBytes.current), uploadedChunks: s.uploadedChunks + 1 }));
            break;
          } catch (err) {
            if (isApiFailure(err) && [403, 404, 409, 422].includes(err.error.status)) { patch({ error: `Upload rejected: ${err.error.message}` }); await idbDelete(c.key); pendingBytes.current -= c.blob.size; break; }
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            if (attempt === 5) { queue.current.push(c); patch({ error: "Uploads are failing; chunks are kept locally and will retry." }); }
          }
        }
        inflight.current--;
        void pumpRef.current();
      })();
    }
  }, [orgSlug]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  const requestPermissionOnly = useCallback(async () => {
    const support = captureSupport();
    if (!support.supported) { patch({ status: "error", error: support.reason ?? "Unsupported" }); return null; }
    try {
      patch({ status: "requesting", error: null });
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const track = s.getVideoTracks()[0];
      const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
      const label = `${settings.displaySurface ?? "unknown"}${track.label ? `: ${track.label}` : ""}`;
      pendingStream.current = s;
      patch({ status: "idle" });
      return { stream: s, label };
    } catch (err) {
      const name = (err as Error).name;
      patch({ status: "error", error: name === "NotAllowedError" ? "Screen sharing was declined." : `Could not start capture (${name}).` });
      return null;
    }
  }, []);

  const finalise = useCallback(async (reason: "stopped" | "interrupted" | "failed") => {
    const id = recId.current;
    if (!id) return;
    // Wait briefly for the queue to drain, then finalise with the declared chunk count.
    const deadline = Date.now() + 15000;
    while ((queue.current.length || inflight.current) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    try { await api(`/api/orgs/${orgSlug}/recordings/${id}/finalise`, { method: "POST", body: { declaredChunkCount: declared.current, captureEnded: reason }, retries: 2 }); }
    catch (err) { patch({ error: isApiFailure(err) ? err.error.message : "Could not finalise the recording; it stays partial until retried." }); }
    recId.current = null;
    patch({ status: queue.current.length || inflight.current ? "uploading" : "idle", recordingId: null, sourceLabel: null });
  }, [orgSlug]);

  const stopCapture = useCallback(async (reason: "stopped" | "interrupted" | "failed") => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const r = recorder.current;
      if (r && r.state !== "inactive") { await new Promise<void>((res) => { r.addEventListener("stop", () => res(), { once: true }); r.stop(); }); }
      stream.current?.getTracks().forEach((t) => t.stop());
      recorder.current = null; stream.current = null;
      await finalise(reason);
    } finally { stopping.current = false; }
  }, [finalise]);

  const startCapture = useCallback(async (sessionId: string): Promise<boolean> => {
    const support = captureSupport();
    if (!support.supported) { patch({ status: "error", error: support.reason ?? "Unsupported" }); return false; }
    let s = pendingStream.current;
    let label = state.sourceLabel ?? "unknown";
    pendingStream.current = null;
    if (!s || !s.active) { const p = await requestPermissionOnly(); if (!p) return false; s = p.stream; label = p.label; pendingStream.current = null; }
    const track = s.getVideoTracks()[0];
    const surface = ((track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface ?? "unknown");
    const sourceType = surface === "monitor" ? "monitor" : surface === "window" ? "window" : surface === "browser" ? "browser" : "unknown";
    const recorderInstance = crypto.randomUUID().replace(/-/g, "");
    let created: { id: string };
    try {
      created = await api(`/api/orgs/${orgSlug}/recordings`, { method: "POST", body: { sessionId, recorderInstance, mimeType: support.mime, sourceType, sourceLabel: label.slice(0, 200) }, retries: 1 });
    } catch (err) { s.getTracks().forEach((t) => t.stop()); patch({ status: "error", error: isApiFailure(err) ? err.error.message : "Could not register the recording." }); return false; }
    recId.current = created.id; seq.current = 0; declared.current = 0; stopping.current = false;
    const mr = new MediaRecorder(s, { mimeType: support.mime, videoBitsPerSecond: 800_000 });
    recorder.current = mr; stream.current = s;
    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0 || !recId.current) return;
      const c: PendingChunk = { key: `${recId.current}:${seq.current}`, recordingId: recId.current, sequence: seq.current++, blob: e.data };
      declared.current = seq.current;
      pendingBytes.current += e.data.size;
      void idbPut(c);
      queue.current.push(c);
      patch({ pendingBytes: pendingBytes.current });
      if (pendingBytes.current > STOP_BYTES) { patch({ error: "Pending uploads exceeded 200 MB. Capture stopped; time keeps tracking and you can request an exception." }); void stopCapture("interrupted"); }
      void pump();
    };
    track.addEventListener("ended", () => { patch({ error: "Screen sharing ended in the browser. The capture gap is recorded; resume to start a new segment." }); void stopCapture("interrupted"); });
    mr.onerror = () => { patch({ error: "The recorder failed." }); void stopCapture("failed"); };
    mr.start(CHUNK_MS);
    setState((st) => ({ ...st, status: "recording", recordingId: created.id, sessionId, sourceLabel: label, error: null, segments: st.segments + 1 }));
    return true;
  }, [orgSlug, pump, requestPermissionOnly, state.sourceLabel, stopCapture]);

  // Recover chunks left in IndexedDB by a previous page (best effort; recordings may already be partial).
  useEffect(() => {
    (async () => {
      const left = await idbAll();
      if (left.length) { queue.current.push(...left); pendingBytes.current += left.reduce((s, c) => s + c.blob.size, 0); patch({ status: "uploading", pendingBytes: pendingBytes.current }); void pump(); }
    })();
  }, [pump]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length || inflight.current || recorder.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const value = useMemo<Ctx>(() => ({ state, startCapture, stopCapture, requestPermissionOnly, pendingStream, orgSlug, recordingMode }), [state, startCapture, stopCapture, requestPermissionOnly, orgSlug, recordingMode]);
  return <CaptureContext.Provider value={value}>{children}<RecordingIndicator /></CaptureContext.Provider>;
}

function RecordingIndicator() {
  const c = useContext(CaptureContext);
  if (!c || c.state.status === "idle") return null;
  const mb = (c.state.pendingBytes / 1048576).toFixed(1);
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-full border border-danger/50 bg-bg-elevated px-4 py-2 shadow-xl">
      {c.state.status === "recording" ? <Circle className="rec-dot h-3 w-3 fill-danger text-danger" aria-hidden /> : <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
      <div className="text-sm">
        <p className="font-semibold">{c.state.status === "recording" ? "Recording screen" : c.state.status === "uploading" ? "Uploading recording" : c.state.status === "requesting" ? "Choose what to share" : "Capture problem"}</p>
        <p className="text-xs text-fg-muted">{c.state.sourceLabel ? `${c.state.sourceLabel} · ` : ""}{c.state.uploadedChunks} chunks sent · {mb} MB pending{c.state.pendingBytes > WARN_BYTES ? " · high" : ""}</p>
      </div>
      {c.state.status === "recording" ? <Button size="sm" variant="danger" onClick={() => c.stopCapture("stopped")}><Square className="h-3 w-3" aria-hidden />Stop</Button> : null}
    </div>
  );
}

/**
 * Gate used by the timer before starting/switching/resuming: obtains permission for
 * required/optional capture first, and offers an exception path when denied or unsupported.
 */
export function useCaptureGate() {
  const c = useContext(CaptureContext);
  const [dialog, setDialog] = useState<null | { task: StartableTask; resolve: (v: Awaited<ReturnType<CaptureGate>>) => void; reason: string }>(null);
  const captureGate: CaptureGate = useCallback(async (task) => {
    if (!c) return { captureMode: "none" };
    const required = task.capture_requirement === "required" && c.recordingMode === "required_on_designated_tasks";
    // Optional recording never prompts at Start: the server marks the session as allowed to record and the
    // member presses "Record screen" in the timer when they want to. Only designated-required tasks gate here.
    if (!required) return { captureMode: "none" };
    const support = captureSupport();
    if (!support.supported) return new Promise((resolve) => setDialog({ task, resolve, reason: support.reason ?? "Unsupported browser" }));
    const perm = await c.requestPermissionOnly();
    if (perm) return { captureMode: "required" };
    return new Promise((resolve) => setDialog({ task, resolve, reason: c.state.error ?? "Screen sharing was declined." }));
  }, [c]);

  // After a session starts with capture, begin recording on it.
  const startedFor = useRef<string | null>(null);
  const onSession = useCallback((s: SessionView | null) => {
    if (!c) return;
    const key = s ? `${s.id}:${s.version}` : null;
    if (s && s.state === "running" && s.captureMode === "required" && startedFor.current !== key) {
      startedFor.current = key;
      void c.startCapture(s.id);
    }
    if ((!s || s.state !== "running") && c.state.status === "recording") void c.stopCapture("stopped");
  }, [c]);

  const recordingControls = useCallback((session: SessionView) => {
    if (!c || c.recordingMode === "disabled") return null;
    if (session.state !== "running") return null;
    if (session.captureMode === "exception") return null;
    if (session.captureMode === "none") {
      // Recording is allowed by policy but this session cannot record: the member had not acknowledged the current notice when it started.
      return <span className="inline-flex items-center gap-2 text-xs text-warning"><Circle className="h-3 w-3" aria-hidden />This session started before you acknowledged the monitoring notice. <a className="underline" href={`/app/${c.orgSlug}/policy?next=/app/${c.orgSlug}/my-day`}>Acknowledge it</a>, then stop and start the timer to record.</span>;
    }
    if (c.state.status === "recording") return <Button variant="outline" onClick={() => c.stopCapture("stopped")}><Square className="h-3 w-3" aria-hidden />Stop recording</Button>;
    const support = captureSupport();
    if (!support.supported) return <span className="max-w-sm text-xs text-warning">Screen recording unavailable here: {support.reason} {typeof window !== "undefined" && !window.isSecureContext ? `Open the app at http://localhost:${window.location.port || "3000"} (or an https:// address) instead of ${window.location.host}.` : "Use Chrome or Edge on a computer."}</span>;
    return <Button variant="outline" disabled={c.state.status === "requesting"} onClick={() => c.startCapture(session.id)}><Circle className="h-3 w-3 fill-danger text-danger" aria-hidden />{c.state.status === "requesting" ? "Choose a screen…" : "Record screen"}</Button>;
  }, [c]);

  const dialogEl = useMemo(() => dialog ? <ExceptionDialog orgSlug={c!.orgSlug} task={dialog.task} reason={dialog.reason} onResolve={(v) => { dialog.resolve(v); setDialog(null); }} onRetry={async () => { const p = await c!.requestPermissionOnly(); if (p) { dialog.resolve({ captureMode: "required" }); setDialog(null); } }} /> : null, [dialog, c]);
  return { captureGate, onSession, dialogEl, recordingControls };
}

function ExceptionDialog({ orgSlug, task, reason, onResolve, onRetry }: { orgSlug: string; task: StartableTask; reason: string; onResolve: (v: { captureMode: "exception"; captureExceptionId: string } | null) => void; onRetry: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cex-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form className="tile w-full max-w-lg p-6" onSubmit={async (e) => {
        e.preventDefault(); setPending(true); setError(null);
        const f = new FormData(e.currentTarget);
        try {
          const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/capture-exceptions`, { method: "POST", body: { taskId: task.id, reasonCode: f.get("reasonCode"), reason: f.get("reason") } });
          onResolve({ captureMode: "exception", captureExceptionId: r.id });
        } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
      }}>
        <h2 id="cex-title" className="text-xl font-display">Recording is required for this task</h2>
        <Alert tone="warning" className="mt-3">{reason}</Alert>
        <p className="mt-3 text-sm text-fg-muted">You can retry screen sharing, or request an exception. With an exception your time is tracked but marked provisional pending review, and no recording is claimed to exist.</p>
        <div className="mt-4 grid gap-3">
          <Field label="Reason" htmlFor="cex-code"><Select id="cex-code" name="reasonCode" defaultValue="permission_denied"><option value="permission_denied">Permission denied</option><option value="unsupported_browser">Unsupported browser</option><option value="capture_failed">Capture failed</option><option value="quota_exceeded">Upload quota exceeded</option><option value="sensitive_context">Sensitive context on screen</option><option value="other">Other</option></Select></Field>
          <Field label="Details" htmlFor="cex-reason"><Textarea id="cex-reason" name="reason" required maxLength={2000} /></Field>
        </div>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onRetry}>Retry screen sharing</Button>
          <Button type="submit" disabled={pending}>{pending ? "Requesting…" : "Request exception and start"}</Button>
          <Button type="button" variant="ghost" onClick={() => onResolve(null)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

export function useCaptureContext() { return useContext(CaptureContext); }
