"use client";

/**
 * Brenda's face in the web app (owner decision, 4 October 2026): the same character as the desktop notch. Her eyes
 * follow the pointer with a lag, she blinks every few seconds and breathes, and her mood and glow follow what is
 * happening. When `interactive`, a click pokes her (a squash, three quick pokes make her dizzy) and resting the pointer
 * on her for a moment gives her heart eyes. Timings and rules after Coucou by Louis Raillé (MIT); the character is ours.
 *
 * She is the one exception to "no control animates on its own" (docs/design-system.md). Reduced motion stills her.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/brenda-sound";

export type BrendaMood = "happy" | "alert" | "sad" | "think" | "listen" | null;
export type BrendaTone = "accent" | "ok" | "warn" | "bad" | "blue" | "violet" | null;

// One pointer listener and one blink clock for every face on the page.
const faces = new Set<HTMLElement>();
const looks = new WeakMap<HTMLElement, { x: number; y: number }>();
let pointer: { x: number; y: number } | null = null;
let frame: number | null = null;
let started = false;

function step() {
  frame = null;
  if (!pointer) return;
  let moving = false;
  for (const el of faces) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const tx = Math.tanh((pointer.x - (r.left + r.width / 2)) / 260);
    const ty = Math.tanh((pointer.y - (r.top + r.height / 2)) / 200);
    const l = looks.get(el) ?? { x: 0, y: 0 };
    l.x += (tx - l.x) * 0.2; l.y += (ty - l.y) * 0.2;
    looks.set(el, l);
    el.style.setProperty("--lx", l.x.toFixed(3));
    el.style.setProperty("--ly", l.y.toFixed(3));
    if (Math.abs(tx - l.x) > 0.003 || Math.abs(ty - l.y) > 0.003) moving = true;
  }
  if (moving) frame = requestAnimationFrame(step);
}

function blink(twice: boolean) {
  for (const el of faces) el.classList.add("blink");
  setTimeout(() => {
    for (const el of faces) el.classList.remove("blink");
    if (twice) setTimeout(() => blink(false), 160);
  }, 130);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; if (!frame) frame = requestAnimationFrame(step); }, { passive: true });
  const loop = () => setTimeout(() => { if (faces.size && document.visibilityState === "visible") blink(Math.random() < 0.22); loop(); }, 2200 + Math.random() * 3200);
  loop();
}

type Fx = "squash" | "dizzy" | "love" | null;

export function BrendaFace({ mood = null, tone = null, size = "md", interactive = false, className }: { mood?: BrendaMood; tone?: BrendaTone; size?: "sm" | "md" | "lg"; interactive?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fx, setFx] = useState<Fx>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokes = useRef<number[]>([]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    start(); faces.add(el);
    return () => { faces.delete(el); };
  }, []);
  useEffect(() => () => { if (fxTimer.current) clearTimeout(fxTimer.current); if (loveTimer.current) clearTimeout(loveTimer.current); }, []);

  const react = useCallback((name: Exclude<Fx, null>, ms: number) => {
    setFx(null);
    requestAnimationFrame(() => setFx(name));
    if (fxTimer.current) clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setFx(null), ms);
  }, []);

  const poke = () => {
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 1700), now];
    if (pokes.current.length >= 3) { pokes.current = []; react("dizzy", 3000); playSound("dizzy"); return; }
    if (fx !== "dizzy") { react("squash", 800); playSound("poke"); }
  };
  const admire = () => {
    if (loveTimer.current) clearTimeout(loveTimer.current);
    if (fx) return;
    loveTimer.current = setTimeout(() => { react("love", 2600); playSound("love"); }, 1900);
  };
  const leave = () => { if (loveTimer.current) clearTimeout(loveTimer.current); };

  return (
    <span ref={ref} aria-hidden={!interactive} data-tone={tone ?? undefined}
      role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? "Poke Brenda" : undefined}
      onClick={interactive ? poke : undefined} onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } } : undefined}
      onPointerMove={interactive ? admire : undefined} onPointerLeave={interactive ? leave : undefined}
      className={cn("brenda-face", `brenda-face-${size}`, mood, fx, interactive && "cursor-pointer", className)}>
      <span className="eyes"><span /><span /></span>
    </span>
  );
}
