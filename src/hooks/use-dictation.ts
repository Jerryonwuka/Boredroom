"use client";

/**
 * Dictation, with two engines (owner decision, 5 October 2026):
 *
 * - The browser's own speech recognition (Chrome, Edge, Safari): live words as you speak. Chrome sends the audio to
 *   Google's speech service, so it fails behind some VPNs, firewalls and blockers, and Brave and Firefox do not have it.
 *   Chrome ends a session after a few seconds of silence, so sessions are restarted until Stop is pressed.
 * - On-device Whisper (`src/lib/whisper`): the recording is turned into text on this computer when you press Stop. No
 *   audio leaves the computer; the model (about 44 MB) downloads once per browser, then is cached. English only.
 *
 * Whisper is used where the browser has no speech recognition, in Brave, and from the moment the browser's speech
 * service fails (remembered for a day, so the next dictations go straight to it, then live dictation is tried again).
 * When that failure happens mid-way, dictation carries on with Whisper without the person pressing anything.
 *
 * The hook owns the text: what is in the box is kept and the speech is appended (with Whisper, to the box as it is when
 * the words arrive, so typing during a recording is not lost). `stop()` resolves with the final text, or null when the
 * dictation failed or was cancelled, so Send can wait for it and knows not to send. Every asynchronous step is tied to
 * a session number, so a start that is overtaken (Stop, closing the panel, a second click) stops its microphone instead
 * of carrying on unseen.
 *
 * One microphone per dictation (7 October 2026, with the live waveform): the open microphone is handed out as `stream`
 * and shared (`shareMicrophone`), so the voice card's waveform measures it instead of opening its own. With the
 * browser's engine, the stream opened to ask for the microphone stays open for the waveform while the browser listens,
 * and is the one Whisper records from if the browser's service fails mid-way; it is stopped when the dictation ends.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { diagnoseMicError, shareMicrophone } from "@/hooks/use-voice-recorder";
import { prepareWhisper, toWhisperAudio, transcribe, whisperSupported } from "@/lib/whisper/client";
import { MAX_DICTATION_SECONDS, WHISPER_SAMPLE_RATE } from "@/lib/whisper/config";

type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export type DictationEngine = "browser" | "whisper";
export type DictationPhase = "idle" | "listening" | "transcribing";

const ENGINE_KEY = "boredroom-dictation-whisper-since";
const REMEMBER_MS = 24 * 60 * 60 * 1000;
const BROWSER_STOP_WAIT_MS = 1500;
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const isBrave = () => typeof navigator !== "undefined" && !!(navigator as unknown as { brave?: unknown }).brave;
/** The browser's speech service failed here within the last day. */
function rememberedWhisper(): boolean {
  try { const since = Number(localStorage.getItem(ENGINE_KEY)); return !!since && Date.now() - since < REMEMBER_MS; } catch { return false; }
}
function rememberWhisper() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // offline is not the service's fault
  try { localStorage.setItem(ENGINE_KEY, String(Date.now())); } catch { /* private mode */ }
}
const noSubscribe = () => () => undefined;
const stopTracks = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());
/** Whether a stream still carries a live microphone (a stand-in without tracks does not). */
const isLive = (s: MediaStream) => typeof s.getTracks === "function" && s.getTracks().some((t) => t.readyState === "live");

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; limit: ReturnType<typeof setTimeout> };

export function useDictation(text: string, setText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [engine, setEngine] = useState<DictationEngine>("browser");
  const [error, setError] = useState<string | null>(null);
  /** Something worth knowing that is not a failure (the two-minute limit, a model download that has to retry). */
  const [notice, setNotice] = useState<string | null>(null);
  const [heardWords, setHeardWords] = useState(0);
  /** The words heard in this dictation so far (for the voice card), not what was in the box before it. */
  const [heard, setHeard] = useState("");
  /** Model download progress (0 to 1) while Whisper is getting ready, else null. */
  const [progress, setProgress] = useState<number | null>(null);
  const [modelReady, setModelReady] = useState(false);
  // null during server render and hydration, then the browser's real answer.
  const supported = useSyncExternalStore(noSubscribe, () => !!speechCtor() || whisperSupported(), () => null);

  const textNow = useRef(text);
  useEffect(() => { textNow.current = text; }, [text]);
  const alive = useRef(true);
  const session = useRef(0);          // bumped by every start, stop, cancel and unmount
  const transcribing = useRef(0);     // bumped when a write-out is cancelled
  const starting = useRef(false);
  const handingOver = useRef(false);  // the browser's service failed; Whisper is being started
  const engineNow = useRef<DictationEngine>("browser");
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const browserStopped = useRef<(() => void) | null>(null);
  const media = useRef<Recording | null>(null);
  const finishing = useRef<{ promise: Promise<string | null>; cancel: () => void } | null>(null);
  const base = useRef("");
  const wantListening = useRef(false);
  const heardCount = useRef(0);
  const saidBefore = useRef(""); // this dictation's words from the browser's earlier sessions (it restarts after silence)
  const silentRestarts = useRef(0);
  /** The browser's engine: the stream opened to ask for the microphone, kept open for the waveform while it listens. */
  const levelStream = useRef<MediaStream | null>(null);
  /** The microphone on show (the waveform's), with how to stop sharing it. */
  const shown = useRef<{ stream: MediaStream; unshare: () => void } | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const write = (t: string) => { textNow.current = t; setText(t); };
  const chooseEngine = (e: DictationEngine) => { engineNow.current = e; setEngine(e); };
  /** Shows and shares the open microphone; set before `listening`, so the voice card finds it when it appears. */
  function showMic(s: MediaStream) {
    if (shown.current?.stream === s) return;
    hideMic();
    shown.current = { stream: s, unshare: shareMicrophone(s) };
    setMicStream(s);
  }
  /** Stops showing the microphone (only `s`, when given: a newer one stays). */
  function hideMic(s?: MediaStream) {
    const cur = shown.current;
    if (!cur || (s && cur.stream !== s)) return;
    shown.current = null;
    cur.unshare();
    if (alive.current) setMicStream(null);
  }
  /** The browser's engine has stopped listening: its waveform stream goes too. */
  function releaseLevel() {
    const s = levelStream.current;
    if (!s) return;
    levelStream.current = null;
    stopTracks(s);
    hideMic(s);
  }
  /** Hands the kept stream on (to Whisper, when the browser's service fails), or null when it has gone quiet. */
  function takeLevelStream(): MediaStream | null {
    const s = levelStream.current;
    levelStream.current = null;
    if (s && isLive(s)) return s;
    if (s) { stopTracks(s); hideMic(s); }
    return null;
  }
  const idle = () => { releaseLevel(); setListening(false); setPhase("idle"); };

  function dropRecording() {
    const m = media.current;
    media.current = null;
    if (!m) return;
    clearTimeout(m.limit);
    try { if (m.recorder.state !== "inactive") m.recorder.stop(); } catch { /* already stopped */ }
    stopTracks(m.stream); // its caller stops showing it (startWhisper shows the next one; cancel hides it)
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // These are counters, not DOM refs: bumping them is how late async work learns it has been overtaken.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      session.current++; transcribing.current++;
      wantListening.current = false; handingOver.current = false;
      const r = rec.current; rec.current = null;
      if (r) { r.onresult = null; r.onend = null; r.onerror = null; try { r.stop(); } catch { /* not started */ } }
      dropRecording();
      const kept = levelStream.current; levelStream.current = null;
      if (kept) stopTracks(kept);
      shown.current?.unshare(); shown.current = null;
      finishing.current?.cancel();
    };
  }, []);

  // ---- on-device Whisper ---------------------------------------------------------------------------------------------

  const onProgress = (f: number) => setProgress(f < 1 ? f : null);

  function warmUp() {
    void prepareWhisper(onProgress)
      .then(() => { setModelReady(true); setProgress(null); })
      .catch(() => {
        setProgress(null);
        if (media.current) setNotice("Dictation could not download its speech model yet. Keep talking; it tries again when you stop.");
      });
  }

  function startWhisper(stream: MediaStream, token: number) {
    if (token !== session.current || !alive.current) { stopTracks(stream); return; }
    dropRecording(); // never two recordings at once
    const type = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(250);
    const limit = setTimeout(() => {
      if (media.current?.recorder !== recorder) return; // only ever ends its own recording
      setNotice("Dictation stops after 2 minutes. What you said is being written out; press the microphone to carry on.");
      void stop();
    }, MAX_DICTATION_SECONDS * 1000);
    media.current = { recorder, stream, chunks, limit };
    chooseEngine("whisper");
    showMic(stream);
    setListening(true); setPhase("listening"); setError(null);
    warmUp(); // the model loads while the person speaks
  }

  async function finishWhisper(): Promise<string | null> {
    const m = media.current;
    media.current = null;
    if (!m) return textNow.current;
    clearTimeout(m.limit);
    const blob = await new Promise<Blob>((resolve) => {
      const done = () => resolve(new Blob(m.chunks, { type: m.recorder.mimeType || m.chunks[0]?.type || "audio/webm" }));
      if (m.recorder.state === "inactive") return done();
      m.recorder.onstop = done;
      m.recorder.stop();
    });
    stopTracks(m.stream);
    hideMic(m.stream);
    setListening(false); setPhase("transcribing");
    const mine = ++transcribing.current;
    const current = () => mine === transcribing.current && alive.current;
    const fail = (message: string, err?: unknown) => { if (err) console.error("Dictation:", err); if (current()) setError(message); return null; };
    try {
      let audio: Float32Array;
      try { audio = await toWhisperAudio(blob); }
      catch (err) { return fail("The recording could not be read. Try again, or type instead.", err); }
      if (audio.length < WHISPER_SAMPLE_RATE * 0.4) return current() ? textNow.current : null; // a tap, not speech
      let peak = 0;
      for (let i = 0; i < audio.length; i++) { const v = Math.abs(audio[i]); if (v > peak) peak = v; }
      if (peak < 0.003) return fail("I couldn't hear anything. Check the microphone is not muted and the right one is selected, then try again.");
      try { await prepareWhisper(onProgress); if (current()) { setModelReady(true); setProgress(null); } }
      catch (err) { return fail("Dictation could not download its speech model. Check your connection and try again, or type instead.", err); }
      let said: string;
      try { said = await transcribe(audio); }
      catch (err) { return fail("Dictation could not write out what you said. Try again, or type instead.", err); }
      if (!current()) return null; // cancelled while it was writing out
      if (!said) return fail("I didn't catch any words. Try again a little closer to the microphone.");
      // Append to the box as it is now, so anything typed during the recording stays.
      const now = textNow.current.trim();
      const next = ((now ? now + " " : "") + said).replace(/\s+/g, " ").trim();
      write(next);
      setHeardWords(next.split(" ").filter(Boolean).length);
      setHeard(said);
      return next;
    } finally {
      if (current()) setPhase("idle");
    }
  }

  // ---- the browser's speech service ----------------------------------------------------------------------------------

  /** The browser's service failed: carry on with Whisper. Returns false when this browser cannot run it. */
  async function switchToWhisper(): Promise<boolean> {
    if (!whisperSupported()) return false;
    rememberWhisper();
    const token = session.current;
    // The microphone the waveform has been measuring is still open: Whisper records from it rather than asking again.
    let stream = takeLevelStream();
    if (!stream) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (err) { if (handingOver.current && token === session.current) { handingOver.current = false; setError(await diagnoseMicError(err)); idle(); } return true; }
    }
    if (!handingOver.current || token !== session.current || !alive.current) { stopTracks(stream); hideMic(stream); return true; } // Stop was pressed meanwhile
    handingOver.current = false;
    startWhisper(stream, token);
    return true;
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
      heardCount.current = shown.split(" ").filter(Boolean).length; setHeardWords(heardCount.current);
      setHeard((saidBefore.current + finalText + interim).replace(/\s+/g, " ").trim());
      silentRestarts.current = 0;
      write(shown);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      // The speech service is unreachable or not offered (VPNs, blockers, Brave): continue on this computer.
      if (e.error === "network" || e.error === "service-not-allowed") {
        wantListening.current = false;
        handingOver.current = true;
        if (rec.current === r) rec.current = null;
        void switchToWhisper().then((ok) => {
          if (!ok && handingOver.current) { handingOver.current = false; setError("The browser's speech service could not be reached, and this browser cannot run dictation on the computer. You can type instead."); idle(); }
        });
        return;
      }
      const why = e.error === "not-allowed" ? "Microphone access was declined for speech recognition. Allow the microphone in the address bar and try again."
        : e.error === "audio-capture" ? "No microphone could be used. Check the input device in your system sound settings."
        : e.error === "language-not-supported" ? "This browser cannot transcribe your language setting. Switch the browser language to English and try again."
        : `Dictation stopped (${e.error}). You can type instead.`;
      wantListening.current = false; setError(why); idle();
    };
    r.onend = () => {
      if (handingOver.current || engineNow.current !== "browser") return; // Whisper has taken over
      if (sessionFinal) { base.current = (base.current + sessionFinal).replace(/\s+/g, " "); saidBefore.current += sessionFinal; }
      if (browserStopped.current) { const finish = browserStopped.current; browserStopped.current = null; finish(); return; }
      if (!wantListening.current) { idle(); return; }
      if (heardCount.current === 0 && ++silentRestarts.current >= 4) { wantListening.current = false; idle(); setError("No speech was heard for a while. Check the microphone is not muted, then press Dictate again."); return; }
      try { startRecognition(Ctor); } catch { wantListening.current = false; idle(); }
    };
    r.start();
  }

  // ---- controls ------------------------------------------------------------------------------------------------------

  /**
   * Stops listening. With Whisper, resolves once the speech is written out (null if that failed or was cancelled); with
   * the browser's engine, once its last words have arrived (at most 1.5 s).
   */
  function stop(): Promise<string | null> {
    session.current++; // a start still waiting for the microphone gives it back
    if (handingOver.current) { handingOver.current = false; idle(); return Promise.resolve(textNow.current); }
    if (finishing.current) return finishing.current.promise;
    if (media.current) {
      let cancel = () => {};
      const cancelled = new Promise<null>((resolve) => { cancel = () => resolve(null); });
      const promise: Promise<string | null> = Promise.race([finishWhisper(), cancelled]).finally(() => {
        if (finishing.current?.promise === promise) finishing.current = null;
      });
      finishing.current = { promise, cancel };
      return promise;
    }
    wantListening.current = false;
    const r = rec.current;
    if (!r) { idle(); return Promise.resolve(textNow.current); }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        browserStopped.current = null;
        r.onresult = null; // nothing late may write into a box that has been sent
        if (rec.current === r) rec.current = null;
        idle();
        resolve(textNow.current);
      };
      browserStopped.current = finish;
      setTimeout(finish, BROWSER_STOP_WAIT_MS);
      try { r.stop(); } catch { finish(); }
    });
  }

  /** Gives up on this dictation: a recording is discarded, a write-out abandoned (the download carries on for next time). */
  function cancel() {
    session.current++;
    if (media.current) { const s = media.current.stream; dropRecording(); hideMic(s); idle(); return; }
    if (finishing.current) { transcribing.current++; finishing.current.cancel(); finishing.current = null; setPhase("idle"); setProgress(null); return; }
    void stop();
  }

  async function toggle() {
    if (listening) { void stop(); return; }
    if (phase === "transcribing" || starting.current) return;
    setError(null); setNotice(null); setHeard("");
    if (!window.isSecureContext) { setError(`Dictation needs a secure address. Open the app at http://localhost:${window.location.port || "3000"} or an https:// address (you are on ${window.location.host}).`); return; }
    starting.current = true;
    const token = ++session.current;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { starting.current = false; if (token === session.current && alive.current) setError(await diagnoseMicError(err)); return; }
    starting.current = false;
    if (token !== session.current || !alive.current) { stopTracks(stream); return; } // overtaken while asking

    const Ctor = speechCtor();
    if (!Ctor || isBrave() || rememberedWhisper()) {
      if (!whisperSupported()) { stopTracks(stream); setError("This browser cannot run dictation. Use Chrome, Edge, Safari or Firefox, or type instead."); return; }
      startWhisper(stream, token);
      return;
    }
    // The browser listens through its own microphone; this one stays open only for the waveform.
    releaseLevel();
    levelStream.current = stream;
    showMic(stream);
    chooseEngine("browser");
    base.current = textNow.current ? textNow.current.trimEnd() + " " : "";
    heardCount.current = 0; setHeardWords(0); saidBefore.current = ""; silentRestarts.current = 0;
    wantListening.current = true;
    try { startRecognition(Ctor); setListening(true); setPhase("listening"); setError(null); }
    catch { wantListening.current = false; releaseLevel(); setError("Could not start dictation. Reload the page and try again, or type instead."); }
  }

  const englishOnly = engine === "whisper" && typeof navigator !== "undefined" && !!navigator.language && !navigator.language.toLowerCase().startsWith("en");

  return {
    listening, supported, heardWords, error, notice,
    /** The words heard in this dictation so far: live with the browser's engine, all at once when Whisper writes them out. */
    heard,
    clearError: () => { setError(null); setNotice(null); },
    toggle, stop, cancel,
    /** Which engine is (or was last) in use, for the wording on screen. */
    engine,
    /** listening, or transcribing (Whisper writing out the speech after Stop). */
    phase,
    /** True while speech is still being turned into text after Stop. */
    busy: phase === "transcribing",
    /** Model download progress (0 to 1) while it is still arriving, else null. */
    progress: modelReady ? null : progress,
    /** On-device dictation only understands English; true when the browser's language is something else. */
    englishOnly,
    /** The open microphone while listening, else null: the waveform measures it (it is also shared, see above). */
    stream: micStream,
  };
}
