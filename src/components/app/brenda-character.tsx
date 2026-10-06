"use client";

/**
 * Brenda, drawn and alive (owner decision, 5 October 2026): the canvas character from `lib/brenda-character`. Her eyes
 * follow the pointer, she blinks and breathes, and `state` sets her expression (idle, listening, thinking, working,
 * happy, alert, question, error, sleeping, dizzy, love, proud). `emote()` on the ref plays a passing expression (love,
 * wink, proud, surprised, yawn, happy, annoyed, celebrate). When `interactive`, a click pokes her (three quick pokes
 * make her dizzy) and resting the pointer on her gives her heart eyes.
 *
 * The drawing loop stops while she is off screen or the tab is hidden; with reduced motion she is drawn once, still.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BrendaEngine, type BrendaEmote, type BrendaState } from "@/lib/brenda-character/engine";
import { playSound } from "@/lib/brenda-sound";
import { cn } from "@/lib/utils";

export type BrendaCharacterHandle = { emote: (e: BrendaEmote) => void };

export const BrendaCharacter = forwardRef<BrendaCharacterHandle, {
  state?: BrendaState; size?: number; interactive?: boolean; className?: string; label?: string;
}>(function BrendaCharacter({ state = "idle", size = 120, interactive = false, className, label = "Brenda" }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<BrendaEngine | null>(null);
  const pokes = useRef<number[]>([]);
  const loveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reacting = useRef(false);

  useImperativeHandle(ref, () => ({ emote: (e) => engine.current?.emote(e) }), []);

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const e = (engine.current ??= new BrendaEngine());
    const ctx = el.getContext("2d"); if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size * 1.5, H = size * 1.25; // room for her glow and particles
    el.width = Math.round(W * dpr); el.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0, last = performance.now(), visible = true;
    const draw = () => { e.draw(ctx, W, H); };
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      e.update(dt); draw();
      frame = visible && document.visibilityState === "visible" ? requestAnimationFrame(loop) : 0;
    };
    const start = () => { if (!frame && !reduced) { last = performance.now(); frame = requestAnimationFrame(loop); } };
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      e.lookX = Math.tanh((ev.clientX - (r.left + r.width / 2)) / 260);
      e.lookY = Math.tanh((ev.clientY - (r.top + r.height / 2)) / 200);
    };
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); });
    io.observe(el);
    const onVis = () => { if (document.visibilityState === "visible") start(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onMove, { passive: true });
    if (reduced) { e.update(0); draw(); } else start();
    return () => { cancelAnimationFrame(frame); frame = 0; io.disconnect(); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointermove", onMove); };
  }, [size]);

  useEffect(() => { engine.current?.setState(state); }, [state]);
  useEffect(() => () => { if (loveTimer.current) clearTimeout(loveTimer.current); }, []);

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
    <canvas ref={canvas} role="img" aria-label={label}
      style={{ width: size * 1.5, height: size * 1.25 }}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? poke : undefined}
      onKeyDown={interactive ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); poke(); } } : undefined}
      onPointerMove={interactive ? admire : undefined} onPointerLeave={interactive ? leave : undefined}
      className={cn("block select-none", interactive && "cursor-pointer", className)} />
  );
});
