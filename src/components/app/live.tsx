"use client";

/** Small live pieces for the Workroom: a ticking elapsed clock and a pulsing "Live" badge. */
import { useEffect, useState } from "react";
import { formatClock } from "@/lib/utils";

/** Shows seconds counted from a server reading; ticks locally while running. */
export function LiveClock({ seconds, serverNow, running, className }: { seconds: number; serverNow: string; running: boolean; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const extra = running && now ? Math.max(0, Math.floor((now - new Date(serverNow).getTime()) / 1000)) : 0;
  return <span className={`tabular-nums ${className ?? ""}`} aria-live="off">{formatClock(seconds + extra)}</span>;
}

export function LiveBadge({ label = "Recording" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-danger/40 bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger" aria-label={`${label} live`}>
      <span className="rec-dot size-2 rounded-full bg-danger" aria-hidden />
      LIVE
    </span>
  );
}
