"use client";

/**
 * The voice card: dictation and voice notes everywhere in the web app (Brenda's prompt boxes and the drawer's pill, My
 * Day's dictated to-dos, voice notes in Messages), and the notch's voice card in the same look (desktop/src/main.js).
 *
 * The recording look is ElevenLabs' (owner decision, 7 October 2026: "I want our voice note recording to look exactly
 * like ElevenLabs' one, the whole wave thing when recording"): one row with the live mark and the elapsed time on the
 * left (an orange live dot and orange digits in Geist Mono: a recording is live, accent rules), the live waveform
 * filling the middle (`LiveWaveform`: thin rounded bars in the foreground colour scrolling in from the right with the
 * voice, softer when quiet, edges fading), and the controls on the right: Cancel (a ghost ✕) and Stop (an orange square
 * on a quiet grey disc, as the prompt box's microphone while it records), then the caller's own (a voice note's Send).
 * While the words are worked on, the dot goes grey, the time stops and the bars become a slow travelling wave. Under
 * the row, when there is something to say: the title ("Listening…", shimmering while working; announced as a status),
 * the words heard so far in italic quotes, and the hint. With nothing under it the title is still announced.
 *
 * The card is fill-0 with a hairline, r16 (r18 inside the prompt pill, concentric with its r26), and keeps its faint
 * orange light rising from the bottom while the microphone is open (`.brenda-wash`, globals.css).
 *
 * One microphone per recording: the waveform measures `stream` when the caller passes it (a voice note), else the
 * microphone a recording on the page shares (`useSharedMicrophone`: dictation shares its own), and opens one of its own
 * only when there is neither; with `level` it follows the caller's level instead. Nothing is recorded or sent by it.
 * Reduced motion keeps the bars still (only their strength follows the voice) and the dot steady.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import { Square, X } from "lucide-react";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { StatusDot } from "@/components/ui/status-dot";
import { useSharedMicrophone } from "@/hooks/use-voice-recorder";
import { cn } from "@/lib/utils";

type AudioContextCtor = typeof AudioContext;

/**
 * How loud the microphone is, 0 to 1: quick to rise and slow to fall. While `active` it listens to `stream` when given,
 * else to the microphone a recording on the page shares, else (after a moment, in case one is about to be shared) it
 * opens its own; it only ever closes its own. Returns 0 while inactive, and stays at 0 when nothing can be opened.
 */
export function useMicLevel(active: boolean, stream?: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const shared = useSharedMicrophone();
  const given = stream ?? shared;
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let disposed = false;
    let frame = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;
    let own: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    const release = () => {
      clearTimeout(wait);
      cancelAnimationFrame(frame);
      own?.getTracks().forEach((t) => t.stop()); own = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
      ctx = null;
    };
    const measure = async (source: MediaStream) => {
      const Ctor: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      let analyser: AnalyserNode;
      try {
        ctx = new Ctor();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        if (disposed || !ctx) return;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        ctx.createMediaStreamSource(source).connect(analyser);
      } catch { return; } // not a stream with sound in it
      const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let smooth = 0;
      let shown = -1;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
        // Root mean square, on a square-root curve so ordinary speech reads high; a small floor keeps room noise still.
        const target = Math.min(1, Math.max(0, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.7 - 0.08));
        smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
        // Only a visible change re-renders.
        if (Math.abs(smooth - shown) > 0.01) { shown = smooth; setLevel(smooth); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    if (given) void measure(given);
    else if (navigator.mediaDevices?.getUserMedia) {
      wait = setTimeout(() => {
        void (async () => {
          try { own = await navigator.mediaDevices.getUserMedia({ audio: true }); }
          catch { return; } // the dictation or the recorder says why
          if (disposed) { release(); return; }
          void measure(own);
        })();
      }, 150);
    }
    return () => { disposed = true; release(); };
  }, [active, given]);
  return active ? level : 0;
}

/** Seconds since `running` last turned on, counted while it stays on and kept (frozen) after. */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const since = Date.now();
    const tick = () => setSeconds(Math.floor((Date.now() - since) / 1000));
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 250);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [running]);
  return seconds;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface VoiceCaptureProps {
  /** listening: the microphone is open. working: the words are being written out, or the note sent. */
  phase: "listening" | "working";
  /** Defaults to "Listening…" and "Getting your words…". */
  title?: string;
  /** One line under the title: what to do next, the engine, a download's progress. */
  hint?: React.ReactNode;
  /** The words heard so far, shown in italic quotes (the latest ones when it is long). */
  heard?: string | null;
  /** 0 to 1 from the caller; when left out and listening, the waveform measures the microphone itself. */
  level?: number;
  /** The elapsed time in seconds, when the caller keeps it (a voice note); otherwise the card counts from when it started listening. */
  seconds?: number;
  /** A Stop button, while listening. */
  onStop?: () => void;
  /** A Cancel button. */
  onCancel?: () => void;
  /** The smaller card for inside a box (the notch's own size). */
  compact?: boolean;
  className?: string;
  /** A microphone stream the caller already holds, measured instead of opening another. */
  stream?: MediaStream | null;
  /** Controls of the caller's own after Cancel and Stop (a voice note's Send). */
  actions?: React.ReactNode;
}

/** The last words of what was heard, so a long dictation shows where it is now. */
function latest(text: string, max = 160) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `…${t.slice(t.length - max).replace(/^\S*\s/, "")}` : t;
}

export function VoiceCapture({ phase, title, hint, heard, level, seconds, onStop, onCancel, compact = false, className, stream, actions }: VoiceCaptureProps): React.JSX.Element {
  const listening = phase === "listening";
  const shared = useSharedMicrophone();
  const counted = useElapsed(listening && seconds === undefined);
  const elapsed = seconds ?? counted;
  const said = heard?.trim() ? latest(heard) : null;
  const heading = title ?? (listening ? "Listening…" : "Getting your words…");
  // The line under the waveform: only when there is something to read, or the card is working (its shimmering title).
  const details = !!(said || hint || !listening);
  // Round 32px controls (36px in the larger card; 40px on touch screens), as the prompt box's.
  const round = cn("grid shrink-0 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:size-10",
    compact ? "size-8 [&_svg]:size-4" : "size-9 [&_svg]:size-[18px]");
  const status = <p role="status" className={details ? cn("truncate text-meta font-medium text-foreground", !listening && "brenda-shimmer") : "sr-only"}>{heading}</p>;
  return (
    <div data-tone={listening ? "accent" : undefined}
      className={cn("brenda-wash relative overflow-hidden border border-border bg-fill-0", compact ? "rounded-[18px] p-1.5" : "rounded-2xl p-2", className)}>
      <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
        {/* The live mark and the time: orange while recording (live), grey and still once it stops. */}
        <span className={cn("inline-flex shrink-0 items-center gap-2", compact ? "pl-2" : "pl-2.5")}>
          <StatusDot tone={listening ? "live" : "neutral"} size={compact ? 6 : 8} />
          <span role="timer" aria-label={`${listening ? "Recording" : "Recorded"} ${clock(elapsed)}`}
            className={cn("font-mono text-meta font-medium tabular-nums", listening ? "text-accent-text" : "text-secondary")}>{clock(elapsed)}</span>
        </span>
        <LiveWaveform aria-hidden active={listening} processing={!listening} stream={stream ?? shared} level={level}
          barWidth={compact ? 2 : 3} barGap={1} fadeWidth={compact ? 20 : 24} className={cn("flex-1", compact ? "h-8" : "h-9")} />
        {onCancel || (onStop && listening) || actions ? (
          <div className="flex shrink-0 items-center gap-1">
            {onCancel ? (
              <button type="button" onClick={onCancel} aria-label="Cancel" className={cn(round, "text-secondary hover:bg-fill-1 hover:text-foreground")}><X aria-hidden /></button>
            ) : null}
            {onStop && listening ? (
              <button type="button" onClick={onStop} aria-label="Stop" className={cn(round, "bg-fill-1 text-accent hover:bg-fill-150")}><Square className="!size-3.5 fill-current" aria-hidden /></button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      {details ? (
        <div className={cn("min-w-0", compact ? "px-2 pb-1 pt-1.5" : "px-2.5 pb-1 pt-2")}>
          {status}
          {said ? <p className="line-clamp-2 text-meta font-normal italic text-secondary">“{said}”</p> : null}
          {hint ? <div className="mt-0.5 line-clamp-2 text-xs font-normal text-secondary">{hint}</div> : null}
        </div>
      ) : status}
    </div>
  );
}
