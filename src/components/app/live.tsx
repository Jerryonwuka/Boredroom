"use client";

/**
 * Small live pieces for the management screens (Dashboard, Workroom, Attendance), v4: a ticking elapsed clock, the
 * recording badge, the live-sync line, the status dot and a slow re-read.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Re-reads a live page every so often while it is on screen. The event stream refreshes the page when something
 * changes, but a timer that simply goes quiet (a closed laptop, a lost connection) sends no event, so without this a
 * stale session would show as Active, its clock still ticking, until something else happened in the room.
 */
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

/** Seconds counted from a server reading; ticks locally while running. Timers are set in Geist Mono (spec §2). */
export function LiveClock({ seconds, serverNow, running, className }: { seconds: number; serverNow: string; running: boolean; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const extra = running && now ? Math.max(0, Math.floor((now - new Date(serverNow).getTime()) / 1000)) : 0;
  return <span role="timer" className={cn("font-mono tabular-nums", className)}>{formatClock(seconds + extra)}</span>;
}

/** A screen recording in progress: the small red badge with a pulsing dot. Status colour only on the badge. */
export function LiveBadge({ label = "Recording" }: { label?: string }) {
  return <Badge tone="danger"><span className="rec-dot size-1.5 shrink-0 rounded-full bg-danger" aria-hidden /><span className="sr-only">{label} </span>Live</Badge>;
}

/**
 * A status dot for live lists: green and breathing while someone works (`live`), a still amber when paused, a quiet
 * grey otherwise. `label` names it for screen readers; leave it out when the words sit beside it.
 */
export function StatusDot({ tone, live = false, label, className, size = 8 }: { tone: "success" | "warning" | "danger" | "neutral"; live?: boolean; label?: string; className?: string; size?: number }) {
  const color = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-faint" }[tone];
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {live ? <span className={cn("presence-live absolute inset-0 rounded-full", color)} /> : null}
      <span className={cn("relative size-full rounded-full", color)} />
    </span>
  );
}

/** The line under a live page's title: a breathing green dot, "Live", and when the figures were last synced. */
export function LiveSync({ at, note = "updates as people start and stop" }: { at: string; note?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone="success" live />
      <span>Live, {note}. Last sync <span className="tabular-nums">{at}</span></span>
    </span>
  );
}
