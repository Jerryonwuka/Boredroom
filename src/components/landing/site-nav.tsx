"use client";

/**
 * The landing page header, v4: the app's top bar language at marketing width. Sticky, 56px, the canvas at 90% with an
 * 8px blur (the one blur in v4) and a bottom hairline. The logo; the section links in the middle (14/20 medium,
 * secondary, a fill-1 plate on hover); the theme toggle and the call to action on the right, a white primary (the
 * hero carries the page's one orange button). Signed in it opens the workspace; in waitlist mode it goes to the form
 * and there is no Log in link (owner decision, 25 September 2026); otherwise Log in (ghost) and Get started.
 * Below 768px the links fold into a menu that drops over the page under the bar (it never pushes the page, so a link
 * that scrolls lands where it aimed); a link closes it, and Escape closes it and gives focus back to the menu button.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IconButton } from "@/components/ui/icon-button";
import { buttonVariants } from "@/components/ui/button";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { WRAP } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const LINKS = [
  { name: "How it works", link: "#how" },
  { name: "Product", link: "#product" },
  { name: "Fairness", link: "#fair" },
  { name: "Pricing", link: "#pricing" },
  { name: "FAQ", link: "#faq" },
];

export function SiteNav({ signedIn, waitlist = false }: { signedIn: boolean; waitlist?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => { window.removeEventListener("keydown", onKey); wide.removeEventListener("change", onWide); };
  }, [open]);

  const close = () => setOpen(false);
  const primary = (extra?: string) => cn(buttonVariants({ variant: "primary", size: "sm" }), extra);
  const cta = (extra?: string) => signedIn ? <Link href="/app" className={primary(extra)}>Open workspace</Link>
    : waitlist ? <WaitlistLink className={primary(extra)}>Join the waitlist</WaitlistLink>
    : <Link href="/signup" className={primary(extra)}>Get started</Link>;
  const login = (extra?: string) => (!signedIn && !waitlist ? <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), extra)}>Log in</Link> : null);

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-[var(--header-bg)] backdrop-blur-[8px]">
      <div className={cn(WRAP, "flex h-14 items-center gap-3")}>
        <Logo height={16} className="shrink-0" />
        <nav aria-label="Main" className="hidden min-w-0 flex-1 justify-center md:flex">
          <ul className="flex items-center gap-0.5">
            {LINKS.map((l) => (
              <li key={l.link}><a href={l.link} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground">{l.name}</a></li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
          <ThemeToggle className="max-md:hidden" />
          {login("max-md:hidden")}
          {cta("max-[379px]:hidden")}
          <IconButton ref={toggle} className="md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}>
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </IconButton>
        </div>
      </div>
      {/* Any link in the menu closes it (the waitlist link scrolls to the form itself). */}
      <div id="site-menu" hidden={!open} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) close(); }}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-56px)] overflow-y-auto border-b border-border bg-background shadow-sheet md:hidden">
        <nav aria-label="Menu" className={cn(WRAP, "py-3")}>
          <ul>
            {LINKS.map((l) => (
              <li key={l.link}><a href={l.link} className="flex h-11 items-center rounded-lg px-2 text-base font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground">{l.name}</a></li>
            ))}
          </ul>
          {/* The bar keeps its call to action from 380px up, so the menu repeats it only below that. */}
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            {login()}
            {cta("min-[380px]:hidden")}
            <ThemeToggle className="ml-auto" />
          </div>
        </nav>
      </div>
    </header>
  );
}
