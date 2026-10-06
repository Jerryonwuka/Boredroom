"use client";

/**
 * Browser screen capture for the recording pilot.
 * - Explicit employee action, video only (audio disabled), visible indicator.
 * - Chunks (~10 s) are buffered in IndexedDB, uploaded with bounded concurrency/retry,
 *   kept until the server acknowledges them; 100 MB pending warns, 200 MB stops capture.
 * - Every recorder instance is its own server-side recording (segment). Resume = new instance.
 * - Consent (owner decision, 5 October 2026: no Policy page, no general sign-off): the first time someone starts a
 *   session that will record their screen, and again whenever the recording rules change, a one-time prompt says
 *   plainly what is recorded and kept. "I agree" saves the agreement and opens the screen picker in the same click;
 *   Cancel records nothing, and the focus goes back to the control that asked. Unrecorded sessions never ask. The
 *   server refuses recording without it either way. The whole monitoring notice is one press away in the prompt, and
 *   always readable on the person's profile (Recording and privacy), recording or not.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Circle, Square, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { api, isApiFailure } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Textarea, Select, Field } from "@/components/ui/input";
import type { StartableTask, CaptureGate } from "@/components/app/session-timer";
import type { SessionView, RecordingRules } from "@/server/services/sessions";
import { cn } from "@/lib/utils";

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

// Whether this browser can record, read only in the browser. The server cannot know, so it answers null, and so does
// the first render in the browser while the page hydrates; the real answer follows a moment later. Reading
// captureSupport() straight in render made the server say "unavailable" and the browser say "Record screen".
const noSubscribe = () => () => undefined;
const supportedNow = () => captureSupport().supported;
const supportedOnServer = () => null;
export function useCaptureSupported(): boolean | null {
  return useSyncExternalStore(noSubscribe, supportedNow, supportedOnServer);
}

type CaptureState = {
  status: "idle" | "requesting" | "recording" | "uploading" | "error";
  recordingId: string | null; sessionId: string | null; sourceLabel: string | null;
  pendingBytes: number; uploadedChunks: number; error: string | null; segments: number;
};

/** null: Cancel was pressed. picked: the prompt was shown, and its "I agree" already opened the screen picker. */
type Consent = { picked: boolean } | null;

type Ctx = {
  state: CaptureState;
  /**
   * Resolves once the person has agreed to the current recording rules, asking first when they have not. Call it
   * before anything that records ("Start and record", Record screen); when the prompt was shown, the screen picker
   * has been opened too and its stream waits in pendingStream.
   */
  ensureConsent: () => Promise<Consent>;
  /** Record screen on a running session: asks for consent when needed, then records. */
  record: (session: SessionView) => Promise<void>;
  startCapture: (sessionId: string) => Promise<boolean>;
  stopCapture: (reason: "stopped" | "interrupted" | "failed") => Promise<void>;
  requestPermissionOnly: () => Promise<{ stream: MediaStream; label: string } | null>;
  /** Clears a "did not start" message; time tracking is unaffected. */
  dismissError: () => void;
  pendingStream: React.MutableRefObject<MediaStream | null>;
  orgSlug: string; recordingMode: string;
};
const CaptureContext = createContext<Ctx | null>(null);

/**
 * `rules` is what the page already knows (the `recording` part of the current-session payload); without it the provider
 * reads it once from the server when recording is on.
 */
export function CaptureProvider({ orgSlug, recordingMode, rules: initialRules, children }: { orgSlug: string; recordingMode: string; rules?: RecordingRules | null; children: React.ReactNode }) {
  const [state, setState] = useState<CaptureState>({ status: "idle", recordingId: null, sessionId: null, sourceLabel: null, pendingBytes: 0, uploadedChunks: 0, error: null, segments: 0 });
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pendingStream = useRef<MediaStream | null>(null);
  const pendingLabel = useRef<string | null>(null);
  // The rules live in a ref so a start that follows an agreement in the same moment sees it (no stale closure).
  // undefined: not read yet (or the read failed); null: the workspace has no rules, so nothing can record.
  const rules = useRef<RecordingRules | null | undefined>(initialRules);
  const rulesRead = useRef<Promise<RecordingRules | null | undefined> | null>(null);
  // `from`: the control that asked (Record screen, Start), where the focus goes back when the prompt closes.
  const [asking, setAsking] = useState<{ rules: RecordingRules; resolve: (c: Consent) => void; from: HTMLElement | null } | null>(null);
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
      pendingLabel.current = label;
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

  // The recording rules, read once from the server (the current-session payload carries them) and again after they change.
  const readRules = useCallback(() => {
    rulesRead.current ??= api<{ recording?: RecordingRules | null }>(`/api/orgs/${orgSlug}/sessions/current`)
      .then((r) => { rules.current = r.recording ?? null; return rules.current; })
      .catch(() => { rulesRead.current = null; return undefined; });
    return rulesRead.current;
  }, [orgSlug]);

  const startCapture = useCallback(async (sessionId: string): Promise<boolean> => {
    const support = captureSupport();
    if (!support.supported) { patch({ status: "error", error: support.reason ?? "Unsupported" }); return false; }
    let s = pendingStream.current;
    let label = pendingLabel.current ?? state.sourceLabel ?? "unknown";
    pendingStream.current = null; pendingLabel.current = null;
    if (!s || !s.active) { const p = await requestPermissionOnly(); if (!p) return false; s = p.stream; label = p.label; pendingStream.current = null; }
    const track = s.getVideoTracks()[0];
    const surface = ((track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface ?? "unknown");
    const sourceType = surface === "monitor" ? "monitor" : surface === "window" ? "window" : surface === "browser" ? "browser" : "unknown";
    const recorderInstance = crypto.randomUUID().replace(/-/g, "");
    let created: { id: string };
    try {
      created = await api(`/api/orgs/${orgSlug}/recordings`, { method: "POST", body: { sessionId, recorderInstance, mimeType: support.mime, sourceType, sourceLabel: label.slice(0, 200) }, retries: 1 });
    } catch (err) {
      s.getTracks().forEach((t) => t.stop());
      // The rules changed since this page read them: ask again on the next press instead of showing the server's refusal.
      if (isApiFailure(err) && err.error.code === "POLICY_NOT_ACKNOWLEDGED") { rules.current = undefined; rulesRead.current = null; void readRules(); patch({ status: "error", error: "Your organisation changed its recording rules. Press Record screen to read them and agree." }); return false; }
      patch({ status: "error", error: isApiFailure(err) ? err.error.message : "Could not register the recording." }); return false;
    }
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
  }, [orgSlug, pump, readRules, requestPermissionOnly, state.sourceLabel, stopCapture]);

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

  const dismissError = useCallback(() => setState((s) => ({ ...s, status: "idle", error: null })), []);

  // ---- Consent ---------------------------------------------------------------
  // Read ahead while recording is on, so pressing Start or Record does not wait on the network before the screen picker
  // (browsers only open it straight after a click).
  useEffect(() => { if (recordingMode !== "disabled" && rules.current === undefined) void readRules(); }, [recordingMode, readRules]);

  /** Saves the agreement. Agreeing also lets an open session that started without it record (see acknowledgePolicy). */
  const agree = useCallback(async () => {
    await api(`/api/orgs/${orgSlug}/policy/acknowledge`, { method: "POST", retries: 1 });
    if (rules.current) rules.current = { ...rules.current, agreed: true };
  }, [orgSlug]);

  const ensureConsent = useCallback(async (): Promise<Consent> => {
    // Read before anything is awaited, while the focus is still on the control that was pressed.
    const active = document.activeElement;
    const from = active instanceof HTMLElement && active !== document.body ? active : null;
    const known = rules.current !== undefined ? rules.current : await readRules();
    if (known === undefined) { patch({ status: "error", error: "Cannot reach the server to check the recording rules. Check your connection and try again." }); return null; }
    if (!known || known.agreed) return { picked: false };
    return new Promise<Consent>((resolve) => setAsking({ rules: known, resolve, from }));
  }, [readRules]);

  const record = useCallback(async (session: SessionView) => {
    const consent = await ensureConsent();
    if (!consent) return;
    if (consent.picked) { if (!pendingStream.current) return; } // the picker was closed; the indicator says so
    else if (session.captureMode === "none") {
      // Started before they agreed, and they have agreed since (another tab, another device): agreeing again lets this
      // session record. The picker opens in the same click.
      const picking = requestPermissionOnly();
      try { await agree(); } catch (err) { (await picking)?.stream.getTracks().forEach((t) => t.stop()); pendingStream.current = null; patch({ status: "error", error: isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again." }); return; }
      if (!(await picking)) return;
    }
    await startCapture(session.id);
  }, [ensureConsent, requestPermissionOnly, agree, startCapture]);

  const consentEl = asking ? (
    <ConsentDialog rules={asking.rules} returnTo={asking.from}
      onAgree={async () => {
        // The click that agrees also opens the screen picker: browsers only allow it straight after a press.
        const picking = requestPermissionOnly();
        try { await agree(); }
        catch (err) { (await picking)?.stream.getTracks().forEach((t) => t.stop()); pendingStream.current = null; pendingLabel.current = null; dismissError(); throw err; }
        await picking;
        asking.resolve({ picked: true }); setAsking(null);
      }}
      onCancel={() => { asking.resolve(null); setAsking(null); }} />
  ) : null;

  const value = useMemo<Ctx>(() => ({ state, ensureConsent, record, startCapture, stopCapture, requestPermissionOnly, dismissError, pendingStream, orgSlug, recordingMode }), [state, ensureConsent, record, startCapture, stopCapture, requestPermissionOnly, dismissError, orgSlug, recordingMode]);
  return <CaptureContext.Provider value={value}>{children}<RecordingIndicator />{consentEl}</CaptureContext.Provider>;
}

/**
 * The one-time recording consent (owner decision, 5 October 2026), v4: a centred dialog (r16, a hairline, the canvas
 * colour over the plain overlay). Plain words from the workspace's own rules, the full notice one press away, and two
 * choices: an outline Cancel and the white I agree. Focus starts on Cancel so Enter never agrees by accident. The
 * provider takes the prompt away (it is not closed), so the focus is handed back to `returnTo`, the control that asked,
 * rather than left on the page.
 */
function ConsentDialog({ rules, returnTo, onAgree, onCancel }: { rules: RecordingRules; returnTo: HTMLElement | null; onAgree: () => Promise<void>; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) { d.showModal(); cancelRef.current?.focus(); }
    // By the time this runs on the way out the dialog has left the page, so the page behind is no longer inert.
    return () => { if (returnTo?.isConnected) returnTo.focus(); };
  }, [returnTo]);
  const days = `${rules.retentionDays} day${rules.retentionDays === 1 ? "" : "s"}`;
  const facts: [string, string][] = [
    ["Recorded", "The screen, window or tab you choose, as video only, while your timer runs and the red recording sign shows."],
    ["Never recorded", "Sound, your keystrokes, screens you did not choose, or anything while no timer runs."],
    ["Kept", `For ${days}, then deleted automatically.`],
    ["Who can watch", "You, your team lead, your organisation's owner and HR, and anyone they give access to. Every viewing is logged, and you can flag a recording as sensitive to lock it."],
  ];
  return (
    <dialog ref={ref} className="modal !max-w-[min(calc(100vw-32px),30rem)]" aria-labelledby={titleId} aria-describedby={descId} onCancel={(e) => { e.preventDefault(); if (!pending) onCancel(); }}>
      <div className="grid gap-5 p-6">
        <div>
          <h2 id={titleId} className="type-dialog-title">Before your screen is recorded</h2>
          <p id={descId} className="mt-1.5 text-sm font-medium text-secondary">
            {rules.mode === "required_on_designated_tasks" ? "Some tasks need a recording while you work on them; on the rest, recording is your choice." : "Recording is your choice: it starts only when you choose a screen, and you can stop it at any time."}{" "}
            You are asked once, and again only if these rules change.
          </p>
        </div>
        <dl className="grid gap-3 text-sm">
          {facts.map(([k, v]) => <div key={k} className="grid gap-0.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3"><dt className="font-medium text-foreground">{k}</dt><dd className="font-normal text-secondary">{v}</dd></div>)}
        </dl>
        {rules.notice ? (
          <details className="rounded-xl border border-border bg-fill-0 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">Read the full notice</summary>
            {/* The whole notice, as the organisation wrote it; long ones scroll here (from the keyboard too). */}
            <div role="region" aria-label="Full monitoring notice" tabIndex={0} className="mt-2 max-h-[min(40dvh,20rem)] overflow-y-auto whitespace-pre-wrap font-normal text-secondary focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{rules.notice}</div>
          </details>
        ) : null}
        <p className="text-xs font-medium text-subtle">The notice, and whether you agreed, stay on your profile under Recording and privacy.</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button type="button" loading={pending} onClick={async () => {
            setPending(true); setError(null);
            try { await onAgree(); }
            catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Nothing was saved; try again."); setPending(false); }
          }}>{pending ? "Choose a screen…" : "I agree"}</Button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * The recording sign, v4: a toast in the bottom right (the toast surface, r12) with a status dot (red and pulsing while
 * recording, amber when something stopped it), what is happening, and Stop. It stays while recording or uploading.
 */
function RecordingIndicator() {
  const c = useContext(CaptureContext);
  if (!c || c.state.status === "idle") return null;
  const mb = (c.state.pendingBytes / 1048576).toFixed(1);
  const problem = c.state.status === "error";
  const recording = c.state.status === "recording";
  return (
    <div role="status" aria-live="polite" className="toast-surface fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[var(--z-toast)] flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 px-4 py-3">
      <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", recording ? "rec-dot bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_15%,transparent)]" : problem ? "bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_15%,transparent)]" : "bg-secondary shadow-[0_0_0_3px_var(--fill-1)]")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{recording ? "Recording screen" : c.state.status === "uploading" ? "Uploading recording" : c.state.status === "requesting" ? "Choose what to share" : "Recording did not start"}</p>
        {problem
          ? <p className="mt-0.5 text-sm font-normal text-[var(--toast-description)]">{c.state.error ?? "Something stopped the recording."} Your time keeps tracking without it.</p>
          : <p className="mt-0.5 truncate text-sm font-normal text-[var(--toast-description)]">{c.state.sourceLabel ? `${c.state.sourceLabel}, ` : ""}<span className="tabular-nums">{c.state.uploadedChunks}</span> chunks sent, <span className="tabular-nums">{mb}</span> MB pending{c.state.pendingBytes > WARN_BYTES ? ", high" : ""}</p>}
      </div>
      {recording ? <Button size="xs" variant="danger" className="shrink-0" onClick={() => c.stopCapture("stopped")}><Square className="fill-current" aria-hidden />Stop</Button> : null}
      {problem ? <IconButton aria-label="Dismiss" size="xs" className="-mr-1 shrink-0" onClick={() => c.dismissError()}><X aria-hidden /></IconButton> : null}
    </div>
  );
}

/**
 * Gate used by the timer before starting/switching/resuming: asks for consent to the recording rules (once per
 * version) and screen permission for required capture first, and offers an exception path when denied or unsupported.
 */
export function useCaptureGate() {
  const c = useContext(CaptureContext);
  const [dialog, setDialog] = useState<null | { task: StartableTask; resolve: (v: Awaited<ReturnType<CaptureGate>>) => void; reason: string }>(null);
  const captureGate: CaptureGate = useCallback(async (task) => {
    if (!c) return { captureMode: "none" };
    const required = task.capture_requirement === "required" && c.recordingMode === "required_on_designated_tasks";
    // Optional recording never prompts at Start: the member presses "Record screen" in the timer when they want to,
    // and that press asks for consent if they have not agreed yet. Only designated-required tasks gate here.
    if (!required) return { captureMode: "none" };
    const support = captureSupport();
    if (!support.supported) return new Promise((resolve) => setDialog({ task, resolve, reason: support.reason ?? "Unsupported browser" }));
    // Consent first, once per version of the rules; Cancel means the timer does not start. Agreeing opens the picker,
    // and a screen already chosen ("Start and record") is used rather than asking again.
    const consent = await c.ensureConsent();
    if (!consent) return null;
    const perm = c.pendingStream.current?.active ? true : consent.picked ? null : await c.requestPermissionOnly();
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

  const supported = useCaptureSupported();
  const recordingControls = useCallback((session: SessionView) => {
    if (!c || c.recordingMode === "disabled") return null;
    if (session.state !== "running") return null;
    if (session.captureMode === "exception") return null;
    // A session that started before the person agreed to the rules ("none") records too: Record screen asks first.
    if (c.state.status === "recording") return <IconButton aria-label="Stop recording" onClick={() => c.stopCapture("stopped")} className="text-danger hover:text-danger"><span className="relative grid place-items-center"><Circle className="rec-dot fill-danger text-danger" aria-hidden /><Square className="absolute !size-2 fill-background text-background" aria-hidden /></span></IconButton>;
    // Nothing until the browser has said whether it can record (see useCaptureSupported), so the server's render and
    // the browser's first render agree.
    if (supported === null) return null;
    const support = captureSupport();
    if (!support.supported) return <span className="flex max-w-sm items-start gap-2 text-xs font-medium text-secondary"><span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-warning" aria-hidden /><span>Screen recording unavailable here: {support.reason} {typeof window !== "undefined" && !window.isSecureContext ? `Open the app at http://localhost:${window.location.port || "3000"} (or an https:// address) instead of ${window.location.host}.` : "Use Chrome or Edge on a computer."}</span></span>;
    return <IconButton aria-label={c.state.status === "requesting" ? "Choose a screen…" : "Record screen"} disabled={c.state.status === "requesting"} onClick={() => void c.record(session)}><Circle className="fill-danger text-danger" aria-hidden /></IconButton>;
  }, [c, supported]);

  const dialogEl = useMemo(() => dialog ? <ExceptionDialog orgSlug={c!.orgSlug} task={dialog.task} reason={dialog.reason} onResolve={(v) => { dialog.resolve(v); setDialog(null); }} onRetry={async () => { const p = await c!.requestPermissionOnly(); if (p) { dialog.resolve({ captureMode: "required" }); setDialog(null); } }} /> : null, [dialog, c]);
  return { captureGate, onSession, dialogEl, recordingControls };
}

/**
 * Recording is required and could not start: retry, or ask for an exception. A centred v4 dialog on the native
 * <dialog> (focus trapped, Escape cancels): the reason in an amber notice, the form, then Cancel, Retry and the white
 * primary.
 */
function ExceptionDialog({ orgSlug, task, reason, onResolve, onRetry }: { orgSlug: string; task: StartableTask; reason: string; onResolve: (v: { captureMode: "exception"; captureExceptionId: string } | null) => void; onRetry: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const [pending, setPending] = useState<null | "request" | "retry">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal !max-w-[min(calc(100vw-32px),32rem)]" aria-labelledby={titleId} aria-describedby={descId} onCancel={(e) => { e.preventDefault(); onResolve(null); }}>
      <form className="grid gap-5 p-6" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const details = String(f.get("reason") ?? "").trim();
        if (!details) { setFieldErrors({ reason: ["Say what happened, so the reviewer can approve the time."] }); return; }
        setPending("request"); setError(null); setFieldErrors({});
        try {
          const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/capture-exceptions`, { method: "POST", body: { taskId: task.id, reasonCode: f.get("reasonCode"), reason: details } });
          onResolve({ captureMode: "exception", captureExceptionId: r.id });
        } catch (err) {
          if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); }
          else setError("Cannot reach the server. Check your connection and try again.");
        } finally { setPending(null); }
      }}>
        <div>
          <h2 id={titleId} className="type-dialog-title">Recording is required for this task</h2>
          <p id={descId} className="mt-1.5 text-sm font-medium text-secondary">You can retry screen sharing, or request an exception. With an exception your time is tracked but marked provisional pending review, and no recording is claimed to exist.</p>
        </div>
        <Alert tone="warning">{reason}</Alert>
        <Field label="Reason" htmlFor="cex-code" error={fieldErrors.reasonCode}><Select id="cex-code" name="reasonCode" defaultValue="permission_denied"><option value="permission_denied">Permission denied</option><option value="unsupported_browser">Unsupported browser</option><option value="capture_failed">Capture failed</option><option value="quota_exceeded">Upload quota exceeded</option><option value="sensitive_context">Sensitive context on screen</option><option value="other">Other</option></Select></Field>
        <Field label="Details" htmlFor="cex-reason" error={fieldErrors.reason}><Textarea id="cex-reason" name="reason" maxLength={2000} placeholder="What stopped the recording?" /></Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={!!pending} onClick={() => onResolve(null)}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={!!pending} loading={pending === "retry"} onClick={async () => { setPending("retry"); try { await onRetry(); } finally { setPending(null); } }}>{pending === "retry" ? "Opening the screen picker…" : "Retry screen sharing"}</Button>
          <Button type="submit" disabled={!!pending} loading={pending === "request"}>{pending === "request" ? "Requesting…" : "Request exception and start"}</Button>
        </div>
      </form>
    </dialog>
  );
}

export function useCaptureContext() { return useContext(CaptureContext); }
