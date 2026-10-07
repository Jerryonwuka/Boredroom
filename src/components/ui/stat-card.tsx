import Link from "next/link";
import { cn } from "@/lib/utils";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

export type StatRow = { label: string; value: React.ReactNode; share?: React.ReactNode; tone?: "success" | "warning" | "danger" | "info" | "accent" | "neutral" };
const DOT: Record<NonNullable<StatRow["tone"]>, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", accent: "bg-accent", neutral: "bg-subtle" };

/**
 * A stat card, v4 (spec §7): r12 p20, the canvas colour, a hairline and the natural shadow. The label (14/20 medium,
 * secondary) sits over the value (24/30 bold, -0.15px, tabular) with 4px between. Top right, either an `icon` in a
 * 40×40 outline square or an `action` (an IconButton variant="outline"). Under the value: a 13px `hint`, a few `rows`
 * (dot, label, count, share) and a row of `actions` (small buttons, 8px apart). `verdict` is the v3 name for `value`.
 */
export function StatCard({ label, value, verdict, tone = "default", rows = [], href, className, icon, action, hint, actions }: {
  label: React.ReactNode; value?: React.ReactNode; verdict?: React.ReactNode; tone?: "default" | "accent" | "danger" | "warning" | "success";
  rows?: StatRow[]; href?: string; className?: string; icon?: React.ReactNode; action?: React.ReactNode; hint?: React.ReactNode; actions?: React.ReactNode;
}) {
  const figure = value ?? verdict;
  const side = action ?? (icon ? <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border-input text-secondary [&_svg]:size-[18px]" aria-hidden>{withAnimatedIcons(icon)}</span> : null);
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-secondary">{label}</p>
          <p className={cn("type-stat mt-1 break-words", tone === "accent" && "text-accent-text", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{figure}</p>
          {hint ? <p className="mt-1 text-meta font-normal text-secondary">{hint}</p> : null}
        </div>
        {side}
      </div>
      {rows.length ? (
        <ul className="mt-4 space-y-1.5 text-meta">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", DOT[r.tone ?? "neutral"])} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-normal text-secondary">{r.label}</span>
              <span className="tabular-nums text-foreground">{r.value}</span>
              {r.share !== undefined ? <span className="w-10 text-right tabular-nums text-subtle">{r.share}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </>
  );
  return href ? <Link href={href} className={cn("card-stat block min-w-0", className)}>{body}</Link> : <div className={cn("card-stat min-w-0", className)}>{body}</div>;
}
