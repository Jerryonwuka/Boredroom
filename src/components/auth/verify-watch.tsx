"use client";

/**
 * "Check your inbox" moves on by itself (owner request, 11 October 2026: the first-run welcome). People confirm on their
 * phone, or in a new tab, and come back to a page that still says "Check your inbox"; this notices instead. Renders nothing.
 *
 * - Another tab of this browser confirmed (VerifyButton posts `{ type: "verified", to }` on the "boredroom-auth"
 *   channel): go where that tab went (the organisation's welcome after a one-press join), if it is a path on this site.
 * - Otherwise ask `GET /api/auth/status` every 5 seconds while the tab is visible, and at once on focus or when the tab
 *   becomes visible again, for at most 30 minutes: confirmed → `next` (or /app); signed out → sign in, carrying `next`.
 *   When `next` is a join link or an invitation and this browser can hear the other tab, a confirmation found by asking
 *   waits a moment for its message, so a one-press join is followed to the welcome rather than back to the join link.
 * The Continue link and the resend button on the page keep working without any of this (no script, keyboard).
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { joiningTarget, safeNextPath } from "@/components/auth/next-path";

const EVERY_MS = 5_000;
const FOR_MS = 30 * 60_000;
/** How long a confirmation found by asking waits for the confirming tab's message (it joins first, then says so). */
const GRACE_MS = 2_500;

export function VerifyWatch({ next }: { next?: string | null }) {
  const router = useRouter();
  const moved = useRef(false);

  useEffect(() => {
    const started = Date.now();
    const fallback = next ? safeNextPath(next) : "/app";
    const joining = joiningTarget(next) !== null;
    let timer: number | null = null;
    let grace: number | null = null;
    let inFlight = false;
    let channel: BroadcastChannel | null = null;

    const go = (to: string) => {
      if (moved.current) return;
      moved.current = true;
      stop();
      router.replace(to);
    };

    const check = async () => {
      if (moved.current || inFlight || document.visibilityState !== "visible") return;
      if (Date.now() - started > FOR_MS) { stop(); return; }
      inFlight = true;
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const status = (await res.json()) as { signedIn?: boolean; emailVerified?: boolean };
        if (status.signedIn === false) go(`/login?next=${encodeURIComponent(fallback)}`);
        else if (status.emailVerified) {
          if (!channel || !joining) go(fallback);
          else if (grace === null) grace = window.setTimeout(() => go(fallback), GRACE_MS);
        }
      } catch { /* offline for a moment: the next check tries again */ } finally {
        inFlight = false;
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onFocus = () => void check();

    function stop() {
      if (timer !== null) window.clearInterval(timer);
      if (grace !== null) window.clearTimeout(grace);
      timer = null;
      channel?.close();
      channel = null;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    }

    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("boredroom-auth");
        channel.onmessage = (e: MessageEvent) => {
          const msg = e.data as { type?: unknown; to?: unknown } | null;
          if (msg?.type !== "verified" || typeof msg.to !== "string") return;
          const to = safeNextPath(msg.to, "");
          if (to) go(to);
        };
      }
    } catch { channel = null; }

    timer = window.setInterval(() => void check(), EVERY_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return stop;
  }, [next, router]);

  return null;
}
