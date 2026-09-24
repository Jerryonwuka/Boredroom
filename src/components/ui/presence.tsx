import { cn } from "@/lib/utils";
import { PRESENCE, type Presence } from "@/lib/presence";

/** The status dot: a live pulsing green for active, a still coloured dot for the rest. */
export function PresenceDot({ presence, size = 10, className, withRing = true }: { presence: Presence; size?: number; className?: string; withRing?: boolean }) {
  const p = PRESENCE[presence];
  return (
    <span role="img" aria-label={p.label} title={p.label} className={cn("relative inline-block shrink-0 rounded-full", withRing && "ring-2 ring-[var(--bg-elevated)]", className)} style={{ width: size, height: size, background: p.color }}>
      {p.live ? <span aria-hidden className="presence-live absolute inset-0 rounded-full" style={{ background: p.color }} /> : null}
    </span>
  );
}

export function PresenceLabel({ presence, className }: { presence: Presence; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 text-xs text-fg-muted", className)}><PresenceDot presence={presence} size={8} withRing={false} />{PRESENCE[presence].label}</span>;
}
