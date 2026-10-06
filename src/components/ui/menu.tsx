"use client";

/**
 * Menus and popovers, v4 (spec §7 "Menus/popovers"): the popover surface (#2E2E2E dark, white with a shadow light),
 * r12, p4, the toast shadow. Menu items are h32 px8 r8, 14/20 medium in the foreground, a 16px icon in the secondary
 * grey, fill-1 on hover and keyboard focus, a kbd hint on the right; separators are 1px hairlines.
 *
 * Both open from a `trigger` element (a Button or IconButton; it gets aria-haspopup, aria-expanded and aria-controls),
 * sit under it (above when there is no room), aligned to its start, end or centre, and are lifted into the browser's
 * top layer so a sheet or a scroll box never clips them. They close on Escape (focus returns to the trigger), on a
 * click outside and, for menus, after an item is chosen.
 * Menu keyboard: the first item takes focus on open; ↑ ↓ move, Home/End jump, Tab closes.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { liftToTopLayer, popoverHost } from "@/components/ui/top-layer";

type Align = "start" | "end" | "center";
type TriggerProps = React.HTMLAttributes<HTMLElement> & { "aria-expanded"?: boolean; "aria-haspopup"?: React.AriaAttributes["aria-haspopup"]; "aria-controls"?: string };

/** Places the pop-up under its anchor (above when there is no room), written straight to its style before paint. */
function useFloating(open: boolean, anchor: React.RefObject<HTMLElement | null>, pop: React.RefObject<HTMLElement | null>, align: Align, gap = 6) {
  const place = React.useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    const el = pop.current;
    if (!r || !el) return;
    const up = r.bottom + 280 > window.innerHeight && r.top > 280;
    const left = align === "end" ? "auto" : `${align === "center" ? Math.min(Math.max(8, r.left + r.width / 2), window.innerWidth - 8) : Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`;
    const set: [string, string][] = [
      ["position", "fixed"], ["z-index", "var(--z-toast)"],
      ["top", up ? "auto" : `${r.bottom + gap}px`], ["bottom", up ? `${window.innerHeight - r.top + gap}px` : "auto"],
      ["left", left], ["right", align === "end" ? `${Math.max(8, window.innerWidth - r.right)}px` : "auto"],
      ["translate", align === "center" ? "-50% 0" : "none"],
    ];
    for (const [k, v] of set) el.style.setProperty(k, v);
  }, [anchor, pop, align, gap]);
  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
}

function useDismiss(open: boolean, close: (refocus: boolean) => void, refs: React.RefObject<HTMLElement | null>[]) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!refs.some((r) => r.current?.contains(t))) close(false); };
    // preventDefault keeps an enclosing <dialog> open: Escape closes the pop-up first.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close, refs]);
}

function useOpenState(open: boolean | undefined, onOpenChange: ((o: boolean) => void) | undefined) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const set = React.useCallback((o: boolean) => { if (open === undefined) setInner(o); onOpenChange?.(o); }, [open, onOpenChange]);
  return [isOpen, set] as const;
}

function Floating({ open, anchor, id, role, label, align, className, style, children, popRef, onKeyDown }: {
  open: boolean; anchor: React.RefObject<HTMLElement | null>; id: string; role: "menu" | "dialog"; label?: string; align: Align; className?: string;
  style?: React.CSSProperties; children: React.ReactNode; popRef: React.RefObject<HTMLDivElement | null>; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  useFloating(open, anchor, popRef, align);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={(n) => { popRef.current = n; liftToTopLayer(n); }} id={id} role={role} aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
      className={cn("top-pop popover-surface p-1 text-left outline-none", className)}
      style={{ position: "fixed", animation: "pop-in var(--duration-menu) var(--ease-out) both", ...style }}>
      {children}
    </div>,
    popoverHost(anchor.current),
  );
}

function Trigger({ trigger, open, id, haspopup, onToggle, anchor }: { trigger: React.ReactElement<TriggerProps>; open: boolean; id: string; haspopup: "menu" | "dialog"; onToggle: () => void; anchor: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <span ref={anchor} className="inline-flex" data-pop-trigger={id}>
      {React.cloneElement(trigger, {
        "aria-haspopup": haspopup, "aria-expanded": open, "aria-controls": open ? id : undefined,
        onClick: (e: React.MouseEvent<HTMLElement>) => { trigger.props.onClick?.(e); if (!e.defaultPrevented) onToggle(); },
      })}
    </span>
  );
}

/** Returns focus to the trigger of pop-up `id` (found through its wrapper, so nothing reads a ref while rendering). */
function focusTrigger(id: string) {
  document.querySelector<HTMLElement>(`[data-pop-trigger="${CSS.escape(id)}"]`)?.querySelector<HTMLElement>("button, a, [tabindex]")?.focus();
}

// ---- Popover ------------------------------------------------------------------------------------------------------

/** What Tab stops on inside a popover. */
const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Popover({ trigger, children, align = "start", className, label, open, onOpenChange, width }: {
  trigger: React.ReactElement<TriggerProps>; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: Align; className?: string;
  /** The popover's accessible name. */ label?: string; open?: boolean; onOpenChange?: (open: boolean) => void; /** px or any CSS width. */ width?: number | string;
}) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  const id = `${React.useId()}-popover`;
  const close = React.useCallback((refocus: boolean) => { setOpen(false); if (refocus) focusTrigger(id); }, [setOpen, id]);
  const refs = React.useMemo(() => [anchor, pop] as React.RefObject<HTMLElement | null>[], []);
  useDismiss(isOpen, close, refs);
  React.useEffect(() => {
    if (!isOpen) return;
    // Focus the first field or control inside, or the popover itself.
    requestAnimationFrame(() => (pop.current?.querySelector<HTMLElement>("input, textarea, select, button, a[href], [tabindex]:not([tabindex='-1'])") ?? pop.current)?.focus());
  }, [isOpen]);
  // The popover sits at the end of the page, not beside its button, so the Tab order is joined up by hand: Tab from its
  // last control closes it and carries on from the button; Shift+Tab from its first goes back to the button.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const list = Array.from(pop.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? []);
    const at = document.activeElement;
    const edge = e.shiftKey ? at === list[0] || at === pop.current : at === list[list.length - 1] || !list.length;
    if (!edge) return;
    if (e.shiftKey) e.preventDefault();
    close(true);
  };
  return (
    <>
      <Trigger trigger={trigger} open={isOpen} id={id} haspopup="dialog" onToggle={() => setOpen(!isOpen)} anchor={anchor} />
      <Floating open={isOpen} anchor={anchor} id={id} role="dialog" label={label} align={align} popRef={pop} onKeyDown={onKeyDown} className={cn("p-3", className)} style={width !== undefined ? { width } : undefined}>
        {typeof children === "function" ? children(() => close(true)) : children}
      </Floating>
    </>
  );
}

// ---- Menu ---------------------------------------------------------------------------------------------------------

const ITEM = "[role^=menuitem]:not([aria-disabled=true])";
const MenuContext = React.createContext<{ close: (refocus: boolean) => void }>({ close: () => {} });

export function Menu({ trigger, children, align = "start", className, label, open, onOpenChange }: {
  trigger: React.ReactElement<TriggerProps>; children: React.ReactNode; align?: Align; className?: string;
  /** The menu's accessible name ("Task actions"). */ label?: string; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  const id = `${React.useId()}-menu`;
  const close = React.useCallback((refocus: boolean) => { setOpen(false); if (refocus) focusTrigger(id); }, [setOpen, id]);
  const refs = React.useMemo(() => [anchor, pop] as React.RefObject<HTMLElement | null>[], []);
  useDismiss(isOpen, close, refs);
  const items = () => Array.from(pop.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
  React.useEffect(() => { if (isOpen) requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(ITEM)?.focus()); }, [isOpen]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = list.length; if (!n) return; list[(at + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    // The menu sits at the end of the page, not beside its button: Tab closes it and carries on from the button.
    else if (e.key === "Tab") close(true);
  };
  return (
    <MenuContext.Provider value={{ close }}>
      <Trigger trigger={trigger} open={isOpen} id={id} haspopup="menu" onToggle={() => setOpen(!isOpen)} anchor={anchor} />
      <Floating open={isOpen} anchor={anchor} id={id} role="menu" label={label} align={align} popRef={pop} onKeyDown={onKeyDown} className={cn("min-w-48 max-w-[min(20rem,calc(100vw-16px))]", className)}>
        {children}
      </Floating>
    </MenuContext.Provider>
  );
}

export function MenuItem({ children, onSelect, href, icon, kbd, tone, disabled = false, checked, closeOnSelect = true, className }: {
  children: React.ReactNode; onSelect?: () => void; href?: string; icon?: React.ReactNode; kbd?: React.ReactNode; tone?: "danger";
  disabled?: boolean; /** A checkable item (menuitemcheckbox): shows a tick when true. */ checked?: boolean; closeOnSelect?: boolean; className?: string;
}) {
  const { close } = React.useContext(MenuContext);
  const role = checked === undefined ? "menuitem" : "menuitemcheckbox";
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="!size-4 !text-foreground"><path d="M20 6 9 17l-5-5" /></svg> : null}
      {kbd ? <span className="kbd ml-auto">{kbd}</span> : null}
    </>
  );
  const common = { role, tabIndex: -1, "aria-disabled": disabled || undefined, "aria-checked": checked, "data-tone": tone, className: cn("menu-item", className) };
  if (href && !disabled) return <Link href={href} {...common} onClick={() => close(false)}>{body}</Link>;
  return (
    <button type="button" {...common} onClick={() => { if (disabled) return; onSelect?.(); if (closeOnSelect) close(true); }}>{body}</button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="menu-separator" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div role="presentation" className="menu-label">{children}</div>;
}
