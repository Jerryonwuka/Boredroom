"use client";

/**
 * The landing page header as a notch (owner request, 10 October 2026: "make our nav bar a notch, just like on
 * supaste.com, it minimises and maximises on hover"). A black island hung from the top centre with flared shoulders,
 * the way Brenda desktop sits in a Mac's notch; the styles and the reasons are in site-nav.module.css.
 * - From 1152px up it is open at the top of the page: the logo, the section links (14/20 medium, secondary, a fill-1
 *   plate on hover), the theme toggle and the call to action, a white primary (the hero carries the page's one orange
 *   button). Once the page scrolls it folds to a small notch: the "B." mark and, inside a linked section, that
 *   section's name. A mouse over it opens it (and it lingers 140ms after the pointer leaves), keyboard focus inside it
 *   opens it, so every link stays reachable by Tab, and on a touch screen the first tap on the folded notch opens it
 *   (a tap outside, Escape or a little scrolling folds it again).
 * - Below 1152px it is a bar at the top of the page (the logo, the call to action from 380px, the menu button) and, once
 *   the page scrolls, a compact notch: the "B." mark and the menu button (review fix, 10 October 2026). The menu grows
 *   the notch back out and down into a sheet over the page (it never pushes the page, so a link that scrolls lands
 *   where it aimed); a link, a tap outside or Tab moving focus out of it closes it, and Escape closes it and gives
 *   focus back to the menu button.
 * - Escape folds a notch opened by hover or focus until the next hover or focus move (review fix, 10 October 2026:
 *   content that appears on hover must be dismissible). The whole notch is one `nav` landmark at every width.
 * - Without JavaScript it stays open. Under reduced motion every state is instant.
 * The call to action is unchanged: signed in it opens the workspace; in waitlist mode it goes to the form and there is
 * no Log in link (owner decision, 25 September 2026); in maintenance (review fix, 10 October 2026) sign-ups are off, so
 * it is Log in; otherwise Log in (ghost) and Get started.
 *
 * The site's sections (owner request, 17 October 2026: SEO analysis, Section B): the links are the seven section pages,
 * in this order, on every public page (lib/marketing/nav.ts): Features, Solutions, Use cases, Compare, Free tools, Blog,
 * Pricing. The link of the section you are in carries `aria-current` and the hover plate. Folded, the notch names where
 * you are: on the home page the section in the middle of the screen (How it works, Calls, Fairness, Pricing, FAQ, as
 * before), elsewhere the current section page. The waitlist link reaches the form at the foot of every public page.
 *
 * Mega-menus (owner feedback, 17 October 2026: pages v2: "dropdown mega-menus like Worktivity's … opening on hover"):
 * Features, Solutions, Use cases, Compare and Free tools each open a panel of their pages (lib/marketing/menus.ts: the
 * page's icon, name and one line, the hub's summary, "See all …"); Blog and Pricing stay plain links. Each is the
 * disclosure pattern with a top-level link (not role="menu"): the label stays the link to the hub (so the server HTML
 * keeps exactly the seven links, twice), and a chevron button beside it (`aria-expanded`, `aria-controls`) toggles the
 * panel. In the open notch the notch grows down into the panel (site-nav.module.css):
 * - Mouse: resting 120ms on an item opens its panel (also when another is open, so a pointer crossing a neighbour on its
 *   way down does not switch it); leaving the notch, or resting on something without a menu, closes it after 200ms
 *   (coming back in time keeps it). The panel is inside the item, so moving onto it never closes it.
 * - Click: the label follows its link; the chevron toggles (pins a hover-opened panel first). Touch: the first tap on a
 *   label opens its panel, a tap on the open panel's label follows the link, a tap outside closes it.
 * - Keyboard: Tab runs label → chevron → (open) the panel's links → next label; Enter or Space on the chevron toggles;
 *   ArrowDown on the label or chevron opens and moves to the first link; ArrowUp/ArrowDown/Home/End move inside the
 *   panel; Escape closes it and returns focus to its chevron (a second Escape folds the notch, as before); focus leaving
 *   the item closes it.
 * - A panel's content mounts on its first open and stays; closed panels are inert and hidden. Folding the notch closes
 *   the panel at once.
 * Below 1152px the sheet's section rows are split: the hub link and a 44px chevron that expands the section's pages
 * under it (content mounted on first expand).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IconButton } from "@/components/ui/icon-button";
import { buttonVariants } from "@/components/ui/button";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { PageIcon } from "@/components/marketing/page-icon";
import { NAV, navItemFor } from "@/lib/marketing/nav";
import type { NavMenu } from "@/lib/marketing/menus";
import { cn } from "@/lib/utils";
import s from "./site-nav.module.css";

/** The home page's sections the folded notch names while they are in the middle of the screen. */
const HOME_SECTIONS = [
  { name: "How it works", id: "how" },
  { name: "Calls", id: "calls" },
  { name: "Fairness", id: "fair" },
  { name: "Pricing", id: "pricing" },
  { name: "FAQ", id: "faq" },
];

/** The logo's drawn height and its two widths (LogoArt's artwork is 519×58, the mark 72×58). */
const LOGO_H = 16;
const LOGO_VARS = { "--logo-h": `${LOGO_H}px`, "--logo-full": `${Math.round((519 / 58) * LOGO_H)}px`, "--logo-mark": `${Math.round((72 / 58) * LOGO_H)}px` } as CSSProperties;
/** How far the page scrolls before the notch folds. */
const FOLD_AT = 64;
/** A notch opened by a tap folds again after this much scrolling. */
const TAP_SCROLL = 48;
const LINGER_MS = 140;
/** Mega-menu hover intent: resting this long opens a panel; leaving closes it after CLOSE_MS. */
const OPEN_MS = 120;
const CLOSE_MS = 200;
/**
 * Where the open notch with every link takes over from the bar and its menu (site-nav.module.css). 1152px, not 1024px
 * (owner feedback, 17 October 2026: pages v2): the menu chevrons add about 80px, and the open notch (about 984px in
 * waitlist mode, 1030px live) no longer fits the 992px a 1024px screen leaves.
 */
const WIDE = "(min-width: 1152px)";

/** The id of a section's desktop panel and its phone group. */
const megaId = (hub: string) => `mega-${hub.slice(1)}`;
const groupId = (hub: string) => `m-${hub.slice(1)}`;

export function SiteNavClient({ signedIn, waitlist = false, maintenance = false, menus = [] }: { signedIn: boolean; waitlist?: boolean; maintenance?: boolean; menus?: readonly NavMenu[] }) {
  const [menu, setMenu] = useState(false);
  /** At the top of the page (true on the server, so without JavaScript the notch stays open). */
  const [atTop, setAtTop] = useState(true);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  /** Opened by a tap on a touch screen; holds the scroll position it opened at. */
  const [tapped, setTapped] = useState<number | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [labelText, setLabelText] = useState("");
  const [labelW, setLabelW] = useState(0);
  /** Escape folded a hover- or focus-opened notch; the next hover or focus move clears it. */
  const [dismissed, setDismissed] = useState(false);

  /** The open mega-menu (its hub path), how it opened, the side it slid in from, and the panels mounted so far. */
  const [mega, setMega] = useState<string | null>(null);
  const [megaBy, setMegaBy] = useState<"hover" | "click" | "key">("hover");
  const [from, setFrom] = useState<"left" | "right" | null>(null);
  const [mounted, setMounted] = useState<readonly string[]>([]);
  const [megaH, setMegaH] = useState(0);
  /** The phone sheet's expanded sections, and those ever expanded (their content stays mounted). */
  const [groups, setGroups] = useState<readonly string[]>([]);
  const [groupsMounted, setGroupsMounted] = useState<readonly string[]>([]);

  const toggle = useRef<HTMLButtonElement>(null);
  const notch = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const labelInner = useRef<HTMLSpanElement>(null);
  const leave = useRef<number | undefined>(undefined);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const panels = useRef(new Map<string, HTMLDivElement>());
  const chevrons = useRef(new Map<string, HTMLButtonElement>());
  const items = useRef(new Map<string, HTMLLIElement>());
  /** ArrowDown opened a panel: focus its first link once it is rendered. */
  const focusFirst = useRef<string | null>(null);
  const pointerType = useRef("mouse");
  const pathname = usePathname();
  const home = pathname === "/";
  /** The section page you are on or under (none on the home page, the auth pages …). */
  const current = navItemFor(pathname);
  /** What the folded notch names: the home page's section in view, or the current section page. */
  const named = home ? section : current?.label ?? null;
  const namedText = home ? labelText : current?.label ?? "";
  const menuByHub = new Map(menus.map((m) => [m.hub as string, m]));

  const open = atTop || (!dismissed && (hover || focus || tapped !== null));
  /**
   * Just folded: the section name waits for the groups to fold before it slides in, so the notch never grows wider
   * than its open width on the way down (review fix, 10 October 2026). Set as it folds (state from the last render),
   * cleared once the fold is done, so a later change of section moves the name at once. Folding also closes the open
   * mega-menu at once (panels exist only in the open notch).
   */
  const [prevOpen, setPrevOpen] = useState(open);
  const [justFolded, setJustFolded] = useState(false);
  if (prevOpen !== open) { setPrevOpen(open); setJustFolded(!open); if (!open) setMega(null); }
  useEffect(() => {
    if (!justFolded) return;
    const t = window.setTimeout(() => setJustFolded(false), 900);
    return () => window.clearTimeout(t);
  }, [justFolded]);

  // Folded once the page has scrolled past FOLD_AT.
  useEffect(() => {
    const el = top.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAtTop(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // On the home page, the name of the section in the middle of the screen, shown beside the mark while folded.
  useEffect(() => {
    if (!home) return;
    const els = HOME_SECTIONS.map((l) => document.getElementById(l.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const inView = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) inView.add(e.target.id); else inView.delete(e.target.id); }
      const hit = HOME_SECTIONS.find((l) => inView.has(l.id));
      setSection(hit ? hit.name : null);
      // The label keeps the last name while it folds away, so it does not empty before it closes.
      if (hit) setLabelText(hit.name);
    }, { rootMargin: "-45% 0px -50% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [home]);
  useLayoutEffect(() => { setLabelW(labelInner.current?.offsetWidth ?? 0); }, [namedText]);

  // A tap-opened notch folds on a tap outside it, on Escape, or after a little scrolling.
  useEffect(() => {
    if (tapped === null) return;
    const onDown = (e: globalThis.PointerEvent) => { if (!notch.current?.contains(e.target as Node)) setTapped(null); };
    const onScroll = () => { if (Math.abs(window.scrollY - tapped) > TAP_SCROLL) setTapped(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTapped(null); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("scroll", onScroll); window.removeEventListener("keydown", onKey); };
  }, [tapped]);

  // The phone menu: Escape closes it (focus back to its button), a tap outside closes it, and it closes at 1152px up.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); toggle.current?.focus(); } };
    const onDown = (e: globalThis.PointerEvent) => { if (!notch.current?.contains(e.target as Node)) setMenu(false); };
    const wide = window.matchMedia(WIDE);
    const onWide = () => { if (wide.matches) setMenu(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    wide.addEventListener("change", onWide);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); wide.removeEventListener("change", onWide); };
  }, [menu]);

  // Escape folds a notch that hover or keyboard focus opened (it stays folded until the next hover or focus move).
  useEffect(() => {
    if (atTop || menu || !(hover || focus)) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDismissed(true); setTapped(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atTop, menu, hover, focus]);

  // An open mega-menu: Escape closes it first (in the capture phase, so the notch does not fold on the same key) and
  // gives focus back to its chevron when focus was inside it; a tap or click outside the notch closes it; it closes
  // when the screen narrows below 1152px.
  useEffect(() => {
    if (!mega) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      const inside = items.current.get(mega)?.contains(document.activeElement);
      setMega(null);
      if (inside) chevrons.current.get(mega)?.focus();
    };
    const onDown = (e: globalThis.PointerEvent) => { if (!notch.current?.contains(e.target as Node)) setMega(null); };
    const wide = window.matchMedia(WIDE);
    const onWide = () => { if (!wide.matches) setMega(null); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    wide.addEventListener("change", onWide);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown); wide.removeEventListener("change", onWide); };
  }, [mega]);

  // The backdrop follows the open panel's height, so moving between menus morphs one shape.
  useLayoutEffect(() => {
    const el = mega ? panels.current.get(mega) : undefined;
    if (!el) return;
    const measure = () => setMegaH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mega, mounted]);

  // ArrowDown opened a panel: its first link takes focus once the panel is there.
  useEffect(() => {
    if (!mega || focusFirst.current !== mega) return;
    focusFirst.current = null;
    panels.current.get(mega)?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
  }, [mega, mounted]);

  useEffect(() => () => { window.clearTimeout(leave.current); window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); }, []);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMega(null), CLOSE_MS);
  };
  /** Opens `hub`'s panel (mounting it the first time), sliding in from the side of the one it replaces. */
  const openMega = (hub: string, by: "hover" | "click" | "key") => {
    cancelClose();
    window.clearTimeout(openTimer.current);
    if (!mounted.includes(hub)) setMounted((m) => [...m, hub]);
    if (mega !== hub) {
      const order = (h: string) => menus.findIndex((m) => m.hub === h);
      setFrom(mega ? (order(hub) > order(mega) ? "right" : "left") : null);
      setMega(hub);
    }
    setMegaBy(by);
  };

  const onPointerEnter = (e: PointerEvent) => {
    pointerType.current = e.pointerType;
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(leave.current);
    setHover(true);
    setDismissed(false);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(leave.current);
    leave.current = window.setTimeout(() => setHover(false), LINGER_MS);
    if (mega) scheduleClose(); else window.clearTimeout(openTimer.current);
  };
  // Resting on anything without a menu (the logo, Blog, Pricing, the tools, the gaps) closes the open panel after 200ms.
  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if ((e.target as HTMLElement).closest("[data-mega-item]")) return;
    window.clearTimeout(openTimer.current);
    if (mega) scheduleClose();
  };
  const onPointerDown = (e: PointerEvent) => { pointerType.current = e.pointerType; };
  // On a touch screen at 1152px up, the first tap on the folded notch opens it instead of following what it landed on.
  const onClickCapture = (e: MouseEvent) => {
    if (open || pointerType.current === "mouse" || !window.matchMedia(WIDE).matches) return;
    e.preventDefault();
    e.stopPropagation();
    setTapped(window.scrollY);
    setDismissed(false);
  };
  // Keyboard focus opens it; a mouse click on a link does not latch it open.
  const onFocus = (e: FocusEvent) => { setDismissed(false); if ((e.target as HTMLElement).matches(":focus-visible")) setFocus(true); };
  // Focus leaving the notch: it folds, and the phone menu closes, so Tab never lands on the page under the sheet.
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (notch.current?.contains(to)) return;
    setFocus(false);
    if (to) setMenu(false);
  };

  // A menu item: hover intent, the touch first tap, the keyboard.
  const itemPointerEnter = (hub: string) => (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    window.clearTimeout(openTimer.current);
    if (mega === hub) return;
    openTimer.current = window.setTimeout(() => openMega(hub, "hover"), OPEN_MS);
  };
  const itemPointerLeave = (e: PointerEvent) => { if (e.pointerType === "mouse") window.clearTimeout(openTimer.current); };
  const labelClick = (hub: string) => (e: MouseEvent) => {
    // A tap (not a mouse click, not Enter) on the label of a closed panel opens the panel; on the open one it follows the link.
    if (e.detail === 0 || pointerType.current === "mouse" || mega === hub || !window.matchMedia(WIDE).matches) return;
    e.preventDefault();
    openMega(hub, "click");
  };
  const chevronClick = (hub: string) => () => {
    if (mega === hub && megaBy !== "hover") { setMega(null); return; }
    openMega(hub, "click");
  };
  const arrowOpen = (hub: string) => (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    focusFirst.current = hub;
    openMega(hub, "key");
    if (mega === hub) panels.current.get(hub)?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
  };
  const panelKeys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]")];
    if (!links.length) return;
    e.preventDefault();
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : e.key === "ArrowDown" ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1);
    links[next]?.focus();
  };
  // Focus leaving a menu item (Tab past its last link, or out of the notch) closes its panel.
  const itemBlur = (hub: string) => (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (items.current.get(hub)?.contains(to)) return;
    if (mega === hub && megaBy !== "hover") setMega(null);
  };

  const toggleGroup = (hub: string) => {
    if (!groupsMounted.includes(hub)) setGroupsMounted((g) => [...g, hub]);
    setGroups((g) => (g.includes(hub) ? g.filter((x) => x !== hub) : [...g, hub]));
  };

  const primary = (extra?: string) => cn(buttonVariants({ variant: "primary", size: "sm" }), extra);
  const cta = (extra?: string) => signedIn ? <Link href="/app" className={primary(extra)}>Open workspace</Link>
    : waitlist ? <WaitlistLink className={primary(extra)}>Join the waitlist</WaitlistLink>
    : maintenance ? <Link href="/login" className={primary(extra)}>Log in</Link>
    : <Link href="/signup" className={primary(extra)}>Get started</Link>;
  const login = (extra?: string) => (!signedIn && !waitlist && !maintenance ? <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), extra)}>Log in</Link> : null);
  const showLabel = !!named && !open;
  const hasLogin = !signedIn && !waitlist && !maintenance;
  /** `aria-current`: "page" on the section page itself, "true" on a page inside the section. */
  const ariaCurrent = (path: string) => (pathname === path ? "page" as const : current?.path === path ? "true" as const : undefined);
  const LINK = "inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground aria-[current]:bg-fill-1 aria-[current]:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:h-10";

  return (
    <>
    <div ref={top} aria-hidden className="pointer-events-none absolute left-0 top-0 w-px" style={{ height: FOLD_AT }} />
    <header className={s.shell}>
      <nav ref={notch} aria-label="Main" data-theme="dark" data-state={open ? "open" : "closed"} data-menu={menu ? "" : undefined} data-mega={mega && open ? "" : undefined}
        className={s.notch} style={{ ...LOGO_VARS, "--mega-h": `${megaH}px` } as CSSProperties}
        onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onPointerOver={onPointerOver} onPointerDown={onPointerDown} onClickCapture={onClickCapture} onFocus={onFocus} onBlur={onBlur}>
        <div className={s.row}>
          <Link href="/" aria-label="Boredroom home" className={cn(s.logo, "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]")}>
            <LogoArt variant="mark" height={LOGO_H} className={s.logoMark} alt="Boredroom" />
            <LogoArt variant="full" height={LOGO_H} className={s.logoFull} alt="Boredroom" />
          </Link>

          {/* From 1152px up: the links and the tools fold away with the notch; the section name takes their place. A
              section with a menu is the link to its page and a chevron that opens its panel (mounted on first open). */}
          <div className={cn(s.fold, s.wideOnly)}>
            <div className={s.foldInner}>
              <ul className="flex items-center gap-0.5 pl-4 pr-2">
                {NAV.map((l) => {
                  const m = menuByHub.get(l.path);
                  if (!m) return <li key={l.path}><Link href={l.path} aria-current={ariaCurrent(l.path)} className={LINK}>{l.label}</Link></li>;
                  const isOpen = mega === m.hub && open;
                  return (
                    <li key={l.path} data-mega-item ref={(el) => { if (el) items.current.set(m.hub, el); else items.current.delete(m.hub); }}
                      onPointerEnter={itemPointerEnter(m.hub)} onPointerLeave={itemPointerLeave} onBlur={itemBlur(m.hub)}>
                      <div data-open={isOpen ? "" : undefined} className="flex h-8 items-center rounded-lg transition-colors duration-75 hover:bg-fill-1 has-[a[aria-current]]:bg-fill-1 data-[open]:bg-fill-1 pointer-coarse:h-10">
                        <Link href={l.path} aria-current={ariaCurrent(l.path)} onClick={labelClick(m.hub)} onKeyDown={arrowOpen(m.hub)}
                          className={cn("inline-flex h-full items-center rounded-lg pl-2.5 pr-0.5 text-sm font-medium text-secondary transition-colors duration-75 hover:text-foreground aria-[current]:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", isOpen && "text-foreground")}>{l.label}</Link>
                        <button type="button" aria-expanded={isOpen} aria-controls={megaId(m.hub)} aria-label={`${l.label} pages`}
                          ref={(el) => { if (el) chevrons.current.set(m.hub, el); else chevrons.current.delete(m.hub); }}
                          onClick={chevronClick(m.hub)} onKeyDown={arrowOpen(m.hub)}
                          className="grid h-8 w-6 place-items-center rounded-lg text-secondary transition-colors duration-75 hover:text-foreground aria-expanded:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:h-10 pointer-coarse:w-8">
                          <ChevronDown aria-hidden className={cn(s.chevron, "size-3.5")} />
                        </button>
                      </div>
                      <div id={megaId(m.hub)} ref={(el) => { if (el) panels.current.set(m.hub, el); else panels.current.delete(m.hub); }}
                        className={s.mega} data-state={isOpen ? "open" : "closed"} data-from={isOpen && from ? from : undefined} inert={!isOpen} onKeyDown={panelKeys}>
                        {mounted.includes(m.hub) ? <MegaPanel menu={m} pathname={pathname} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className={cn(s.fold, s.foldEnd, s.wideOnly)}>
            <div className={s.foldInner}>
              <div className="flex items-center gap-1.5 px-1.5">
                <ThemeToggle />
                {login()}
                {cta()}
              </div>
            </div>
          </div>
          <span aria-hidden className={cn(s.label, s.wideOnly)} data-off={showLabel ? undefined : ""} data-late={justFolded ? "" : undefined} style={{ "--label-w": `${labelW}px` } as CSSProperties}>
            <span ref={labelInner}>{namedText}</span>
          </span>

          {/* Below 1152px: the call to action (from 380px; it folds away with the compact notch) and the menu button. */}
          <div className={cn(s.phoneOnly, "ml-auto items-center gap-1")}>
            <div className={cn(s.fold, s.foldEnd, "max-[379px]:hidden")}>
              <div className={s.foldInner}>{cta()}</div>
            </div>
            <IconButton ref={toggle} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} aria-controls="site-menu" onClick={() => setMenu((v) => !v)}>
              {menu ? <X aria-hidden /> : <Menu aria-hidden />}
            </IconButton>
          </div>
        </div>
        {/* The notch growing down into the open panel: one black shape whose height follows the panel's. */}
        <div aria-hidden className={s.megaBack} />

        {/* The phone menu: the notch grows down into it. Any link in it closes it (the waitlist link scrolls to the form itself). */}
        <div id="site-menu" className={s.panel} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setMenu(false); }}>
          <div className={s.panelInner}>
            <div className={s.panelScroll}>
              <div>
                <ul className="border-t border-border pt-2">
                  {NAV.map((l) => {
                    const m = menuByHub.get(l.path);
                    const row = "flex h-11 min-w-0 flex-1 items-center rounded-lg px-3 text-base font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground aria-[current]:bg-fill-1 aria-[current]:text-foreground";
                    if (!m) return <li key={l.path}><Link href={l.path} aria-current={ariaCurrent(l.path)} className={row}>{l.label}</Link></li>;
                    const expanded = groups.includes(m.hub);
                    return (
                      <li key={l.path}>
                        <div className="flex items-center gap-1">
                          <Link href={l.path} aria-current={ariaCurrent(l.path)} className={row}>{l.label}</Link>
                          <button type="button" aria-expanded={expanded} aria-controls={groupId(m.hub)} aria-label={`${l.label} pages`} onClick={() => toggleGroup(m.hub)}
                            className="grid size-11 shrink-0 place-items-center rounded-lg text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground aria-expanded:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">
                            <ChevronDown aria-hidden className={cn(s.chevron, "size-4")} />
                          </button>
                        </div>
                        <div id={groupId(m.hub)} className={s.group} data-open={expanded ? "" : undefined} inert={!expanded}>
                          <div className={s.groupInner}>
                            {groupsMounted.includes(m.hub) ? (
                              <ul className="pb-2 pl-3 pt-1">
                                {m.items.map((it) => (
                                  <li key={it.path}>
                                    <Link href={it.path} aria-current={pathname === it.path ? "page" : undefined}
                                      className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-1.5 transition-colors duration-75 hover:bg-fill-1 aria-[current]:bg-fill-1">
                                      <PageIcon name={it.icon} className="size-[18px] shrink-0 text-secondary" />
                                      <span className="min-w-0">
                                        <span className="block text-[15px] font-medium leading-[22px] text-foreground">{it.label}</span>
                                        <span className="block text-meta font-normal text-secondary">{it.line}</span>
                                      </span>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {/* The theme with its name, so the sheet never ends on a lone icon (review fix, 10 October 2026). */}
                <div className="mt-2 flex h-12 items-center gap-2 border-t border-border pl-3 pr-1 pt-2">
                  <span className="text-base font-medium text-secondary">Theme</span>
                  <ThemeToggle className="ml-auto" />
                </div>
                {/* The bar keeps its call to action from 380px up, so the menu repeats it only below that. */}
                <div className={cn("mt-1 flex items-center gap-2 px-1", !hasLogin && "min-[380px]:hidden")}>
                  {login()}
                  {cta("min-[380px]:hidden")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
    </>
  );
}

/**
 * One mega-menu's panel: the section's name and summary on the left (a paragraph, never a heading: no headings in the
 * nav), its pages in two columns (a 32px hairline icon square, the name, one line), and the foot: "See all …" and, for
 * a section with fewer than three pages, its related pages. The current page is marked `aria-current` and sits on fill-1
 * (no orange: the nav's current-section rule).
 */
function MegaPanel({ menu: m, pathname }: { menu: NavMenu; pathname: string | null }) {
  const nameId = `${megaId(m.hub)}-name`;
  return (
    <div className={s.megaInner}>
      <div className="grid grid-cols-[232px_minmax(0,1fr)]">
        <div className="border-r border-border p-4">
          <p id={nameId} className="font-display text-[20px] font-normal leading-[26px] tracking-[-0.01em] text-foreground">{m.label}</p>
          <p className="mt-2 text-meta font-normal text-secondary">{m.summary}</p>
        </div>
        <ul aria-labelledby={nameId} className="grid grid-cols-2 content-start gap-1 p-2">
          {m.items.map((it) => (
            <li key={it.path} className="min-w-0">
              <Link href={it.path} aria-current={pathname === it.path ? "page" : undefined}
                className="group flex gap-3 rounded-xl p-3 transition-colors duration-75 hover:bg-fill-1 aria-[current]:bg-fill-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-secondary transition-colors duration-75 group-hover:text-foreground group-focus-visible:text-foreground [&_svg]:size-4">
                  <PageIcon name={it.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{it.label}</span>
                  <span className="mt-0.5 line-clamp-2 block text-meta font-normal text-secondary">{it.line}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-2.5">
        <Link href={m.hub} className="group inline-flex h-8 items-center gap-1 rounded-lg text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
          {m.seeAll}<AnimatedChevronRight aria-hidden className="size-4 text-secondary transition-colors duration-75 group-hover:text-foreground" />
        </Link>
        {m.related.length ? (
          <p className="flex flex-wrap items-center gap-x-3 text-meta font-normal text-subtle">
            Related
            {m.related.map((r) => (
              <Link key={r.path} href={r.path} className="rounded-sm text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{r.label}</Link>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
