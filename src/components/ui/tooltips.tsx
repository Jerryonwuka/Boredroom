"use client";

/**
 * Tooltips for icon-only controls (owner decision, 26 September 2026): hover or focus any button or link that has an
 * accessible name but no visible text and a small label pops up under it, so a plus, a pencil or a bell explains
 * itself. One listener for the whole page: nothing to wire per button. The name comes from `aria-label`, so the
 * tooltip and the screen reader always say the same thing; `data-tip` overrides it when the wording should differ.
 * Anything inside `[data-no-tip]` (a face with its own hover card) is left alone. `data-tip-side="right"` puts the
 * label beside the control instead of under it (the collapsed sidebar's dock).
 * v4: the one tooltip system in the app; the toast surface, r8, px8 py4, 12/16 medium (globals.css `.tip`).
 * A label that changes while it shows (a Listen button pressed from the keyboard becomes Stop, or turns back when the
 * reply ends) is read again at once, not only on the next hover or focus (review, 7 October 2026).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { liftToTopLayer, popoverHost } from "@/components/ui/top-layer";
import { cn } from "@/lib/utils";

const TARGET = "button, a, summary, [role='button'], [role='menuitem'], [role='tab']";
const OPEN_DELAY = 320;   // long enough that skimming the mouse over a row never flashes labels
const WARM_WINDOW = 400;  // moving from one icon to the next shows the label at once
const STAY = 3000;        // a label leaves on its own after three seconds (owner decision, 26 September 2026)

function labelFor(node: Element | null): { el: HTMLElement; text: string } | null {
  const el = node?.closest?.(TARGET) as HTMLElement | null;
  if (!el || el.closest("[data-no-tip]") || el.getAttribute("aria-expanded") === "true" || el.hasAttribute("disabled")) return null;
  const tip = el.dataset.tip;
  if (tip) return { el, text: tip };
  const label = el.getAttribute("aria-label");
  if (!label) return null;
  // Only controls with no visible words: a button that says "Save" needs no tooltip. A count bubble ("9", "99+") is not a word.
  if (!/^(\d{0,3}\+?)?$/.test((el.textContent ?? "").replace(/\s+/g, ""))) return null;
  return { el, text: label };
}

type Tip = { text: string; top: number; left: number; side: "below" | "above" | "right"; host: HTMLElement };

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    let stay: number | null = null;
    let warmUntil = 0;
    let current: HTMLElement | null = null;
    const clear = () => { if (timer) window.clearTimeout(timer); timer = null; if (stay) window.clearTimeout(stay); stay = null; };
    // The control's own label changing under a showing tooltip: the new words, or none if it no longer has a tooltip.
    const watch = new MutationObserver(() => {
      if (!current) return;
      const found = labelFor(current);
      if (!found || found.el !== current) { hide(); return; }
      setTip((t) => (t && t.text !== found.text ? { ...t, text: found.text } : t));
    });
    const follow = (el: HTMLElement | null) => {
      watch.disconnect();
      if (el) watch.observe(el, { attributes: true, attributeFilter: ["data-tip", "aria-label", "aria-expanded", "disabled"] });
    };
    const hide = () => { clear(); if (current) warmUntil = Date.now() + WARM_WINDOW; current = null; follow(null); setTip(null); };
    const place = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (el.dataset.tipSide === "right") setTip({ text, side: "right", top: r.top + r.height / 2, left: r.right + 10, host: popoverHost(el) });
      else { const up = r.bottom + 44 > window.innerHeight; setTip({ text, side: up ? "above" : "below", top: up ? r.top - 8 : r.bottom + 8, left: r.left + r.width / 2, host: popoverHost(el) }); }
      if (stay) window.clearTimeout(stay);
      stay = window.setTimeout(() => { stay = null; setTip(null); }, STAY);
    };
    const open = (e: Event) => {
      const found = labelFor(e.target as Element | null);
      if (!found) { if (current) hide(); return; }
      if (found.el === current) return;
      // Focus from a click must not bring the label back after the press hid it; only keyboard focus shows it.
      if (e.type === "focusin" && !found.el.matches(":focus-visible")) return;
      clear(); current = found.el; follow(current);
      const now = Date.now();
      if (now < warmUntil || e.type === "focusin") place(found.el, found.text);
      else timer = window.setTimeout(() => place(found.el, found.text), OPEN_DELAY);
    };
    const leave = (e: Event) => { if (current && (e.type !== "mouseout" || !current.contains((e as MouseEvent).relatedTarget as Node | null))) hide(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    const onDown = () => hide();
    document.addEventListener("mouseover", open);
    document.addEventListener("focusin", open);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clear();
      watch.disconnect();
      document.removeEventListener("mouseover", open);
      document.removeEventListener("focusin", open);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div ref={liftToTopLayer} role="tooltip" className={cn("top-pop tip", tip.side === "above" && "tip-up", tip.side === "right" && "tip-right")} style={{ top: tip.side === "above" ? undefined : tip.top, bottom: tip.side === "above" ? window.innerHeight - tip.top : undefined, left: tip.left }}>
      {tip.text}
    </div>,
    tip.host,
  );
}
