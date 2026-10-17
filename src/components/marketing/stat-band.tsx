import { arrive } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const COLS: Record<2 | 3 | 4, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

/**
 * Figures in a band (owner feedback, 17 October 2026: pages v2; the reference's "at a glance" cards): a <dl> in the
 * home page's hairline grid, each cell a label, the figure in the display face (tabular) and a note (a source link and
 * its date when the figure is someone else's). Figures only from the page's own facts, compare/data.ts, the live plans or
 * a sourced statistic: never a new number.
 *
 *   <StatBand items={[{ label: "Remote-capable employees working fully remotely", value: "27%", note: <>…<AsOf date="…" /></> }]} />
 */
export function StatBand({ items, columns, className }: {
  items: readonly { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode }[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = columns ?? (items.length >= 4 ? 4 : items.length === 2 ? 2 : 3);
  return (
    <dl data-lp-arrive className={cn("grid gap-px overflow-hidden rounded-[20px] border border-border bg-border", COLS[cols], className)}>
      {items.map((s, i) => (
        <div key={i} className="min-w-0 bg-background p-6">
          <div className="lp-item flex h-full flex-col" style={arrive(i)}>
            <dt className="type-metric-label text-secondary">{s.label}</dt>
            <dd className="mt-3 font-display text-[32px] font-normal leading-9 tracking-[-0.02em] tabular-nums text-foreground">{s.value}</dd>
            {s.note ? <dd className="mk-links mt-2 text-xs font-normal text-subtle">{s.note}</dd> : null}
          </div>
        </div>
      ))}
    </dl>
  );
}

/**
 * Two products, one fact a cell (owner feedback, 17 October 2026: pages v2; a head-to-head's "at a glance"): each cell
 * names the fact, then both answers under the products' names at the same weight and colour (fair: neither is the
 * winner), and an optional note (its source and date).
 *
 *   <VersusStats subjects={["Boredroom", "ActivTrak"]} items={[{ label: "Pricing model", values: ["Per workspace", "Per user"] }]} />
 */
export function VersusStats({ subjects, items, className }: {
  subjects: readonly [string, string];
  items: readonly { label: React.ReactNode; values: readonly [React.ReactNode, React.ReactNode]; note?: React.ReactNode }[];
  className?: string;
}) {
  const cols = items.length >= 4 ? 4 : items.length === 2 ? 2 : 3;
  return (
    <ul data-lp-arrive className={cn("grid gap-px overflow-hidden rounded-[20px] border border-border bg-border", COLS[cols as 2 | 3 | 4], className)}>
      {items.map((s, i) => (
        <li key={i} className="min-w-0 bg-background p-6">
          <div className="lp-item flex h-full flex-col" style={arrive(i)}>
            <p className="type-metric-label text-secondary">{s.label}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              {subjects.map((name, k) => (
                <div key={name} className="min-w-0">
                  <dt className="text-xs font-medium text-subtle">{name}</dt>
                  <dd className="mt-1 text-[15px] font-semibold leading-[22px] text-foreground text-pretty">{s.values[k]}</dd>
                </div>
              ))}
            </dl>
            {s.note ? <p className="mk-links mt-auto pt-4 text-xs font-normal text-subtle">{s.note}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
