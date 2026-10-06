"use client";

/**
 * The voice card (owner decision, 5 October 2026): dictation and voice notes everywhere in the web app look and feel
 * like the notch's voice card (desktop/src/main.js `voiceView`): an orb whose dot swells with your voice, a "Mic on"
 * status, a title and a hint, the words heard so far in italic quotes, and a shimmer while the words are worked on.
 *
 * v4 (6 October 2026): monochrome like the rest of the app. The orb is the tool-tile square made round (the canvas with
 * a barely-there vertical fill, a 7.5% ring, the natural shadow); while listening its orange dot (the accent: a live
 * microphone) swells with the voice and a thin orange ring widens around it; while working a foreground dot breathes.
 * "Mic on" is an orange status dot with a 15% halo and 12/16 text (a live microphone: accent rules, 6 October 2026). The card is fill-0
 * with a hairline, r16 (r18 inside the prompt pill, concentric with its r26), and keeps its faint orange light rising
 * from the bottom while the microphone is open (`.brenda-wash`, globals.css).
 *
 * The level comes from `level` when the caller measures it, else from `useMicLevel`, which opens the microphone for
 * itself while listening (or reads `stream` when the caller already holds one, as a voice note does) and only ever
 * measures loudness: nothing is recorded or sent. Movement is transform and opacity only; with reduced motion the dot
 * stays still and only the ring's strength follows the voice.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Square, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AudioContextCtor = typeof AudioContext;

/**
 * How loud the microphone is, 0 to 1: quick to rise and slow to fall, like the notch's orb. While `active` it opens its
 * own microphone stream (or listens to `stream` when given, which it leaves open) and releases everything when it goes
 * inactive or unmounts. Returns 0 while inactive, and stays at 0 when the microphone cannot be opened.
 */
export function useMicLevel(active: boolean, stream?: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let disposed = false;
    let frame = 0;
    let own: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    const release = () => {
      cancelAnimationFrame(frame);
      own?.getTracks().forEach((t) => t.stop()); own = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
      ctx = null;
    };
    void (async () => {
      let source = stream ?? null;
      if (!source) {
        if (!navigator.mediaDevices?.getUserMedia) return;
        try { source = own = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch { return; } // the dictation or the recorder says why; the orb just stays small
        if (disposed) { release(); return; }
      }
      const Ctor: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      if (disposed || !ctx) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(source).connect(analyser);
      const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let smooth = 0;
      let shown = -1;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
        // Root mean square, on a square-root curve so ordinary speech fills the orb; a small floor keeps room noise still.
        const target = Math.min(1, Math.max(0, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.7 - 0.08));
        smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
        // Only a visible change re-renders the card.
        if (Math.abs(smooth - shown) > 0.01) { shown = smooth; setLevel(smooth); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();
    return () => { disposed = true; release(); };
  }, [active, stream]);
  return active ? level : 0;
}

export interface VoiceCaptureProps {
  /** listening: the microphone is open. working: the words are being written out, or the note sent. */
  phase: "listening" | "working";
  /** Defaults to "Listening…" and "Getting your words…". */
  title?: string;
  /** One line under the title: what to do next, the time, the engine. */
  hint?: React.ReactNode;
  /** The words heard so far, shown in italic quotes (the latest ones when it is long). */
  heard?: string | null;
  /** 0 to 1 from the caller; when left out and listening, the card measures the microphone itself. */
  level?: number;
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

export function VoiceCapture({ phase, title, hint, heard, level, onStop, onCancel, compact = false, className, stream, actions }: VoiceCaptureProps): React.JSX.Element {
  const listening = phase === "listening";
  const measured = useMicLevel(listening && level === undefined, stream);
  const reduced = useReducedMotion();
  // The notch never lets the dot shrink to nothing: a floor of 0.08 keeps it visible in silence.
  const lvl = Math.round(Math.max(0.08, Math.min(1, level ?? measured)) * 100) / 100;
  const dot = compact ? "size-3" : "size-4";
  const said = heard?.trim() ? latest(heard) : null;
  // Plain buttons with the variant classes as they are: small sizes keep both their 13px type and their colour.
  const controls = (onCancel || (onStop && listening) || actions) ? (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      {onCancel ? <button type="button" onClick={onCancel} className={buttonVariants({ variant: "ghost", size: compact ? "xs" : "sm" })}><X aria-hidden />Cancel</button> : null}
      {onStop && listening ? <button type="button" onClick={onStop} className={buttonVariants({ variant: "secondary", size: compact ? "xs" : "sm" })}><Square className="fill-current" aria-hidden />Stop</button> : null}
      {actions}
    </div>
  ) : null;
  return (
    <div data-tone={listening ? "accent" : undefined}
      className={cn("brenda-wash relative flex flex-wrap items-center overflow-hidden border border-border bg-fill-0",
        compact ? "gap-x-2.5 gap-y-2 rounded-[18px] p-2 pr-2.5" : "gap-x-3 gap-y-2.5 rounded-2xl p-3", className)}>
      <div className={cn("flex min-w-0 flex-[1_1_14rem] items-center", compact ? "gap-2.5" : "gap-3")}>
        {/* The orb: the tool-tile square made round. Listening, the orange dot swells with the voice and a thin ring
            widens around it; working, a foreground dot breathes. */}
        <span aria-hidden className={cn("relative grid shrink-0 place-items-center rounded-full bg-background shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)]", compact ? "size-8" : "size-10")}
          style={{ backgroundImage: "linear-gradient(to bottom, var(--fill-1), var(--fill-150))" }}>
          {listening ? (
            <>
              {/* With reduced motion the ring keeps one size and only its strength follows the voice. */}
              <span className="absolute inset-0 rounded-full border border-accent transition-[opacity,transform] duration-[90ms] ease-linear"
                style={{ opacity: (0.12 + lvl * 0.6).toFixed(2), transform: `scale(${reduced ? 1 : (1 + lvl * 0.3).toFixed(3)})` }} />
              <span className={cn("relative rounded-full bg-accent transition-transform duration-[90ms] ease-linear", dot)} style={reduced ? undefined : { transform: `scale(${(0.75 + lvl * 0.9).toFixed(3)})` }} />
            </>
          ) : (
            <motion.span className={cn("rounded-full bg-foreground", dot)} initial={false}
              animate={reduced ? { opacity: 0.8, scale: 1 } : { opacity: [0.45, 0.9], scale: [0.6, 1] }}
              transition={reduced ? { duration: 0 } : { duration: 1.1, ease: [0.23, 1, 0.32, 1], repeat: Infinity, repeatType: "reverse" }} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* Announced when it changes: from listening to working, and back. */}
          <p role="status" className={cn("truncate text-sm font-medium text-foreground", !listening && "brenda-shimmer")}>{title ?? (listening ? "Listening…" : "Getting your words…")}</p>
          {said ? <p className="line-clamp-2 text-meta font-normal italic text-secondary">“{said}”</p> : null}
          {hint ? <div className="mt-0.5 line-clamp-2 text-xs font-normal text-secondary">{hint}</div> : null}
        </div>
        {listening ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-secondary">
            <span className="rec-dot size-1.5 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_15%,transparent)]" aria-hidden />Mic on
          </span>
        ) : null}
      </div>
      {controls}
    </div>
  );
}
