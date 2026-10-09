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
 *
 * Her voice (owner decision, 7 October 2026: phase 2): while she speaks a reply, every face of hers on the page talks at
 * once (she is one person). One subscription to the page's one voice (`speech`, lib/assistant-speech/controller) marks
 * every face with `data-talking` (an attribute React never renders, so a re-render or a mood change keeps it; a class
 * would not survive React rewriting `className`) and sets `--talk`, the level from 0 to 1, each frame; globals.css
 * squashes and opens her eyes with it, bobs her a little and brightens her glow in her own sphere colour. Under reduced
 * motion `--talk` is never set and the CSS holds a still speaking pose. `quiet` (rendered as `data-quiet`) keeps a face
 * from ever talking: the editor's option cards, the workspace assistant's faces.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/brenda-sound";
import { attention, type ReadCue } from "@/lib/brenda-character/engine";
import { speech } from "@/lib/assistant-speech/controller";
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
  // Measure every face first, then write: a layout read after a style write forces the browser to recompute style and
  // layout at once, so alternating them cost a whole recalculation per face on a page of many faces.
  const boxes: [HTMLElement, DOMRect][] = [];
  for (const el of faces) boxes.push([el, el.getBoundingClientRect()]);
  for (const [el, r] of boxes) {
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

/**
 * Her voice: a face talks while she speaks, unless it is a quiet one. Its level is cleared when it stops. It follows
 * `talking` (the audio has started), not `speaking`, so no face squints while the browser has yet to begin.
 */
function voice(el: HTMLElement, speaking = speech.getSnapshot().talking) {
  const on = speaking && !el.hasAttribute("data-quiet");
  if (on === el.hasAttribute("data-talking")) return;
  el.toggleAttribute("data-talking", on);
  if (!on) el.style.removeProperty("--talk");
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; if (!frame) frame = requestAnimationFrame(tick); }, { passive: true });
  attention.subscribe(onAttention);
  // Her voice: every face of hers talks while she speaks, with the level each frame (none under reduced motion, where
  // the talking face is a still pose).
  speech.subscribe(() => { const speaking = speech.getSnapshot().talking; for (const el of faces) voice(el, speaking); });
  speech.subscribeLevel((level) => {
    if (motion?.matches) return;
    const v = level.toFixed(3);
    for (const el of faces) if (el.hasAttribute("data-talking")) el.style.setProperty("--talk", v);
  });
  const loop = () => setTimeout(() => { if (faces.size && document.visibilityState === "visible") blink(Math.random() < 0.22); loop(); }, 2200 + Math.random() * 3200);
  loop();
}

type Fx = "squash" | "dizzy" | "love" | null;

export function BrendaFace({ mood = null, tone = null, size = "md", interactive = false, className, look, style, quiet = false }: {
  mood?: BrendaMood; tone?: BrendaTone; size?: "sm" | "md" | "lg"; interactive?: boolean; className?: string;
  /** The look to draw instead of the assistant in context (the editor's options). */
  look?: AssistantLook;
  style?: CSSProperties;
  /** Never talks, even while she speaks (the editor's option cards, the workspace assistant's faces). */
  quiet?: boolean;
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
  // Her voice: a face that appears while she speaks talks along at once; one told to keep quiet (or no longer) follows.
  useEffect(() => { const el = ref.current; if (el) voice(el); }, [quiet]);
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
    <span ref={ref} aria-hidden={!interactive} data-tone={tone ?? undefined} data-colour={isAssistantColour(colour) ? colour : "white"} data-visor={visor} data-eyes={eyes} data-quiet={quiet || undefined}
      style={{ ...faceStyle(isAssistantColour(colour) ? colour : "white"), ...style } as CSSProperties}
      role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? `Poke ${scoped.name}` : undefined}
      onClick={interactive ? poke : undefined} onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } } : undefined}
      onPointerMove={interactive ? admire : undefined} onPointerLeave={interactive ? leave : undefined}
      className={cn("brenda-face", `brenda-face-${size}`, mood, fx, interactive && "cursor-pointer", className)}>
      <span className="eyes"><span /><span /></span>
    </span>
  );
}
