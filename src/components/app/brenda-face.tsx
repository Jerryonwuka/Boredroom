"use client";

/**
 * Brenda's face in the web app (owner decision, 4 October 2026): the same character as the desktop notch. Her eyes
 * follow the pointer with a lag, she blinks every few seconds and breathes, and her mood and glow follow what is
 * happening. When `interactive`, a click pokes her (a squash, three quick pokes make her dizzy) and resting the pointer
 * on her for a moment gives her heart eyes. Timings and rules after Coucou by Louis Raillé (MIT); the character is ours.
 *
 * Her reactions (owner request, 7 October 2026): while someone types to her, every face of hers on the page reads along
 * (the page-wide `attention` her box feeds, lib/brenda-character/engine): the eyes go to the caret and follow it, more
 * keenly than the pointer, with a small flick as characters arrive, a nod or a blink every few words and a surprised
 * blink at a paste; a moment after the typing stops they go back to the pointer. The `listen` mood (dictating) tilts her
 * head and her wide eyes pulse gently.
 *
 * She is the one exception to "no control animates on its own" (docs/design-system.md). Reduced motion stills her:
 * reading is a still pose (eyes on the box from when the typing starts until it stops), listening a still tilt.
 *
 * Personal assistants (owner decision, 7 October 2026): the face is the assistant in context, the person's own or a
 * scoped one (`AssistantScope`), or `look` when given (the editor's choices): its sphere colour as `--sphere-*` custom
 * properties, its visor and eyes as `data-visor` and `data-eyes` (globals.css draws them; every mood still wins over the
 * eye style). A poke is offered under the assistant's name.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/brenda-sound";
import { attention, type ReadCue } from "@/lib/brenda-character/engine";
import { faceStyle, isAssistantColour, type AssistantLook } from "@/lib/assistant-look";
import { useScopedAssistant } from "@/components/app/assistant-context";

export type BrendaMood = "happy" | "alert" | "sad" | "think" | "listen" | null;
export type BrendaTone = "accent" | "ok" | "warn" | "bad" | "blue" | "violet" | null;

type Point = { x: number; y: number };

// One pointer listener, one blink clock and one reader for every face on the page.
const faces = new Set<HTMLElement>();
const looks = new WeakMap<HTMLElement, Point>();
let pointer: Point | null = null;
/** Where her eyes are on the box being typed to her: the caret, or with reduced motion where it was when the typing began. */
let reading: Point | null = null;
let frame: number | null = null;
let started = false;
let motion: MediaQueryList | null = null;
let beats = 0;

/** Moves every face's eyes towards the caret, else the pointer, else the middle; at once when `snap`. */
function step(snap = false) {
  frame = null;
  const at = reading ?? pointer;
  let moving = false;
  for (const el of faces) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const tx = at ? Math.tanh((at.x - (r.left + r.width / 2)) / (reading ? 150 : 260)) : 0;
    const ty = at ? Math.tanh((at.y - (r.top + r.height / 2)) / (reading ? 70 : 200)) : 0;
    const l = looks.get(el) ?? { x: 0, y: 0 };
    const ease = snap ? 1 : reading ? 0.3 : 0.2;
    l.x += (tx - l.x) * ease; l.y += (ty - l.y) * ease;
    looks.set(el, l);
    el.style.setProperty("--lx", l.x.toFixed(3));
    el.style.setProperty("--ly", l.y.toFixed(3));
    if (Math.abs(tx - l.x) > 0.003 || Math.abs(ty - l.y) > 0.003) moving = true;
  }
  if (moving) frame = requestAnimationFrame(tick);
}
const tick = () => step();

function blink(twice: boolean) {
  for (const el of faces) el.classList.add("blink");
  setTimeout(() => {
    for (const el of faces) el.classList.remove("blink");
    if (twice) setTimeout(() => blink(false), 160);
  }, 130);
}

/** A passing class on every face (a nod, a surprised look). */
function flash(name: string, ms: number) {
  for (const el of faces) el.classList.add(name);
  setTimeout(() => { for (const el of faces) el.classList.remove(name); }, ms);
}

/** Someone is typing to her (or stopped): every face reads along. */
function onAttention(cue: ReadCue | null) {
  const gaze = attention.gaze;
  if (motion?.matches) {
    // Reduced motion: the pose of reading when the typing starts, held until it stops; no tracking and no flicks.
    if (!gaze === !reading) return;
    reading = gaze;
    step(true);
    return;
  }
  reading = gaze;
  if (gaze && cue === "key") for (const el of faces) { const l = looks.get(el); if (l) l.x += (Math.random() < 0.5 ? -1 : 1) * 0.3; }
  else if (gaze && cue === "beat") { if (beats++ % 2) blink(false); else flash("nod", 200); }
  else if (gaze && cue === "paste") { flash("startle", 650); setTimeout(() => blink(false), 160); }
  if (!frame) frame = requestAnimationFrame(tick);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; if (!frame) frame = requestAnimationFrame(tick); }, { passive: true });
  attention.subscribe(onAttention);
  const loop = () => setTimeout(() => { if (faces.size && document.visibilityState === "visible") blink(Math.random() < 0.22); loop(); }, 2200 + Math.random() * 3200);
  loop();
}

type Fx = "squash" | "dizzy" | "love" | null;

export function BrendaFace({ mood = null, tone = null, size = "md", interactive = false, className, look, style }: {
  mood?: BrendaMood; tone?: BrendaTone; size?: "sm" | "md" | "lg"; interactive?: boolean; className?: string;
  /** The look to draw instead of the assistant in context (the editor's options). */
  look?: AssistantLook;
  style?: CSSProperties;
}) {
  const scoped = useScopedAssistant();
  const { colour, visor, eyes } = look ?? scoped;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fx, setFx] = useState<Fx>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokes = useRef<number[]>([]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    start(); faces.add(el);
    // A face that appears while she is reading (her reply to the last message, the chat opening) joins in.
    if (reading) { if (motion?.matches) step(true); else if (!frame) frame = requestAnimationFrame(tick); }
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
    <span ref={ref} aria-hidden={!interactive} data-tone={tone ?? undefined} data-visor={visor} data-eyes={eyes}
      style={{ ...faceStyle(isAssistantColour(colour) ? colour : "white"), ...style } as CSSProperties}
      role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? `Poke ${scoped.name}` : undefined}
      onClick={interactive ? poke : undefined} onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } } : undefined}
      onPointerMove={interactive ? admire : undefined} onPointerLeave={interactive ? leave : undefined}
      className={cn("brenda-face", `brenda-face-${size}`, mood, fx, interactive && "cursor-pointer", className)}>
      <span className="eyes"><span /><span /></span>
    </span>
  );
}
