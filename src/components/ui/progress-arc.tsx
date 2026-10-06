import { cn } from "@/lib/utils";

/**
 * A ring that fills with the percentage (owner decision, 28 September 2026): how far along a task is, read at a glance
 * in a list, the number in the middle. v4 is monochrome: the ring fills in the foreground over a 10% track and turns
 * green at 100. `tone="accent"` draws it orange for the one highlighted figure on a screen. Plain SVG.
 */
export function ProgressArc({ percent, size = 44, className, label, tone = "default" }: { percent: number; size?: number; className?: string; label?: string; tone?: "default" | "accent" }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = Math.max(3, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = p >= 100 ? "var(--success)" : tone === "accent" ? "var(--accent)" : "var(--foreground)";
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} role="img" aria-label={label ?? `${p}% done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-input)" strokeWidth={stroke} />
        {p > 0 ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} style={{ transition: "stroke-dasharray 300ms var(--ease-out)" }} /> : null}
      </svg>
      <span className="absolute font-semibold leading-none tabular-nums" style={{ fontSize: Math.max(9, Math.round(size / 4)), color: p >= 100 ? "var(--success)" : "var(--foreground)" }}>{p}%</span>
    </span>
  );
}
