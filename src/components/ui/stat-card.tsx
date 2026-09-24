import Link from "next/link";
import { cn } from "@/lib/utils";

export type StatRow = { label: string; value: React.ReactNode; share?: React.ReactNode; tone?: "success" | "warning" | "danger" | "info" | "accent" | "neutral" };
const DOT: Record<NonNullable<StatRow["tone"]>, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", accent: "bg-accent", neutral: "bg-fg-subtle" };

/**
 * A verdict card, in the style of a metrics page: a quiet label, one word or figure that says how things are,
 * then a few rows of dot, label, count and share. Three of these across the top of a page replace a row of
 * identical number boxes. The verdict is the only thing set in the display face.
 */
export function StatCard({ label, verdict, tone = "default", rows = [], href, className }: { label: string; verdict: React.ReactNode; tone?: "default" | "accent" | "danger" | "warning"; rows?: StatRow[]; href?: string; className?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">{label}</p>
      <p className={cn("mt-1.5 font-display text-[28px] leading-none tracking-[-0.01em]", tone === "accent" && "text-accent", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{verdict}</p>
      {rows.length ? (
        <ul className="mt-5 divide-y divide-border-soft text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2.5 py-2.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[r.tone ?? "neutral"])} aria-hidden />
              <span className="flex-1 truncate text-fg">{r.label}</span>
              <span className="tabular-nums text-fg-muted">{r.value}</span>
              {r.share !== undefined ? <span className="w-12 text-right tabular-nums text-fg">{r.share}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
  return href ? <Link href={href} className={cn("tile tile-link block p-5", className)}>{body}</Link> : <div className={cn("tile p-5", className)}>{body}</div>;
}
