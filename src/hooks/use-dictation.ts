"use client";

/**
 * Dictation with the browser's own speech recognition (Chrome, Edge and Safari have it; Firefox and Brave do not).
 * No audio is uploaded. Chrome ends a session after a few seconds of silence, so sessions are restarted until
 * Stop is pressed. The hook owns the text: what was typed before dictating is kept and the speech is appended.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(text: string, setText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heardWords, setHeardWords] = useState(0);
  // null during server render and hydration, then the browser's real answer.
  const supported = useSyncExternalStore(() => () => undefined, () => !!speechCtor(), () => null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const base = useRef("");
  const wantListening = useRef(false);
  const heard = useRef(0);
  const silentRestarts = useRef(0);

  useEffect(() => () => { wantListening.current = false; rec.current?.stop(); }, []);

  function stop() {
    wantListening.current = false;
    rec.current?.stop();
    setListening(false);
  }

  function startRecognition(Ctor: new () => SpeechRecognitionLike) {
    const r = new Ctor(); rec.current = r;
    r.lang = navigator.language && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(navigator.language) ? navigator.language : "en-US";
    r.continuous = true; r.interimResults = true;
    let sessionFinal = "";
    r.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; const t = res[0].transcript; if (res.isFinal) finalText += t + " "; else interim += t; }
      sessionFinal = finalText;
      const shown = (base.current + finalText + interim).replace(/\s+/g, " ").trimStart();
      heard.current = shown.split(" ").filter(Boolean).length; setHeardWords(heard.current);
      silentRestarts.current = 0;
      setText(shown);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const why = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access was declined for speech recognition. Allow the microphone in the address bar and try again. Brave blocks the speech service by default (enable it under brave://settings/privacy)."
        : e.error === "network" ? "The browser's speech service could not be reached. Dictation needs an internet connection and works in Chrome, Edge or Safari; Brave and Firefox do not offer it. You can type instead."
        : e.error === "audio-capture" ? "No microphone could be used. Check the input device in your system sound settings."
        : e.error === "language-not-supported" ? "This browser cannot transcribe your language setting. Switch the browser language to English and try again."
        : `Dictation stopped (${e.error}). You can type instead.`;
      wantListening.current = false; setError(why); setListening(false);
    };
    r.onend = () => {
      if (sessionFinal) base.current = (base.current + sessionFinal).replace(/\s+/g, " ");
      if (!wantListening.current) { setListening(false); return; }
      if (heard.current === 0 && ++silentRestarts.current >= 4) { wantListening.current = false; setListening(false); setError("No speech was heard for a while. Check the microphone is not muted, then press Dictate again."); return; }
      try { startRecognition(Ctor); } catch { wantListening.current = false; setListening(false); }
    };
    r.start();
  }

  async function toggle() {
    if (listening) { stop(); return; }
    const Ctor = speechCtor(); if (!Ctor) return;
    setError(null);
    if (!window.isSecureContext) { setError(`Dictation needs a secure address. Open the app at http://localhost:${window.location.port || "3000"} or an https:// address (you are on ${window.location.host}).`); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((t) => t.stop()); }
    catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") setError("Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone for this site, then try again. On a Mac also check System Settings, Privacy and Security, Microphone for your browser.");
      else if (name === "NotFoundError") setError("No microphone was found on this device.");
      else setError(`Could not open the microphone (${name ?? "unknown error"}). You can type instead.`);
      return;
    }
    base.current = text ? text.trimEnd() + " " : "";
    heard.current = 0; setHeardWords(0); silentRestarts.current = 0;
    wantListening.current = true;
    try { startRecognition(Ctor); setListening(true); setError(null); } catch { wantListening.current = false; setError("Could not start dictation. Reload the page and try again, or type instead."); }
  }

  return { listening, supported, heardWords, error, clearError: () => setError(null), toggle, stop };
}
