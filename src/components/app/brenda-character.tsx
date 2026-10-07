"use client";

/**
 * Brenda, drawn and alive (owner decision, 5 October 2026): the canvas character from `lib/brenda-character`. Her eyes
 * follow the pointer, she blinks and breathes, and `state` sets her expression (idle, listening, thinking, working,
 * happy, alert, question, error, sleeping, dizzy, love, proud). `emote()` on the ref plays a passing expression (love,
 * wink, proud, surprised, yawn, happy, pleased, annoyed, celebrate). When `interactive`, a click pokes her (three quick
 * pokes make her dizzy) and resting the pointer on her gives her heart eyes.
 *
 * Her reactions (owner request, 7 October 2026): while someone types to her (the page-wide `attention` her box feeds)
 * she reads along, her eyes on the caret, with a flick as each character arrives and a nod or a blink every few words,
 * and a surprised blink at a paste; a moment after the typing stops her eyes go back to the pointer. While she listens
 * she hears `stream` (the dictation's microphone, measured in her own drawing loop, no re-renders) or `level` (a reader
 * of 0 to 1, the gallery's), which widens her eyes and lifts her light; with neither, a gentle pulse. `lookAt()` on the
 * ref points her eyes at a spot on the page.
 *
 * One drawing loop, stopped while she is off screen or the tab is hidden. With reduced motion she is drawn still: each
 * state, and reading (her eyes on the box, held while the person types), is a still pose with nothing moving into it.
 *
 * Personal assistants (owner decision, 7 October 2026): she is drawn as the assistant in context, the person's own
 * (`AssistantProvider`) or a scoped one (`AssistantScope`: a preview, the workspace's), with its colour, visor and eyes,
 * and named by it unless `label` says otherwise. `look` draws another look outright (the editor's preview). A new look
 * shows from the next frame, with no transition; under reduced motion the still frame is redrawn at once.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { attention, BrendaEngine, type BrendaEmote, type BrendaState } from "@/lib/brenda-character/engine";
import { sameLook, type AssistantLook } from "@/lib/assistant-look";
import { useScopedAssistant } from "@/components/app/assistant-context";
import { playSound } from "@/lib/brenda-sound";
import { cn } from "@/lib/utils";

export type BrendaCharacterHandle = {
  emote: (e: BrendaEmote) => void;
  /** Points her eyes at a spot on the page (viewport coordinates), as she looks at the caret; null gives them back to the pointer. */
  lookAt: (x: number | null, y?: number) => void;
};

type AudioContextCtor = typeof AudioContext;
const REDUCE = "(prefers-reduced-motion: reduce)";

export const BrendaCharacter = forwardRef<BrendaCharacterHandle, {
  state?: BrendaState; size?: number; interactive?: boolean; className?: string; label?: string;
  /** The microphone she listens to while `state` is "listening" (the dictation's). */
  stream?: MediaStream | null;
  /** Or how loud the voice is now, 0 to 1, read each frame while she listens. */
  level?: () => number;
  /** The look to draw instead of the assistant in context (the editor's live preview). */
  look?: AssistantLook;
}>(function BrendaCharacter({ state = "idle", size = 120, interactive = false, className, label, stream = null, level, look }, ref) {
  const scoped = useScopedAssistant();
  const { colour, visor, eyes } = look ?? scoped;
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<BrendaEngine | null>(null);
  const pokes = useRef<number[]>([]);
  const loveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reacting = useRef(false);
  /** Points her eyes at a spot in viewport coordinates (set up with the canvas). */
  const place = useRef<(x: number | null, y?: number) => void>(() => {});
  /** Reduced motion: draws one still frame of the pose asked for. Null while she moves. */
  const still = useRef<(() => void) | null>(null);
  /** The voice she hears, read in the drawing loop: the caller's level, else her own reading of the microphone. */
  const levelRef = useRef(level);
  const hear = useRef<(() => number) | null>(null);
  useEffect(() => { levelRef.current = level; });
  /** The look she is created with (kept current for the drawing set-up below, which does not re-run for it). */
  const lookRef = useRef<AssistantLook>({ colour, visor, eyes });
  useEffect(() => { lookRef.current = { colour, visor, eyes }; });

  useImperativeHandle(ref, () => ({ emote: (e) => engine.current?.emote(e), lookAt: (x, y) => place.current(x, y) }), []);

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const e = (engine.current ??= new BrendaEngine(lookRef.current));
    const ctx = el.getContext("2d"); if (!ctx) return;
    const reduced = window.matchMedia(REDUCE).matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size * 1.5, H = size * 1.25; // room for her glow and particles
    el.width = Math.round(W * dpr); el.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0, last = performance.now(), visible = true;
    const draw = () => { e.draw(ctx, W, H); };
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      e.voice = levelRef.current?.() ?? hear.current?.() ?? null;
      e.update(dt); draw();
      frame = visible && document.visibilityState === "visible" ? requestAnimationFrame(loop) : 0;
    };
    const start = () => { if (!frame && !reduced) { last = performance.now(); frame = requestAnimationFrame(loop); } };
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      e.lookX = Math.tanh((ev.clientX - (r.left + r.width / 2)) / 260);
      e.lookY = Math.tanh((ev.clientY - (r.top + r.height / 2)) / 200);
    };
    // The caret is followed more keenly than the pointer (shorter distances reach the edge of her look).
    const aimAt = (p: { x: number; y: number } | null) => {
      if (!p) { e.lookAt(null); return; }
      const r = el.getBoundingClientRect();
      e.lookAt(Math.tanh((p.x - (r.left + r.width / 2)) / 180), Math.tanh((p.y - (r.top + r.height / 2)) / 90));
    };
    const settle = () => { e.settle(); draw(); };
    place.current = (x, y = 0) => { aimAt(x === null ? null : { x, y }); if (reduced) settle(); else start(); };
    // Someone typing to her. With reduced motion she takes the pose of reading when the typing starts and holds it
    // until it stops (no tracking, no flicks).
    let readingStill = !!attention.gaze;
    aimAt(attention.gaze);
    const offAttention = attention.subscribe((cue) => {
      const gaze = attention.gaze;
      if (reduced) {
        if (!!gaze === readingStill) return;
        readingStill = !!gaze; aimAt(gaze); settle(); return;
      }
      aimAt(gaze);
      if (gaze && cue) e.readAlong(cue);
      start();
    });
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); });
    io.observe(el);
    const onVis = () => { if (document.visibilityState === "visible") start(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onMove, { passive: true });
    still.current = reduced ? settle : null;
    if (reduced) settle(); else start();
    return () => {
      cancelAnimationFrame(frame); frame = 0; io.disconnect(); offAttention();
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointermove", onMove);
      still.current = null; place.current = () => {};
    };
  }, [size]);

  useEffect(() => { engine.current?.setState(state); still.current?.(); }, [state]);
  // A new look (the editor's preview, a saved profile): drawn from the next frame, or at once when she is still.
  useEffect(() => {
    const e = engine.current, next: AssistantLook = { colour, visor, eyes };
    if (!e || sameLook(e.look, next)) return;
    e.setLook(next); still.current?.();
  }, [colour, visor, eyes]);
  useEffect(() => () => { if (loveTimer.current) clearTimeout(loveTimer.current); }, []);

  // While she listens to a microphone: an analyser on it, read in her drawing loop (none under reduced motion, where
  // she is still). It measures the stream it is given; it never opens one.
  const listening = state === "listening";
  useEffect(() => {
    if (!listening || !stream || window.matchMedia(REDUCE).matches) return;
    const Ctor: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      // Root mean square on a square-root curve, as the voice card's level reads it, so ordinary speech reads high.
      hear.current = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
        return Math.min(1, Math.max(0, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.7 - 0.08));
      };
    } catch { /* not a stream with sound in it: she pulses gently instead */ }
    return () => {
      hear.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    };
  }, [listening, stream]);

  const poke = () => {
    const e = engine.current; if (!e) return;
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 1700), now];
    if (pokes.current.length >= 3) {
      pokes.current = [];
      const back = e.state;
      e.setState("dizzy"); playSound("dizzy");
      reacting.current = true;
      setTimeout(() => { reacting.current = false; if (engine.current?.state === "dizzy") engine.current.setState(back === "dizzy" ? "idle" : back); }, 3000);
      return;
    }
    if (!reacting.current) { e.squash(); e.emote("annoyed"); playSound("poke"); }
  };
  const admire = () => {
    if (loveTimer.current) clearTimeout(loveTimer.current);
    loveTimer.current = setTimeout(() => { engine.current?.emote("love"); playSound("love"); }, 1900);
  };
  const leave = () => { if (loveTimer.current) clearTimeout(loveTimer.current); };

  return (
    <canvas ref={canvas} role="img" aria-label={label ?? scoped.name} data-sphere={colour}
      style={{ width: size * 1.5, height: size * 1.25 }}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? poke : undefined}
      onKeyDown={interactive ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); poke(); } } : undefined}
      onPointerMove={interactive ? admire : undefined} onPointerLeave={interactive ? leave : undefined}
      className={cn("block select-none", interactive && "cursor-pointer", className)} />
  );
});
