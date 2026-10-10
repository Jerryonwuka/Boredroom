"use client";

/**
 * The landing page header as a notch (owner request, 10 October 2026: "make our nav bar a notch, just like on
 * supaste.com, it minimises and maximises on hover"). A black island hung from the top centre with flared shoulders,
 * the way Brenda desktop sits in a Mac's notch; the styles and the reasons are in site-nav.module.css.
 * - From 768px up it is open at the top of the page: the logo, the section links (14/20 medium, secondary, a fill-1
 *   plate on hover), the theme toggle and the call to action, a white primary (the hero carries the page's one orange
 *   button). Once the page scrolls it folds to a small notch: the "B." mark and, inside a linked section, that
 *   section's name. A mouse over it opens it (and it lingers 140ms after the pointer leaves), keyboard focus inside it
 *   opens it, so every link stays reachable by Tab, and on a touch screen the first tap on the folded notch opens it
 *   (a tap outside, Escape or a little scrolling folds it again).
 * - Below 768px it is a bar at the top of the page (the logo, the call to action from 380px, the menu button) and, once
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
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IconButton } from "@/components/ui/icon-button";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { cn } from "@/lib/utils";
import s from "./site-nav.module.css";

const LINKS = [
  { name: "How it works", link: "#how" },
  { name: "Calls", link: "#calls" },
  { name: "Fairness", link: "#fair" },
  { name: "Pricing", link: "#pricing" },
  { name: "FAQ", link: "#faq" },
];

/** The logo's drawn height and its two widths (LogoArt's artwork is 519×58, the mark 72×58). */
const LOGO_H = 16;
const LOGO_VARS = { "--logo-h": `${LOGO_H}px`, "--logo-full": `${Math.round((519 / 58) * LOGO_H)}px`, "--logo-mark": `${Math.round((72 / 58) * LOGO_H)}px` } as CSSProperties;
/** How far the page scrolls before the notch folds. */
const FOLD_AT = 64;
/** A notch opened by a tap folds again after this much scrolling. */
const TAP_SCROLL = 48;
const LINGER_MS = 140;

export function SiteNav({ signedIn, waitlist = false, maintenance = false }: { signedIn: boolean; waitlist?: boolean; maintenance?: boolean }) {
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

  const toggle = useRef<HTMLButtonElement>(null);
  const notch = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const labelInner = useRef<HTMLSpanElement>(null);
  const leave = useRef<number | undefined>(undefined);
  const pointerType = useRef("mouse");

  const open = atTop || (!dismissed && (hover || focus || tapped !== null));
  /**
   * Just folded: the section name waits for the groups to fold before it slides in, so the notch never grows wider
   * than its open width on the way down (review fix, 10 October 2026). Set as it folds (state from the last render),
   * cleared once the fold is done, so a later change of section moves the name at once.
   */
  const [prevOpen, setPrevOpen] = useState(open);
  const [justFolded, setJustFolded] = useState(false);
  if (prevOpen !== open) { setPrevOpen(open); setJustFolded(!open); }
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

  // The name of the linked section in the middle of the screen, shown beside the mark while folded.
  useEffect(() => {
    const els = LINKS.map((l) => document.getElementById(l.link.slice(1))).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const inView = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) inView.add(e.target.id); else inView.delete(e.target.id); }
      const hit = LINKS.find((l) => inView.has(l.link.slice(1)));
      setSection(hit ? hit.name : null);
      // The label keeps the last name while it folds away, so it does not empty before it closes.
      if (hit) setLabelText(hit.name);
    }, { rootMargin: "-45% 0px -50% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  useLayoutEffect(() => { setLabelW(labelInner.current?.offsetWidth ?? 0); }, [labelText]);

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

  // The phone menu: Escape closes it (focus back to its button), a tap outside closes it, and it closes at 768px up.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); toggle.current?.focus(); } };
    const onDown = (e: globalThis.PointerEvent) => { if (!notch.current?.contains(e.target as Node)) setMenu(false); };
    const wide = window.matchMedia("(min-width: 768px)");
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

  useEffect(() => () => window.clearTimeout(leave.current), []);

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
  };
  const onPointerDown = (e: PointerEvent) => { pointerType.current = e.pointerType; };
  // On a touch screen at 768px up, the first tap on the folded notch opens it instead of following what it landed on.
  const onClickCapture = (e: MouseEvent) => {
    if (open || pointerType.current === "mouse" || !window.matchMedia("(min-width: 768px)").matches) return;
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

  const primary = (extra?: string) => cn(buttonVariants({ variant: "primary", size: "sm" }), extra);
  const cta = (extra?: string) => signedIn ? <Link href="/app" className={primary(extra)}>Open workspace</Link>
    : waitlist ? <WaitlistLink className={primary(extra)}>Join the waitlist</WaitlistLink>
    : maintenance ? <Link href="/login" className={primary(extra)}>Log in</Link>
    : <Link href="/signup" className={primary(extra)}>Get started</Link>;
  const login = (extra?: string) => (!signedIn && !waitlist && !maintenance ? <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), extra)}>Log in</Link> : null);
  const showLabel = !!section && !open;
  const hasLogin = !signedIn && !waitlist && !maintenance;

  return (
    <>
    <div ref={top} aria-hidden className="pointer-events-none absolute left-0 top-0 w-px" style={{ height: FOLD_AT }} />
    <header className={s.shell}>
      <nav ref={notch} aria-label="Main" data-theme="dark" data-state={open ? "open" : "closed"} data-menu={menu ? "" : undefined} className={s.notch} style={LOGO_VARS}
        onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onClickCapture={onClickCapture} onFocus={onFocus} onBlur={onBlur}>
        <div className={s.row}>
          <Link href="/" aria-label="Boredroom home" className={cn(s.logo, "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]")}>
            <LogoArt variant="mark" height={LOGO_H} className={s.logoMark} />
            <LogoArt variant="full" height={LOGO_H} className={s.logoFull} />
          </Link>

          {/* From 768px up: the links and the tools fold away with the notch; the section name takes their place. Under
              1024px the links sit closer, so the notch fits at 768px in every mode (725px at most, with Log in and Get started). */}
          <div className={cn(s.fold, s.wideOnly)}>
            <div className={s.foldInner}>
              <ul className="flex items-center gap-0.5 pl-3 pr-1 lg:pl-5 lg:pr-3">
                {LINKS.map((l) => (
                  <li key={l.link}><a href={l.link} className="inline-flex h-8 items-center rounded-lg px-2 text-sm lg:px-2.5 font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{l.name}</a></li>
                ))}
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
            <span ref={labelInner}>{labelText}</span>
          </span>

          {/* Below 768px: the call to action (from 380px; it folds away with the compact notch) and the menu button. */}
          <div className={cn(s.phoneOnly, "ml-auto items-center gap-1")}>
            <div className={cn(s.fold, s.foldEnd, "max-[379px]:hidden")}>
              <div className={s.foldInner}>{cta()}</div>
            </div>
            <IconButton ref={toggle} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} aria-controls="site-menu" onClick={() => setMenu((v) => !v)}>
              {menu ? <X aria-hidden /> : <Menu aria-hidden />}
            </IconButton>
          </div>
        </div>

        {/* The phone menu: the notch grows down into it. Any link in it closes it (the waitlist link scrolls to the form itself). */}
        <div id="site-menu" className={s.panel} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setMenu(false); }}>
          <div className={s.panelInner}>
            <div className={s.panelScroll}>
              <div>
                <ul className="border-t border-border pt-2">
                  {LINKS.map((l) => (
                    <li key={l.link}><a href={l.link} className="flex h-11 items-center rounded-lg px-3 text-base font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground">{l.name}</a></li>
                  ))}
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
