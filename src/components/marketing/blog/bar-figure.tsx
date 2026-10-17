import { cn } from "@/lib/utils";

/**
 * Horizontal bar charts for the statistics post (owner request, 17 October 2026: SEO analysis: "at least three charts
 * or data visualisations, with descriptive alt text"). Plain HTML, server-rendered, tokens only.
 *
 * Built so the chart is readable without its colours or its marks: every bar sits next to its label and its value as
 * real text (direct labels on every bar, so a screen reader reads the label, the series and the figure in order), and the
 * bars themselves are hidden from assistive technology. The figure is named by its caption, which says what the chart
 * shows and where the numbers come from. One axis per chart; bars start at the zero line (a range is drawn between its
 * two ends); 4px rounded data ends; hairline zero line.
 *
 * Colour by job (docs/design-system.md, the accent rules: the highlight series orange, the others grey): `tone` "accent"
 * marks the highlighted series (the group the study changed), "neutral" the comparison; a single series is grey and needs
 * no legend (the title names it). A legend is shown for two series, and each bar also names its series in text.
 */

export type BarValue = {
  /** The series this bar belongs to (shown beside the value when there are two series). */
  series?: string;
  /** Where the bar ends; with `from`, a range between the two. */
  value: number;
  from?: number;
  /** The figure as written beside the bar ("−8% to −19%", "4.80%"). */
  display: string;
  tone?: "accent" | "neutral";
};

export type BarRow = { label: string; note?: string; values: readonly BarValue[] };

const FILL = { accent: "bg-accent", neutral: "bg-grey-600" } as const;

export function BarFigure({ title, caption, rows, min = 0, max, legend, className }: {
  title: string;
  caption: React.ReactNode;
  rows: readonly BarRow[];
  /** The axis: from `min` (below 0 for a chart with falls) to `max`. */
  min?: number;
  max: number;
  /** Two series: their names and tones, in the order the bars are drawn. */
  legend?: readonly { label: string; tone: "accent" | "neutral" }[];
  className?: string;
}) {
  const span = max - min;
  const pos = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / span) * 100;
  const zero = pos(0);
  return (
    <figure className={cn("rounded-2xl border border-border bg-fill-0 p-4 sm:p-6", className)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {legend?.length ? (
        <ul data-plain className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-meta" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} data-plain className="flex items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", FILL[l.tone])} />
              <span className="font-normal text-secondary">{l.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul data-plain className="mt-5 space-y-5">
        {rows.map((r) => (
          <li key={r.label} data-plain>
            <p className="text-[14px] font-medium leading-5 text-foreground">{r.label}</p>
            {r.note ? <p className="text-meta font-normal text-secondary">{r.note}</p> : null}
            <ul data-plain className="mt-2 space-y-1.5">
              {r.values.map((v, i) => {
                const a = pos(v.from ?? 0);
                const b = pos(v.value);
                const left = Math.min(a, b);
                const width = Math.abs(b - a);
                return (
                  <li key={i} data-plain className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <span aria-hidden className="relative block h-3">
                      <span className="absolute inset-y-[-3px] w-px bg-border-input-hover" style={{ left: `${zero}%` }} />
                      {width > 0.4
                        ? <span className={cn("absolute inset-y-0 rounded-[4px]", FILL[v.tone ?? "neutral"])} style={{ left: `${left}%`, width: `${width}%` }} />
                        : <span className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full", FILL[v.tone ?? "neutral"])} style={{ left: `${b}%` }} />}
                    </span>
                    <span className="min-w-[5.5rem] text-right text-meta font-medium tabular-nums text-foreground">
                      {v.series ? <span className="font-normal text-secondary">{v.series} </span> : null}{v.display}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <figcaption className="mt-5 border-t border-border pt-3 text-meta font-normal text-secondary">{caption}</figcaption>
    </figure>
  );
}
