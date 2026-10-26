"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ShellStrip } from "@/components/app/billing-banner";
import { api, isApiFailure } from "@/lib/api-client";

/**
 * Shown across the top of every app page while an administrator is viewing Boredroom as this person: a calm strip
 * (v4) with the warning dot, who they are viewing as, and Return to admin. It stays pinned while the page scrolls.
 */
export function ImpersonationBanner({ name, adminEmail }: { name: string; adminEmail: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ShellStrip tone="warning" role="status"
      action={
        <div className="flex items-center gap-3">
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
          <Button size="xs" variant="secondary" disabled={pending} onClick={async () => {
            setPending(true); setError(null);
            try { const r = await api<{ next: string }>("/api/admin/impersonate/stop", { method: "POST", retries: 0 }); router.push(r.next); router.refresh(); }
            catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again; you are still viewing as this person."); setPending(false); }
          }}>{pending ? "Returning…" : "Return to admin"}</Button>
        </div>
      }>
      <strong className="font-medium">You are viewing Boredroom as {name}</strong>{" "}
      <span className="text-secondary">(signed in as <span className="break-all">{adminEmail}</span>). Everything you do here is recorded against the impersonation.</span>
    </ShellStrip>
  );
}

/**
 * The strips above the shell (this one, the billing line, the maintenance line), pinned together at the top of the
 * screen. Their height is kept on <html> as `--shell-banners` (0px when none shows): the top bar and the sidebar stick
 * just under them, and a view that fills the screen, Brenda's chat, fills exactly the space below them. Measured again
 * whenever a strip wraps, grows or goes.
 */
export function ShellBanners({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    // In Boredroom for Mac's window (the Mac app shell, 26 October 2026) the banners lie over the page's top, and the
    // 16px of gaps around the floating page come off the screen's height too (globals.css, "Boredroom for Mac's window").
    const write = () => {
      const h = el.getBoundingClientRect().height;
      const mac = root.dataset.shell === "mac";
      root.style.setProperty("--shell-banners", `${mac ? h + 16 : h}px`);
      if (mac) root.style.setProperty("--mac-banners", `${h}px`); else root.style.removeProperty("--mac-banners");
    };
    const sizes = new ResizeObserver(write);
    sizes.observe(el);
    write();
    return () => { sizes.disconnect(); root.style.removeProperty("--shell-banners"); root.style.removeProperty("--mac-banners"); };
  }, []);
  return <div ref={ref} data-shell-banners className="sticky top-0 z-[var(--z-sticky)]">{children}</div>;
}
