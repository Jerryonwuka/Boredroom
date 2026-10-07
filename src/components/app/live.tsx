"use client";

/**
 * Small live pieces for the management screens (Dashboard, Workroom, Attendance), v4 with the accent rules (owner
 * decision, 6 October 2026: orange marks what is live): a ticking elapsed clock (orange digits while it runs, unless a
 * crowded list asks for `quiet`), the recording badge (orange), the live-sync line (an orange breathing dot and "Live"),
 * the status dot (`tone="live"` for someone working) and a slow re-read.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusDot, LiveIndicator } from "@/components/ui/status-dot";

/** The status dot (components/ui/status-dot): `live` is orange and breathes; success, warning, danger, neutral keep their meaning. */
export { StatusDot, LiveIndicator };

export function LiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Never under someone's fingers: a filter or form in use waits for the next round.
      if (document.activeElement?.closest("form, [role=dialog], dialog")) return;
      router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}

/**
 * Seconds counted from a server reading; ticks locally while running. Timers are set in Geist Mono (spec §2). A running
 * clock's digits are orange (a live timer); `quiet` keeps them in the foreground where many run side by side (a table of
 * everyone working), so orange stays rare there.
 */
export function LiveClock({ seconds, serverNow, running, className, quiet = false }: { seconds: number; serverNow: string; running: boolean; className?: string; quiet?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const extra = running && now ? Math.max(0, Math.floor((now - new Date(serverNow).getTime()) / 1000)) : 0;
  return <span role="timer" className={cn("font-mono tabular-nums", running ? (quiet ? "text-foreground" : "text-accent-text") : "text-secondary", className)}>{formatClock(seconds + extra)}</span>;
}

/** A screen recording in progress: a small orange badge with a breathing dot (recording is live: accent rules). */
export function LiveBadge({ label = "Recording" }: { label?: string }) {
  return <Badge tone="accent"><StatusDot tone="live" size={6} />{label}</Badge>;
}

/**
 * The line under a live page's title: an orange breathing dot and "Live", and when it last synced. What the page
 * follows ("This page updates as people start and stop") is a page note at the bottom (owner request, 7 October 2026:
 * `PageNotes`), not part of this line.
 */
export function LiveSync({ at }: { at: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <LiveIndicator />
      <span>Last sync <span className="tabular-nums">{at}</span></span>
    </span>
  );
}
