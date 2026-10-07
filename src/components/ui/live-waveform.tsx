"use client";

/**
 * The live waveform (owner decision, 7 October 2026: "I want our voice note recording to look exactly like ElevenLabs'
 * one, the whole wave thing when recording"). Thin rounded vertical bars on a centre line that scroll in from the right
 * as you speak, each as tall as the microphone was loud at that moment, softer when quiet, the edges fading out; while
 * the words are worked on, the bars turn into a slow travelling wave (ElevenLabs' "processing" state), blended from the
 * last thing heard. Before anything is heard the strip is a dotted line of quiet bars.
 *
 * Adapted from ElevenLabs UI's `live-waveform` (https://ui.elevenlabs.io, https://github.com/elevenlabs/ui,
 * apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx), MIT licence, notice below. Kept: the canvas drawing, the level
 * (the average of the 5 to 40% frequency bins), the bar shape and opacity (0.4 + 0.6 × level), the 1px gap, the 4px
 * shortest bar (silence is a row of short bars, never gaps), the sensitivity and smoothing of their recording parts
 * (voice button, conversation bar: 1.8 and 0.85), the processing wave and the edge fade. Changed for Boredroom: scrolling only, moving smoothly by device pixels between samples; the source can be a
 * stream the caller already holds (one microphone per recording) or a level the caller measures (the gallery), and it
 * opens its own microphone only when given neither; empty slots draw as quiet dots; the colour is the text colour
 * (`text-foreground` unless told otherwise); and reduced motion keeps the bars still, only their strength following the
 * voice. The desktop notch carries a plain-JavaScript port of this file (desktop/src/main.js, "the live waveform").
 *
 * MIT License
 *
 * Copyright (c) 2025 Eleven Labs Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import * as React from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type AudioContextCtor = typeof AudioContext;

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const reducedNow = () => typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;
/** prefers-reduced-motion, live (false on the server). */
function usePrefersReducedMotion() { return useSyncExternalStore(subscribeReduced, reducedNow, () => false); }

/** A fixed, speech-like outline for the still bars of reduced motion: deterministic, taller towards the middle. */
const still = (i: number, n: number) => {
  const centre = 1 - Math.abs((i - n / 2) / (n / 2)) * 0.5;
  const ripple = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
  return Math.max(0.15, centre * ripple);
};

export type LiveWaveformProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Listening: the bars follow the microphone (or `level`) and scroll. */
  active?: boolean;
  /** Working: a slow travelling wave, while the words are written out or the note is sent. */
  processing?: boolean;
  /** A microphone stream the caller already holds: measured, and left open. */
  stream?: MediaStream | null;
  /** A level from the caller, 0 to 1, followed instead of measuring a stream. */
  level?: number;
  /** With neither `stream` nor `level`, open a microphone of its own while active (default true). */
  openMicrophone?: boolean;
  /** Bar width, gap and corner radius in px (2, 1 and fully round by default, as ElevenLabs' recording parts). */
  barWidth?: number;
  barGap?: number;
  barRadius?: number;
  /** The shortest bar in px: silence is a row of short bars (4, ElevenLabs' `barHeight`). Slots not heard yet are dots. */
  minBarHeight?: number;
  /** Fade the left and right edges out over `fadeWidth` px. */
  fadeEdges?: boolean;
  fadeWidth?: number;
  /** How strongly the bars follow the voice (1.8 by default, as ElevenLabs' recording parts). */
  sensitivity?: number;
  /** Milliseconds between samples: the scrolling speed is one bar per sample (30 ms, as ElevenLabs). */
  updateRate?: number;
  fftSize?: number;
  smoothingTimeConstant?: number;
  /** A CSS colour; by default the element's text colour (`text-foreground`). */
  barColor?: string;
};

export function LiveWaveform({
  active = false, processing = false, stream, level, openMicrophone = true,
  barWidth = 2, barGap = 1, barRadius, minBarHeight = 4, fadeEdges = true, fadeWidth = 24,
  sensitivity = 1.8, updateRate = 30, fftSize = 256, smoothingTimeConstant = 0.85, barColor,
  className, ...props
}: LiveWaveformProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRef = useRef<number | undefined>(level);
  const historyRef = useRef<number[]>([]);
  const reduced = usePrefersReducedMotion();
  const followsLevel = level !== undefined;

  useEffect(() => { levelRef.current = level; }, [level]);

  // The microphone: the caller's stream, or (with neither a stream nor a level) one of its own. Its own waits a moment,
  // so a recording that publishes its stream just after the card appears is measured instead of a second one opened.
  useEffect(() => {
    if (!active || followsLevel) return;
    let disposed = false;
    let ctx: AudioContext | null = null;
    let own: MediaStream | null = null;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const connect = async (source: MediaStream) => {
      const Ctor: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      try {
        ctx = new Ctor();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        if (disposed) return;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothingTimeConstant;
        ctx.createMediaStreamSource(source).connect(analyser);
        analyserRef.current = analyser;
      } catch { /* not a stream with sound in it: the bars stay quiet */ }
    };
    if (stream) void connect(stream);
    else if (openMicrophone && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      wait = setTimeout(() => {
        void (async () => {
          try { own = await navigator.mediaDevices.getUserMedia({ audio: true }); }
          catch { return; } // the recorder says why; the bars just stay quiet
          if (disposed) { own.getTracks().forEach((t) => t.stop()); own = null; return; }
          void connect(own);
        })();
      }, 150);
    }
    return () => {
      disposed = true;
      clearTimeout(wait);
      analyserRef.current = null;
      own?.getTracks().forEach((t) => t.stop());
      own = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
      ctx = null;
    };
  }, [active, followsLevel, stream, openMicrophone, fftSize, smoothingTimeConstant]);

  // Drawing: one frame loop while listening, working or fading out; idle, it draws the dotted line once and stops.
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const history = historyRef.current;
    if (active) history.length = 0; // every recording starts on an empty strip
    const step = barWidth + barGap;
    const radius = barRadius ?? barWidth / 2;
    let raf = 0;
    let lastPush = 0;
    let smooth = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let colour = "";
    let frames = 0;
    let fade: CanvasGradient | null = null;
    let fadeFor = 0;
    const startedAt = performance.now();
    const blendFrom = processing ? history.slice() : [];
    let fadeOut = !active && !processing && history.length ? 1 : 0;

    /** The microphone's loudness now, 0 to 1: the caller's level eased (quick to rise, slow to fall), or the analyser's band average. */
    const sample = () => {
      const given = levelRef.current;
      if (given !== undefined) {
        const t = Math.max(0, Math.min(1, given));
        smooth += (t - smooth) * (t > smooth ? 0.6 : 0.2);
        return smooth;
      }
      const a = analyserRef.current;
      if (!a) return 0;
      if (!bins || bins.length !== a.frequencyBinCount) bins = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
      a.getByteFrequencyData(bins);
      const from = Math.floor(bins.length * 0.05), to = Math.max(from + 1, Math.floor(bins.length * 0.4));
      let sum = 0;
      for (let i = from; i < to; i++) sum += bins[i];
      return Math.min(1, (sum / (to - from) / 255) * sensitivity);
    };

    /** One bar, at least `minBarHeight` tall (silence is a row of short bars, as ElevenLabs'); `dot` draws a slot not heard yet. */
    const bar = (x: number, v: number, alpha: number, h: number, dpr: number, dot = false) => {
      const height = dot ? barWidth : Math.max(minBarHeight, v * h * 0.8);
      const y = Math.round(((h - height) / 2) * dpr) / dpr;
      g.globalAlpha = alpha;
      g.beginPath();
      if (typeof g.roundRect === "function") g.roundRect(x, y, barWidth, height, Math.min(radius, height / 2));
      else g.rect(x, y, barWidth, height);
      g.fill();
    };

    const draw = (now: number) => {
      raf = 0;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (w && h) {
        const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalCompositeOperation = "source-over";
        g.clearRect(0, 0, w, h);
        if (!colour || frames++ % 30 === 0) colour = barColor ?? (getComputedStyle(canvas).color || "#fff");
        g.fillStyle = colour;
        const count = Math.ceil(w / step) + 1;

        if (active) {
          const v = sample();
          if (!lastPush || now - lastPush > updateRate * 4) lastPush = now - updateRate; // first sample now; never catch up in a burst
          while (now - lastPush >= updateRate) { history.push(Math.max(0.05, v)); lastPush += updateRate; }
          if (history.length > count + 2) history.splice(0, history.length - count - 2);
          if (reduced) {
            // Still bars: one outline that never moves; only their strength follows the voice.
            const n = Math.floor(w / step);
            const x0 = (w - n * step + barGap) / 2;
            for (let i = 0; i < n; i++) bar(x0 + i * step, still(i, n) * 0.7, 0.25 + v * 0.75, h, dpr);
          } else {
            // Newest on the right; everything slides left by device pixels until the next sample lands.
            const shift = Math.min(1, (now - lastPush) / updateRate) * step;
            for (let i = 0; i < count; i++) {
              const x = Math.round((w - (i + 1) * step - shift) * dpr) / dpr;
              if (x + barWidth < 0) break;
              const value = history[history.length - 1 - i];
              if (value === undefined) bar(x, 0, 0.2, h, dpr, true); // not heard yet: a quiet dot
              else bar(x, value, 0.4 + value * 0.6, h, dpr);
            }
          }
        } else if (processing) {
          const n = Math.floor(w / step);
          const x0 = (w - n * step + barGap) / 2;
          if (reduced) {
            for (let i = 0; i < n; i++) bar(x0 + i * step, still(i, n) * 0.5, 0.35, h, dpr);
          } else {
            // ElevenLabs' processing wave, blended in over about a second from what was last heard.
            const t = ((now - startedAt) / 1000) * 1.8;
            const blend = Math.min(1, (now - startedAt) / 900);
            for (let i = 0; i < n; i++) {
              const pos = (i - n / 2) / (n / 2);
              const centre = 1 - Math.abs(pos) * 0.4;
              const wave = Math.sin(t * 1.5 + i * 0.15) * 0.25 + Math.sin(t * 0.8 - i * 0.1) * 0.2 + Math.cos(t * 2 + i * 0.05) * 0.15;
              let v = (0.2 + wave) * centre;
              if (blendFrom.length && blend < 1) v = (blendFrom[Math.floor((i / n) * blendFrom.length)] ?? 0) * (1 - blend) + v * blend;
              v = Math.max(0.05, Math.min(1, v));
              bar(x0 + i * step, v, 0.4 + v * 0.6, h, dpr);
            }
          }
        } else {
          // Idle: what was heard sinks away, then the dotted line.
          if (fadeOut > 0) { fadeOut = Math.max(0, fadeOut - 0.06); for (let i = 0; i < history.length; i++) history[i] *= fadeOut; }
          if (!fadeOut) history.length = 0;
          for (let i = 0; i < count; i++) {
            const x = Math.round((w - (i + 1) * step) * dpr) / dpr;
            const value = history[history.length - 1 - i];
            bar(x, value ?? 0, value === undefined ? 0.2 : 0.4 + value * 0.6, h, dpr, value === undefined);
          }
        }

        if (fadeEdges && fadeWidth > 0) {
          if (!fade || fadeFor !== w) {
            fade = g.createLinearGradient(0, 0, w, 0);
            const p = Math.min(0.3, fadeWidth / w);
            fade.addColorStop(0, "rgba(255,255,255,1)");
            fade.addColorStop(p, "rgba(255,255,255,0)");
            fade.addColorStop(1 - p, "rgba(255,255,255,0)");
            fade.addColorStop(1, "rgba(255,255,255,1)");
            fadeFor = w;
          }
          g.globalAlpha = 1;
          g.globalCompositeOperation = "destination-out";
          g.fillStyle = fade;
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = "source-over";
        }
        g.globalAlpha = 1;
      }
      // A strip not laid out yet keeps looking while it is meant to move; a still one is redrawn when its size changes.
      const moving = active || (processing && (!reduced || !w || !h)) || fadeOut > 0;
      if (moving) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(draw); }) : null;
    resized?.observe(canvas);
    return () => { cancelAnimationFrame(raf); resized?.disconnect(); };
  }, [active, processing, reduced, barWidth, barGap, barRadius, minBarHeight, fadeEdges, fadeWidth, sensitivity, updateRate, barColor]);

  return (
    <div role="img" aria-label={active ? "Live microphone level" : processing ? "Working on the recording" : "Microphone off"}
      {...props} className={cn("relative min-w-0 text-foreground", className)}>
      <canvas ref={canvasRef} aria-hidden className="block size-full" />
    </div>
  );
}
