import { cn } from "@/lib/utils";

/**
 * Progress, v4 with the accent rules (owner decision, 6 October 2026: "progress bars, arcs and sliders fill in orange").
 *
 * `ProgressArc`: a ring that fills with the percentage (owner decision, 28 September 2026): how far along a task is,
 * read at a glance in a list, the number in the middle. The ring fills in orange over a 10% track and turns green at
 * 100 (done is success: status meaning wins over accent). `tone="neutral"` draws it in the foreground, for a screen
 * where orange would crowd (many arcs in one table); `tone="accent"` and the default are the same orange. Plain SVG.
 *
 * `ProgressBar`: the same idea as a bar (setup checklists, quotas, uploads): a 6px (sm 4px) fill-1 track filled in
 * orange, green when complete (unless `doneTone="accent"`, for a bar whose end is not a success, like a quota), with
 * the progressbar role and its values.
 */
const FILL = { default: "var(--accent)", accent: "var(--accent)", neutral: "var(--foreground)" } as const;

export function ProgressArc({ percent, size = 44, className, label, tone = "default" }: { percent: number; size?: number; className?: string; label?: string; tone?: keyof typeof FILL }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = Math.max(3, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = p >= 100 ? "var(--success)" : FILL[tone];
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

export function ProgressBar({ value, max = 100, label, valueText, size = "md", tone = "accent", doneTone = "success", className }: {
  value: number; max?: number;
  /** The bar's accessible name ("Setup progress"). */ label: string;
  /** What a screen reader says for the value ("3 of 5 steps done"); a percentage by default. */ valueText?: string;
  size?: "sm" | "md"; tone?: "accent" | "neutral"; doneTone?: "success" | "accent"; className?: string;
}) {
  const top = max > 0 ? max : 1;
  const v = Math.max(0, Math.min(top, value));
  const pct = (v / top) * 100;
  const done = v >= top;
  const fill = done && doneTone === "success" ? "bg-success" : tone === "neutral" ? "bg-foreground" : "bg-accent";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={top} aria-valuenow={v} aria-valuetext={valueText ?? `${Math.round(pct)}%`}
      className={cn("w-full overflow-hidden rounded-full bg-fill-1", size === "sm" ? "h-1" : "h-1.5", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}
