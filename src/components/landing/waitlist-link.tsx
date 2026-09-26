"use client";

import type { ReactNode, MouseEvent } from "react";

/**
 * A link to the waitlist form at the foot of the page. It is a plain anchor to #waitlist, so it works without
 * JavaScript, and with it the page glides to the form and puts the cursor in the first field.
 */
export function WaitlistLink({ className, children }: { className?: string; children: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    const form = document.getElementById("waitlist");
    if (!form) return;
    e.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    form.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", "#waitlist");
    window.setTimeout(() => form.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus({ preventScroll: true }), reduced ? 0 : 700);
  };
  return <a href="#waitlist" onClick={go} className={className}>{children}</a>;
}
