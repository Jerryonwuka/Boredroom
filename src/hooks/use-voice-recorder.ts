"use client";

/**
 * Records a voice note with the browser's MediaRecorder. Start opens the microphone; stop hands back the audio and
 * its length in seconds; cancel throws it away. The type is whatever the browser can produce (webm/opus in Chrome
 * and Firefox, mp4 in Safari). Nothing leaves the browser until the note is sent.
 *
 * The open microphone is handed out as `stream`, so the voice card measures its level from it instead of opening a
 * second one. At the ten-minute limit the recording is handed to `onLimit` (the composer sends it); without one it stops.
 *
 * One microphone per recording (7 October 2026, with the live waveform): whatever records here (this hook and
 * dictation, `use-dictation.ts`) also shares its open stream through `shareMicrophone`, and `useSharedMicrophone` hands
 * it to the waveform and the level meters, so they never open a second microphone for a caller that did not pass one.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
export const MAX_SECONDS = 600;

export function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone for this site, then try again. On a Mac also check System Settings, Privacy and Security, Microphone for your browser.";
  if (name === "NotFoundError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is in use by another app. Close it and try again.";
  return `Could not open the microphone (${name ?? "unknown error"}).`;
}

function browserName(): string {
  if (typeof navigator === "undefined") return "your browser";
  const ua = navigator.userAgent;
  if ((navigator as unknown as { brave?: unknown }).brave) return "Brave";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Arc\//.test(ua)) return "Arc";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "your browser";
}

/**
 * Says which of the two gates refused the microphone. The browser's own setting for this site shows up as "denied" in
 * the Permissions API; when the site is allowed (or never asked) and the microphone is still refused, it is the
 * operating system blocking the whole browser (on a Mac: Privacy and Security, Microphone), which no site setting fixes.
 */
export async function diagnoseMicError(err: unknown): Promise<string> {
  const name = (err as { name?: string })?.name;
  if (name !== "NotAllowedError" && name !== "SecurityError") return describeMicError(err);
  const browser = browserName();
  let state: string | null = null;
  try { state = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state; } catch { /* not supported */ }
  const mac = /Mac/.test(navigator.platform || navigator.userAgent);
  if (state === "denied") return `${browser} has blocked the microphone for ${location.host}. Click the icon at the left of the address bar, set Microphone to Allow, then reload the page.`;
  if (state === "granted" || state === "prompt") {
    return mac
      ? `macOS is not letting ${browser} use the microphone. Open System Settings, Privacy and Security, Microphone, switch ${browser} on, then quit ${browser} completely and open it again.`
      : `Your system is not letting ${browser} use the microphone. Check the microphone privacy settings for ${browser}, then restart it.`;
  }
  return describeMicError(err);
}

// ---- the open microphone, shared --------------------------------------------------------------------------------

const openMics: MediaStream[] = [];
const micListeners = new Set<() => void>();
const micChanged = () => micListeners.forEach((l) => l());
const subscribeMic = (l: () => void) => { micListeners.add(l); return () => { micListeners.delete(l); }; };
const newestMic = () => openMics[openMics.length - 1] ?? null;

/** Says a recording holds this microphone open; returns how to take it back (once it is stopped or handed on). */
export function shareMicrophone(stream: MediaStream): () => void {
  openMics.push(stream);
  micChanged();
  let shared = true;
  return () => {
    if (!shared) return;
    shared = false;
    const at = openMics.lastIndexOf(stream);
    if (at >= 0) { openMics.splice(at, 1); micChanged(); }
  };
}

/** The microphone a recording on this page holds open right now (the newest), or null: measure it, never stop it. */
export function useSharedMicrophone(): MediaStream | null {
  return useSyncExternalStore(subscribeMic, newestMic, () => null);
}

export function useVoiceRecorder({ onLimit }: { /** Called once when the recording reaches MAX_SECONDS. */ onLimit?: () => void } = {}) {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState<MediaStream | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const limitListener = useRef(onLimit);
  useEffect(() => { limitListener.current = onLimit; });

  const unshare = useRef<(() => void) | null>(null);

  const release = () => {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    unshare.current?.(); unshare.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    rec.current = null;
    setRecording(false); setLive(null);
  };
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* not started */ } release(); }, []);

  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function start() {
    setError(null);
    if (!supported) { setError("This browser cannot record audio. Use Chrome, Edge, Firefox or Safari."); return false; }
    if (!window.isSecureContext) { setError(`Recording needs a secure address. Open the app at http://localhost:${window.location.port || "3000"} or an https:// address.`); return false; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      unshare.current?.(); unshare.current = shareMicrophone(s);
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start(250);
      rec.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      setRecording(true); setLive(s);
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (s < MAX_SECONDS) return;
        // Once only: the clock stops here, and the note goes to whoever sends it rather than being dropped.
        if (timer.current) clearInterval(timer.current); timer.current = null;
        if (limitListener.current) limitListener.current(); else void stop();
      }, 250);
      return true;
    } catch (err) { release(); setError(await diagnoseMicError(err)); return false; }
  }

  /** Stops and returns the note, or null when nothing was recorded. */
  function stop(): Promise<{ blob: Blob; seconds: number; type: string } | null> {
    return new Promise((resolve) => {
      const r = rec.current;
      if (!r || r.state === "inactive") { release(); resolve(null); return; }
      const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      r.onstop = () => {
        const type = (r.mimeType || chunks.current[0]?.type || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        release();
        resolve(blob.size ? { blob, seconds, type } : null);
      };
      r.stop();
    });
  }

  function cancel() { const r = rec.current; if (r && r.state !== "inactive") { r.onstop = null; r.stop(); } chunks.current = []; release(); }

  return { supported, recording, seconds, error, clearError: () => setError(null), start, stop, cancel, /** The open microphone while recording, else null. */ stream: live };
}
