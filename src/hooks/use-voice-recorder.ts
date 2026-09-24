"use client";

/**
 * Records a voice note with the browser's MediaRecorder. Start opens the microphone; stop hands back the audio and
 * its length in seconds; cancel throws it away. The type is whatever the browser can produce (webm/opus in Chrome
 * and Firefox, mp4 in Safari). Nothing leaves the browser until the note is sent.
 */
import { useEffect, useRef, useState } from "react";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
export const MAX_SECONDS = 600;

export function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone for this site, then try again. On a Mac also check System Settings, Privacy and Security, Microphone for your browser.";
  if (name === "NotFoundError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is in use by another app. Close it and try again.";
  return `Could not open the microphone (${name ?? "unknown error"}).`;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = () => {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    rec.current = null;
    setRecording(false);
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
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start(250);
      rec.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) void stop();
      }, 250);
      return true;
    } catch (err) { setError(describeMicError(err)); release(); return false; }
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

  return { supported, recording, seconds, error, clearError: () => setError(null), start, stop, cancel };
}
