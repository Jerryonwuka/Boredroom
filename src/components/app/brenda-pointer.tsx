"use client";

/**
 * Brenda points (owner request, 11 October 2026: "press the two buttons, ask Brenda a question about what I'm pointing at
 * on my screen and she helps me out with it"; contract E.2). Inside Boredroom she needs no screen access: key buttons
 * and sections carry `data-brenda-target="<key>"` (the catalogue is `lib/brenda-targets`), and when a page opens with
 * `?point=<key>`, or someone calls `pointAt(key)` (her chat's "Show me"), the person's own assistant glides from her
 * floating button (or the top of the screen) to beside that element, draws a soft orange ring round it with a pill
 * naming it, holds it for 3 seconds and fades.
 *
 * - Runs on arrival, when the path changes (the address is read from `window.location` in an effect, never
 *   `useSearchParams`, which would make every page that mounts the shell dynamic: see commit 0441c80), on `popstate`
 *   and on `brenda:point`. It waits up to 4 seconds for the element to be on the page and shown (rendered, a size, not
 *   inside anything hidden, inert or aria-hidden), takes `point` out of the address with `history.replaceState` (which
 *   Next's router follows), and scrolls the element to the middle of the screen. Not found: a quiet toast.
 * - It follows the element while it shows (scrolling, resizing, layout moving), and Escape or any press ends it at once.
 *   Focus never moves; a polite live region says "Here: {label}".
 * - The label is the catalogue's, never the model's words.
 * - Reduced motion: no glide and no drawing: her face, a still ring and the label appear at once for 4 seconds.
 * - Design system v4: orange only for the ring (it marks the one thing to do); the pill is solid fill-1 with a hairline,
 *   no glow. The layer is fixed, above dialogs and sheets (`--z-toast`), and never takes a press.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { BrendaFace } from "@/components/app/brenda-face";
import { notify } from "@/components/ui/toast";
import { POINT_PARAM, TARGET_ATTR, readPointParam, targetFor, withoutPointParam } from "@/lib/brenda-targets";

/** The event `pointAt` sends; the pointer listens for it. */
export const POINT_EVENT = "brenda:point";

/** Points at a target on this page (her chat's "Show me" when the page is already open). */
export function pointAt(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ key: string }>(POINT_EVENT, { detail: { key } }));
}

// ---- Pure helpers (tests/unit/brenda-pointer.test.ts) ---------------------------------------------------------------

export type Box = { left: number; top: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type Point = { x: number; y: number };

/** How long each step takes, in ms. Reduced motion: everything at once, held 4 seconds, gone at once. */
export type PointerPlan = { glide: number; draw: number; hold: number; fade: number; wait: number };
export function pointerPlan(reduced: boolean): PointerPlan {
  return reduced ? { glide: 0, draw: 0, hold: 4000, fade: 0, wait: 4000 } : { glide: 600, draw: 450, hold: 3000, fade: 400, wait: 4000 };
}

/** What the finder needs of an element (a DOM element fits). */
export type TargetLike = {
  getBoundingClientRect(): { width: number; height: number };
  closest(selector: string): unknown;
};
/** Anything that makes an element hidden from the person, itself or an ancestor. */
const HIDDEN = "[hidden], [inert], [aria-hidden='true']";
/**
 * Whether an element is on the page and shown: it has a size, and neither it nor an ancestor is hidden, inert or
 * aria-hidden (the drawer while closed). `style`, when given, is its computed style (visibility hidden counts as hidden).
 */
export function isShownTarget(el: TargetLike, style?: { visibility?: string; display?: string } | null): boolean {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  if (el.closest(HIDDEN)) return false;
  if (style && (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none")) return false;
  return true;
}

/** The selector for a target key (keys are `[a-z0-9-]`, so nothing needs escaping; anything else matches nothing). */
export function targetSelector(key: string): string | null {
  return /^[a-z0-9-]{1,64}$/.test(key) ? `[${TARGET_ATTR}="${key}"]` : null;
}

/** The first shown element marked with `key` (one page can carry the same key twice, such as two search buttons). */
export function findShownTarget<T extends TargetLike>(key: string, root: { querySelectorAll(selector: string): ArrayLike<T> }, styleOf?: (el: T) => { visibility?: string; display?: string } | null): T | null {
  const sel = targetSelector(key);
  if (!sel) return null;
  const all = Array.from(root.querySelectorAll(sel));
  return all.find((el) => isShownTarget(el, styleOf?.(el))) ?? null;
}

/** The catalogue's label for a key, never the model's words; null for a key the catalogue doesn't know. */
export function labelFor(key: string): string | null {
  return targetFor(key)?.label ?? null;
}

export const RING_PAD = 6;
/**
 * The ring round an element, 6px clear of it: an ellipse round a small control (both sides 56px or less), a rounded
 * rectangle round anything bigger. `box` is the ring's own box in viewport pixels.
 */
export type Ring = { shape: "ellipse" | "rect"; box: Box; radius: number };
export function ringFor(r: Box, pad = RING_PAD): Ring {
  if (r.width <= 56 && r.height <= 56) {
    // An ellipse that clears the element's corners: 1.2 × the half-sides plus the gap.
    const rx = (r.width / 2) * 1.2 + pad, ry = (r.height / 2) * 1.2 + pad;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { shape: "ellipse", box: { left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2 }, radius: 0 };
  }
  const box = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  return { shape: "rect", box, radius: Math.min(16, box.height / 2) };
}

/** Where her face starts: the centre of her floating button when it shows, else the top middle of the screen. */
export function startSpot(fab: Box | null, vp: Viewport, size: number): Point {
  if (fab && fab.width > 0) return { x: fab.left + fab.width / 2 - size / 2, y: fab.top + fab.height / 2 - size / 2 };
  return { x: vp.width / 2 - size / 2, y: 16 };
}

const EDGE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
/**
 * Where her face sits: just left of the ring, level with its middle; right of it when there is no room on the left;
 * over its top-left corner when there is room on neither side (a wide element). Always inside the screen.
 */
export function faceSpot(ring: Box, vp: Viewport, size: number): Point {
  const gap = 6;
  const y = clamp(ring.top + ring.height / 2 - size / 2, EDGE, vp.height - size - EDGE);
  if (ring.left - gap - size >= EDGE) return { x: ring.left - gap - size, y };
  if (ring.left + ring.width + gap + size <= vp.width - EDGE) return { x: ring.left + ring.width + gap, y };
  return { x: clamp(ring.left, EDGE, vp.width - size - EDGE), y: clamp(ring.top - size - gap, EDGE, vp.height - size - EDGE) };
}

/** Where the label's pill goes: centred under the ring, or over it when the screen ends first; inside the screen. */
export function pillSpot(ring: Box, vp: Viewport, width: number, height = 28): Point & { side: "below" | "above" } {
  const gap = 8;
  const below = ring.top + ring.height + gap;
  const side = below + height <= vp.height - EDGE || ring.top - gap - height < EDGE ? "below" : "above";
  const y = side === "below" ? Math.min(below, vp.height - height - EDGE) : ring.top - gap - height;
  const x = clamp(ring.left + ring.width / 2 - width / 2, EDGE, vp.width - width - EDGE);
  return { x, y, side };
}

/**
 * The key an `open` link asks her to point at (`?point=<key>`, a key the catalogue knows), and the path it opens; null
 * when it asks for none. Relative links are read against Boredroom's own origin (any origin will do: only the path and
 * query count).
 */
export function pointOfHref(href: string): { key: string; pathname: string } | null {
  let url: URL;
  try { url = new URL(href, "https://boredroom.invalid"); } catch { return null; }
  const key = readPointParam(url.search);
  return key ? { key, pathname: url.pathname } : null;
}

/** A rough width for the pill before it is measured (13px medium text, 12px each side). */
export const pillWidth = (label: string) => Math.ceil(label.length * 7.2) + 24;

// ---- The component -------------------------------------------------------------------------------------------------

const FACE = 34; // BrendaFace "lg"
type Phase = "glide" | "ring" | "fade";
type Showing = { id: number; key: string; label: string; el: HTMLElement; plan: PointerPlan; start: Point };

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
const sameBox = (a: Box, b: Box) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Takes `point` out of the address without a navigation (Next's router follows `replaceState`). */
function dropPointParam() {
  const { pathname, search, hash } = window.location;
  if (!new URLSearchParams(search).has(POINT_PARAM)) return;
  window.history.replaceState(null, "", withoutPointParam(pathname + search + hash));
}

export function BrendaPointer() {
  const pathname = usePathname();
  const [showing, setShowing] = useState<Showing | null>(null);
  const [phase, setPhase] = useState<Phase>("glide");
  // Where the element is, and the screen's size, as of the last frame.
  const [at, setAt] = useState<{ box: Box; vp: Viewport } | null>(null);
  const [arrived, setArrived] = useState(false);
  const [said, setSaid] = useState("");
  const [pillW, setPillW] = useState<number | null>(null);
  const run = useRef(0);
  const pill = useRef<HTMLSpanElement>(null);

  // Finding: one search at a time; a newer one (another key, another page) replaces it.
  useEffect(() => {
    let wait: ReturnType<typeof setInterval> | null = null;
    let first: ReturnType<typeof setTimeout> | null = null;
    const stopWaiting = () => { if (wait) clearInterval(wait); if (first) clearTimeout(first); wait = null; first = null; };
    const find = (key: string) => {
      const label = labelFor(key);
      stopWaiting();
      const mine = ++run.current;
      setShowing(null);
      if (!label) { dropPointParam(); return; }
      const plan = pointerPlan(reducedMotion());
      const began = Date.now();
      const look = () => {
        if (run.current !== mine) { stopWaiting(); return; }
        const el = findShownTarget<HTMLElement>(key, document, (e) => getComputedStyle(e));
        if (el) {
          stopWaiting();
          dropPointParam();
          const fab = findShownTarget<HTMLElement>("ask-assistant", document);
          const start = startSpot(fab && fab !== el ? boxOf(fab) : null, viewport(), FACE);
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: plan.glide ? "smooth" : "auto" });
          setPhase(plan.glide ? "glide" : "ring");
          setArrived(!plan.glide);
          setAt({ box: boxOf(el), vp: viewport() });
          setPillW(null);
          setSaid(`Here: ${label}`);
          setShowing({ id: mine, key, label, el, plan, start });
          return;
        }
        if (Date.now() - began >= plan.wait) {
          stopWaiting();
          dropPointParam();
          notify("I couldn't find that on this page.");
        }
      };
      // At once when it is already there, then every 100ms while the page finishes arriving.
      first = setTimeout(look, 0);
      wait = setInterval(look, 100);
    };
    const fromAddress = () => { const key = readPointParam(window.location.search); if (key) find(key); else if (new URLSearchParams(window.location.search).has(POINT_PARAM)) dropPointParam(); };
    const onPoint = (e: Event) => { const key = (e as CustomEvent<{ key?: unknown }>).detail?.key; if (typeof key === "string") find(key); };
    // The path changed (or the shell arrived): the address may ask her to point.
    first = setTimeout(fromAddress, 0);
    window.addEventListener("popstate", fromAddress);
    window.addEventListener(POINT_EVENT, onPoint);
    return () => {
      stopWaiting();
      window.removeEventListener("popstate", fromAddress);
      window.removeEventListener(POINT_EVENT, onPoint);
      // Leaving the page ends what she was pointing at there.
      run.current += 1;
      setShowing(null);
    };
  }, [pathname]);

  // Showing: the glide, the ring, the hold and the fade, on timers; following the element every frame; Escape or any
  // press ends it.
  useEffect(() => {
    if (!showing) return;
    const { plan, el, id } = showing;
    const end = () => { if (run.current === id) { run.current += 1; } setShowing((s) => (s && s.id === id ? null : s)); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let frame = requestAnimationFrame(function follow() {
      if (!el.isConnected) { end(); return; }
      const b = boxOf(el), v = viewport();
      setAt((cur) => (cur && sameBox(cur.box, b) && cur.vp.width === v.width && cur.vp.height === v.height ? cur : { box: b, vp: v }));
      frame = requestAnimationFrame(follow);
    });
    // The face starts on her button and glides once it has been drawn there.
    const arrive = requestAnimationFrame(() => setArrived(true));
    timers.push(setTimeout(() => setPhase("ring"), plan.glide));
    timers.push(setTimeout(() => setPhase("fade"), plan.glide + plan.draw + plan.hold));
    timers.push(setTimeout(end, plan.glide + plan.draw + plan.hold + plan.fade));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    const onPress = () => end();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(arrive);
      timers.forEach(clearTimeout);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [showing]);

  // The pill's real width, once drawn, so it stays inside the screen.
  useEffect(() => {
    if (!showing || phase === "glide") return;
    const w = pill.current?.offsetWidth;
    if (w && w !== pillW) { const t = requestAnimationFrame(() => setPillW(w)); return () => cancelAnimationFrame(t); }
  }, [showing, phase, pillW]);

  const vp = at?.vp ?? { width: 0, height: 0 };
  const ring = showing && at ? ringFor(at.box) : null;
  const face = showing ? (arrived && ring ? faceSpot(ring.box, vp, FACE) : showing.start) : null;
  const pillAt = showing && ring ? pillSpot(ring.box, vp, pillW ?? pillWidth(showing.label)) : null;
  const still = !!showing && showing.plan.glide === 0;

  return (
    <>
      {/* Always mounted, so "Here: …" is announced; focus never moves. */}
      <p role="status" aria-live="polite" className="sr-only">{showing ? said : ""}</p>
      {showing && ring && face && pillAt ? (
        <div aria-hidden className={`brenda-point${phase === "fade" ? " fading" : ""}${still ? " still" : ""}`} data-phase={phase}
          style={{ "--point-fade": `${showing.plan.fade}ms` } as CSSProperties}>
          <span className={`brenda-point-face${arrived && phase === "glide" ? " gliding" : ""}`}
            style={{ transform: `translate(${face.x}px, ${face.y}px)`, "--point-glide": `${showing.plan.glide}ms` } as CSSProperties}>
            <BrendaFace size="lg" mood={phase === "glide" ? null : "happy"} />
          </span>
          {phase !== "glide" ? (
            <>
              <svg className="brenda-point-ring" width={ring.box.width + 4} height={ring.box.height + 4}
                style={{ transform: `translate(${ring.box.left - 2}px, ${ring.box.top - 2}px)`, "--point-draw": `${showing.plan.draw}ms` } as CSSProperties}>
                {ring.shape === "ellipse"
                  ? <ellipse cx={ring.box.width / 2 + 2} cy={ring.box.height / 2 + 2} rx={ring.box.width / 2} ry={ring.box.height / 2} pathLength={1} />
                  : <rect x={2} y={2} width={ring.box.width} height={ring.box.height} rx={ring.radius} pathLength={1} />}
              </svg>
              <span ref={pill} className="brenda-point-pill" style={{ transform: `translate(${pillAt.x}px, ${pillAt.y}px)` }}>{showing.label}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
