"use client";

/**
 * The landing page header on Aceternity's resizable navbar: full width at the top, and after a hundred pixels of
 * scroll it shrinks to a floating pill with the links in the middle. On phones it is a bar with a menu button.
 */
import { useState } from "react";
import Link from "next/link";
import { Navbar, NavBody, NavItems, MobileNav, MobileNavHeader, MobileNavMenu, MobileNavToggle } from "@/components/aceternity/resizable-navbar";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const LINKS = [
  { name: "How it works", link: "#how" },
  { name: "Product", link: "#product" },
  { name: "Fairness", link: "#fair" },
  { name: "FAQ", link: "#faq" },
];

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const cta = signedIn
    ? <Link href="/app" className="lp-btn lp-btn-primary lp-btn-sm">Open workspace</Link>
    : <><Link href="/login" className="lp-muted text-sm transition-colors hover:text-fg">Log in</Link><Link href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">Get started</Link></>;
  return (
    <Navbar className="top-0 pt-3">
      <NavBody className="px-3 py-2">
        <div className="relative z-20 pl-2"><Logo /></div>
        <NavItems items={LINKS} />
        <div className="relative z-20 flex items-center gap-3"><ThemeToggle />{cta}</div>
      </NavBody>
      <MobileNav>
        <MobileNavHeader className="px-3">
          <Logo />
          <div className="flex items-center gap-2"><ThemeToggle /><button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} className="grid size-10 place-items-center"><MobileNavToggle isOpen={open} onClick={() => setOpen((v) => !v)} /></button></div>
        </MobileNavHeader>
        <MobileNavMenu isOpen={open} onClose={() => setOpen(false)}>
          {LINKS.map((l) => <a key={l.link} href={l.link} onClick={() => setOpen(false)} className="lp-muted text-base transition-colors hover:text-fg">{l.name}</a>)}
          <div className="flex w-full flex-wrap items-center gap-3 border-t border-border-soft pt-4">{cta}</div>
        </MobileNavMenu>
      </MobileNav>
    </Navbar>
  );
}
