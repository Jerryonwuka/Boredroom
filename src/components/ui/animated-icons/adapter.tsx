"use client";

/**
 * Animated icons, the adapter (owner request, 7 October 2026: "For our icons, I want our icons to be animated icons").
 *
 * The icons are lucide-animated's (https://lucide-animated.com, MIT, notice in ./LICENSE), brought in one file per icon
 * we use and redrawn with the exact geometry of the lucide-react version we ship, so at rest each one is the same
 * lucide icon as before: the same 24px grid, 2px round stroke, `currentColor` and the `lucide lucide-{name}` classes,
 * so every size, colour and accent rule in the app (`[&>svg]:size-[18px]`, the active nav icon's `text-accent`) still
 * applies. Only the motion is theirs. Where they had none for an icon we use (or Brenda's face), ours are written in the
 * same idiom and marked so in their file.
 *
 * What we changed in how they play (docs/design-system.md, "Animated icons"):
 * - **The parent control drives the icon**, not the icon itself: it animates while its link, button, tile, tab, menu
 *   item or highlighted option is hovered (mouse or pen, not a tap) or has keyboard focus (`:focus-visible`), and goes
 *   back to rest when that ends. An icon outside any control never moves (a `data-icon-trigger` ancestor opts a quiet
 *   area in, as `EmptyState` does).
 * - **Arrival:** when its control becomes the current page (`aria-current`), the icon plays once (on first paint too),
 *   then rests. Brenda's glyph has its own arrival (a happy squint).
 * - **Never loops:** the few lucide-animated icons that repeated forever play their movement once.
 * - **Reduced motion:** with `prefers-reduced-motion: reduce` nothing plays at all; the icon stays as drawn.
 *
 * `createAnimatedIcon` builds an icon from its drawing: the svg carries `initial="normal"` and `animate={controls}`, so
 * the animated parts only need `variants` ("normal" at rest, "animate" on hover and focus, optionally "arrive"); they
 * inherit the labels. Use the icons through `./index` (`AnimatedBell`, …, `withAnimatedIcons`, `animatedTwin`).
 */
import * as React from "react";
import { motion, useAnimationControls, type LegacyAnimationControls, type SVGMotionProps, type Transition, type Variants } from "motion/react";

/** What counts as an icon's control: the nearest of these around it. */
export const ICON_TRIGGER = [
  "a[href]", "button", "summary", "label", "[role=button]", "[role=link]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
  "[role=tab]", "[role=option]", "[role=radio]", "[role=checkbox]", "[role=switch]", "[data-icon-trigger]",
].join(", ");

const REDUCED = "(prefers-reduced-motion: reduce)";

export type AnimatedIconProps = Omit<SVGMotionProps<SVGSVGElement>, "ref" | "children" | "animate" | "initial" | "variants" | "transition" | "custom" | "exit"> & {
  /** Width and height, as lucide's `size` (24 by default; a class such as `size-4` usually sets it). */
  size?: number | string;
  /** As lucide's: keeps the stroke's on-screen width whatever the size. */
  absoluteStrokeWidth?: boolean;
};

export type AnimatedIcon = React.ForwardRefExoticComponent<AnimatedIconProps & React.RefAttributes<SVGSVGElement>>;

export type AnimatedIconSpec = {
  /** The lucide name, for the `lucide-{name}` class (a custom one names itself). */
  name: string;
  /** The drawing on lucide's 24px grid; moving parts are motion elements with `variants`. */
  children: React.ReactNode;
  /** Variants for the whole drawing ("normal", "animate", and "arrive" when it has its own). */
  variants?: Variants;
  transition?: Transition;
  /** Lets a moving part leave the 24px box for a moment (Send's trail). */
  overflow?: boolean;
  /** The variant played on arrival when it is not "animate". */
  arrive?: string;
};

const isOn = (v: string | null) => v !== null && v !== "false";
/** The control is the current page (a nav item, a sub-nav item, a link tab). */
const isCurrent = (el: Element) => isOn(el.getAttribute("aria-current"));
/** The control is the highlighted option of a list whose focus stays in its field (the search palette). */
const isPicked = (el: Element) => el.getAttribute("role") === "option" && el.getAttribute("aria-selected") === "true";
function focusVisible(el: EventTarget | null) {
  try { return el instanceof Element && el.matches(":focus-visible"); } catch { return false; }
}

/**
 * Wires an icon to its parent control: the controls it returns play "animate" while the control is hovered, focused
 * from the keyboard or highlighted, rest ("normal") when that ends, and play `arrive` once when the control becomes
 * the current page. Nothing plays under reduced motion.
 */
export function useIconTrigger(svg: React.RefObject<SVGSVGElement | null>, arrive = "animate"): LegacyAnimationControls {
  const controls = useAnimationControls();
  React.useEffect(() => {
    const trigger = svg.current?.parentElement?.closest<HTMLElement>(ICON_TRIGGER);
    if (!trigger) return;
    const still = () => window.matchMedia(REDUCED).matches;
    let live = true, hover = false, focus = false;
    // A highlighted option at mount (the palette's first result) rests: only a change of highlight plays.
    let picked = isPicked(trigger), on = picked, current = isCurrent(trigger);
    const sync = () => {
      const next = hover || focus || picked;
      if (next === on) return;
      on = next;
      if (on) { if (!still()) void controls.start("animate"); } else void controls.start("normal");
    };
    const pulse = () => {
      if (on || still()) return;
      void controls.start(arrive).then(() => { if (live && !on) void controls.start("normal"); });
    };
    const enter = (e: PointerEvent) => { if (e.pointerType !== "touch") { hover = true; sync(); } };
    const leave = () => { hover = false; sync(); };
    const focusIn = (e: FocusEvent) => { focus = focusVisible(e.target); sync(); };
    const focusOut = (e: FocusEvent) => { if (!(e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget))) { focus = false; sync(); } };
    const watch = new MutationObserver(() => {
      const nowPicked = isPicked(trigger);
      if (nowPicked !== picked) { picked = nowPicked; sync(); }
      const nowCurrent = isCurrent(trigger);
      if (nowCurrent && !current) pulse();
      current = nowCurrent;
    });
    trigger.addEventListener("pointerenter", enter);
    trigger.addEventListener("pointerleave", leave);
    trigger.addEventListener("focusin", focusIn);
    trigger.addEventListener("focusout", focusOut);
    watch.observe(trigger, { attributes: true, attributeFilter: ["aria-current", "aria-selected"] });
    if (current) pulse();
    return () => {
      live = false;
      watch.disconnect();
      trigger.removeEventListener("pointerenter", enter);
      trigger.removeEventListener("pointerleave", leave);
      trigger.removeEventListener("focusin", focusIn);
      trigger.removeEventListener("focusout", focusOut);
    };
  }, [svg, controls, arrive]);
  return controls;
}

/** lucide's rule: an icon with no accessible name of its own is hidden from screen readers. */
function hasA11yProp(props: object) {
  for (const key in props) if (key.startsWith("aria-") || key === "role" || key === "title") return true;
  return false;
}

/** Builds an animated icon that renders like the lucide icon it replaces (same props, same svg, same classes). */
export function createAnimatedIcon(spec: AnimatedIconSpec): AnimatedIcon {
  const Icon = React.forwardRef<SVGSVGElement, AnimatedIconProps>(function AnimatedIcon({ size = 24, strokeWidth = 2, absoluteStrokeWidth = false, className, style, ...rest }, ref) {
    const svg = React.useRef<SVGSVGElement>(null);
    React.useImperativeHandle(ref, () => svg.current as SVGSVGElement, []);
    const controls = useIconTrigger(svg, spec.arrive);
    const stroke = absoluteStrokeWidth && typeof size === "number" ? (Number(strokeWidth) * 24) / size : strokeWidth;
    return (
      <motion.svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden={hasA11yProp(rest) ? undefined : true}
        className={["lucide", `lucide-${spec.name}`, className].filter(Boolean).join(" ")}
        style={spec.overflow ? { overflow: "visible", ...style } : style}
        {...rest}
        initial="normal" animate={controls} variants={spec.variants} transition={spec.transition}>
        {spec.children}
      </motion.svg>
    );
  });
  Icon.displayName = `Animated(${spec.name})`;
  return Icon;
}
