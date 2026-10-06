import { cn } from "@/lib/utils";

/**
 * Status dots, v4 with the accent rules (owner decision, 6 October 2026). Orange means LIVE: a running timer, a
 * recording in progress, Brenda listening or working, a page that syncs live. Status colours keep their meaning
 * (success green, warning amber, danger red); `neutral` is a quiet grey.
 *
 * - `StatusDot`: an 8px dot. `tone="live"` is orange and breathes (a ring that swells and fades); any tone can breathe
 *   with `pulse`. `label` names it for screen readers; leave it out when the words sit beside it.
 * - `LiveIndicator`: the dot and a short word in 12/16 medium, orange text ("Live", "Recording", "Listening").
 * - For a running timer's digits use `text-accent-text tabular-nums` (Geist Mono: `font-mono`) beside a live dot.
 */
export type StatusTone = "live" | "success" | "warning" | "danger" | "neutral";
const COLOR: Record<StatusTone, string> = { live: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-faint" };

export function StatusDot({ tone, pulse, label, className, size = 8 }: { tone: StatusTone; /** Breathe; on by default for `live`. */ pulse?: boolean; label?: string; className?: string; size?: number }) {
  const color = COLOR[tone];
  const breathing = pulse ?? tone === "live";
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {breathing ? <span className={cn("presence-live absolute inset-0 rounded-full", color)} /> : null}
      <span className={cn("relative size-full rounded-full", color)} />
    </span>
  );
}

export function LiveIndicator({ children = "Live", className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-accent-text", className)}>
      <StatusDot tone="live" />{children}
    </span>
  );
}
