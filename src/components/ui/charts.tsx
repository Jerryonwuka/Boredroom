import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts: plain SVG, server-rendered, coloured by the design tokens. v4 with the accent rules
 * (6 October 2026): the highlight series is orange, everything else grey. AreaChart draws its first series (the
 * selected metric, "this week") in orange and the others in greys, its latest point marked; BarChart draws grey bars
 * with the highlighted bar (today, the current period: by default the last) in orange; Sparkline is a foreground line
 * with its latest point in orange. Status colours only where the data is a status split (Donut, SegmentBar). Grid lines
 * are hairlines, axis labels 12px in the subtle grey at any width. No gradients. Each chart degrades to a quiet
 * "nothing yet" line when every value is zero. Values arrive already counted; the charts only scale.
 */

export type Tone = "accent" | "foreground" | "neutral" | "subtle" | "info" | "success" | "warning" | "danger";
const COLOR: Record<Tone, string> = { accent: "var(--accent)", foreground: "var(--foreground)", neutral: "var(--gray-600)", subtle: "var(--subtle)", info: "var(--info)", success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)" };
const DOT: Record<Tone, string> = { accent: "bg-accent", foreground: "bg-foreground", neutral: "bg-grey-600", subtle: "bg-subtle", info: "bg-info", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
/** Default series colours: the highlight (first) series orange, then greys. Pass `tone` on a series to choose. */
const SERIES: Tone[] = ["accent", "neutral", "subtle"];

export type Series = { label: string; values: number[]; tone?: Tone };

const PAD = { top: 10 };

/**
 * The top of the axis: a round number at or above the largest value whose half (the middle grid line) is round too,
 * so a count axis never reads 0, 3, 5 with its middle line at 2.5. Whole-number data gets a whole-number middle.
 */
function niceMax(values: number[]) {
  const v = Math.max(0, ...values);
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  const max = step * p;
  return values.every(Number.isInteger) && max < 2 ? 2 : max;
}

/** A legend row: dot, label, value. Shared by every chart so the reading order is the same everywhere. */
export function Legend({ items, className }: { items: { label: string; value: React.ReactNode; tone?: Tone; share?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-1.5 text-meta", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", DOT[it.tone ?? "neutral"])} aria-hidden />
          <span className="font-normal text-secondary">{it.label}</span>
          <span className="font-medium tabular-nums text-foreground">{it.value}</span>
          {it.share !== undefined ? <span className="font-normal tabular-nums text-subtle">{it.share}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/*
  Layout of the two axis charts. The text is HTML, not SVG <text>: an SVG scaled to the card's width scales its text
  with it (a 600-unit chart in a 1,100px card drew 22px axis labels), so the labels, the axis and the "nothing yet"
  line stay 12–13px at any width. Only the marks are drawn: bars as boxes, lines in an SVG stretched over the plot
  area with non-scaling strokes. `height` is the whole chart, labels included.
*/
const LABEL_ROW = 22; // the x labels under the plot: 6px gap + 16px line

/** The y axis: three tick labels (0, half, max) right-aligned in a column as wide as the longest of them. */
function YAxis({ max, format, isEmpty }: { max: number; format: (n: number) => string; isEmpty: boolean }) {
  const ticks = isEmpty ? [0] : [0, 0.5, 1];
  return (
    <div aria-hidden className="relative shrink-0 pr-2 text-right text-xs font-normal tabular-nums text-subtle" style={{ marginBottom: LABEL_ROW }}>
      <span className="invisible block h-0 overflow-hidden whitespace-nowrap">{format(max)}</span>
      {ticks.map((t) => <span key={t} className="absolute right-2 translate-y-1/2 whitespace-nowrap" style={{ bottom: `${t * 100}%` }}>{format(max * t)}</span>)}
    </div>
  );
}

/** The three hairline grid lines across the plot area. */
function Grid() {
  return <>{[0, 0.5, 1].map((t) => <span key={t} aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${t * 100}%` }} />)}</>;
}

/** Which x labels to print: all of them up to 16, beyond that about ten, always keeping `keep` (the lit bar, the last). */
function labelIndexes(n: number, keep: number[]) {
  if (n <= 16) return new Set(Array.from({ length: n }, (_, i) => i));
  const step = Math.ceil(n / 10);
  const kept = keep.filter((k) => k >= 0 && k < n);
  const out = new Set(kept);
  for (let i = 0; i < n; i += step) if (kept.every((k) => Math.abs(k - i) > 1)) out.add(i);
  return out;
}

/** Lines over time. The first series carries a faint flat fill. Labels at the start, the middle and the end. */
export function AreaChart({ labels, series, height = 170, format = (n: number) => String(n), title, className, empty = "Nothing recorded yet.", legend = true }: { labels: string[]; series: Series[]; height?: number; format?: (n: number) => string; title: string; className?: string; empty?: string; legend?: boolean }) {
  const n = labels.length;
  const max = niceMax(series.flatMap((s) => s.values));
  const isEmpty = series.every((s) => s.values.every((v) => v === 0));
  // Plot coordinates: x 0..100 across, y 0..100 down; the SVG is stretched over the plot area.
  const x = (i: number) => (n <= 1 ? 0 : (i * 100) / (n - 1));
  const y = (v: number) => 100 * (1 - v / max);
  const labelAt = n <= 1 ? [0] : n <= 7 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const tone = (s: Series, si: number) => s.tone ?? SERIES[si % SERIES.length];
  return (
    <div className={className}>
      <div role="img" aria-label={title} className="flex" style={{ height, paddingTop: PAD.top }}>
        <YAxis max={max} format={format} isEmpty={isEmpty} />
        <div className="relative min-w-0 flex-1" style={{ marginBottom: LABEL_ROW }}>
          <Grid />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {series.map((s, si) => {
              const line = `M${s.values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L")}`;
              const c = COLOR[tone(s, si)];
              return (
                <g key={s.label}>
                  {si === 0 && !isEmpty ? <path d={`${line} L${x(n - 1).toFixed(2)},100 L${x(0).toFixed(2)},100 Z`} fill={c} fillOpacity={0.06} /> : null}
                  <path d={line} fill="none" stroke={c} strokeWidth={si === 0 ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={isEmpty ? 0.35 : 1} />
                </g>
              );
            })}
          </svg>
          {/* The points: a hover target per value with its reading, the last one marked. HTML so they stay round. */}
          {!isEmpty ? series.map((s, si) => s.values.map((v, i) => (
            <span key={`${s.label}-${i}`} title={`${labels[i]}: ${format(v)} ${s.label.toLowerCase()}`} className="absolute grid size-3 -translate-x-1/2 -translate-y-1/2 place-items-center" style={{ left: `${x(i)}%`, top: `${y(v)}%` }}>
              {i === n - 1 ? <span className="size-1.5 rounded-full" style={{ background: COLOR[tone(s, si)] }} /> : null}
            </span>
          ))) : null}
          {isEmpty ? <p className="absolute inset-0 grid place-items-center px-4 text-center text-meta font-normal text-subtle">{empty}</p> : null}
          <div aria-hidden className="absolute inset-x-0 top-full pt-1.5 text-xs font-normal text-subtle">
            {labelAt.map((i) => <span key={i} className={cn("absolute whitespace-nowrap", i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${x(i)}%` }}>{labels[i]}</span>)}
          </div>
        </div>
      </div>
      {legend ? <Legend className="mt-3" items={series.map((s, si) => ({ label: s.label, value: format(s.values.reduce((a, b) => a + b, 0)), tone: tone(s, si) }))} /> : null}
    </div>
  );
}

/**
 * Vertical bars, one per bucket, a label under each (about ten when there are many). Grey bars with one orange
 * highlight: `highlight` is the index to light (the current period; the last bar by default; -1 for none). `tone`
 * colours every bar instead.
 */
export function BarChart({ labels, values, tone, highlight, height = 170, format = (n: number) => String(n), title, className, empty = "Nothing recorded yet." }: { labels: string[]; values: number[]; tone?: Tone; highlight?: number; height?: number; format?: (n: number) => string; title: string; className?: string; empty?: string }) {
  const n = values.length;
  const max = niceMax(values);
  const isEmpty = values.every((v) => v === 0);
  const lit = tone ? -1 : (highlight ?? n - 1);
  const shown = labelIndexes(n, [lit, n - 1]);
  return (
    <div className={className}>
      <div role="img" aria-label={title} className="flex" style={{ height, paddingTop: PAD.top }}>
        <YAxis max={max} format={format} isEmpty={isEmpty} />
        <div className="relative min-w-0 flex-1" style={{ marginBottom: LABEL_ROW }}>
          <Grid />
          <div className="absolute inset-0 flex">
            {values.map((v, i) => (
              <div key={i} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                {isEmpty ? null : (
                  <span
                    title={`${labels[i]}: ${format(v)}`}
                    className="block w-3/5 max-w-7 rounded-[4px]"
                    style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : "2px", background: COLOR[tone ?? (i === lit ? "accent" : "neutral")], opacity: v === 0 ? 0.25 : i === lit || tone ? 1 : 0.55 }}
                  />
                )}
                {shown.has(i) ? (
                  <span aria-hidden className={cn("absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap pt-1.5 text-xs font-normal tabular-nums", i === lit ? "text-foreground" : "text-subtle")}>{labels[i]}</span>
                ) : null}
              </div>
            ))}
          </div>
          {isEmpty ? <p className="absolute inset-0 grid place-items-center px-4 text-center text-meta font-normal text-subtle">{empty}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** A ring of shares with the total in the middle and a legend beside it. Zero totals draw a quiet grey ring. */
export function Donut({ items, centre, format = (n: number) => String(n), title, className }: { items: { label: string; value: number; tone: Tone }[]; centre?: { value: React.ReactNode; label: string }; format?: (n: number) => string; title: string; className?: string }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = 44; const c = 2 * Math.PI * r;
  const arcs = items.filter((it) => it.value > 0).reduce<{ label: string; tone: Tone; value: number; dash: string; offset: number }[]>((acc, it) => {
    const len = (it.value / total) * c;
    const offset = acc.length ? acc[acc.length - 1].offset + (acc[acc.length - 1].value / total) * c : 0;
    return [...acc, { ...it, dash: `${len} ${c - len}`, offset }];
  }, []);
  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label={title}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--fill-150)" strokeWidth={10} />
        {arcs.map((a) => <circle key={a.label} cx="60" cy="60" r={r} fill="none" stroke={COLOR[a.tone]} strokeWidth={10} strokeDasharray={a.dash} strokeDashoffset={-a.offset} transform="rotate(-90 60 60)"><title>{`${a.label}: ${format(a.value)}`}</title></circle>)}
        <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--foreground)" className="tabular-nums">{centre?.value ?? format(total)}</text>
        <text x="60" y="74" textAnchor="middle" fontSize="10.5" fontWeight="500" fill="var(--subtle)">{(centre?.label ?? "Total").replace(/^\w/, (ch) => ch.toUpperCase())}</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-meta">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[it.tone])} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-normal text-secondary">{it.label}</span>
            <span className="font-medium tabular-nums text-foreground">{format(it.value)}</span>
            <span className="w-10 text-right tabular-nums text-subtle">{total ? `${Math.round((it.value / total) * 100)}%` : "–"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One horizontal bar split by share, with a legend under it. For status splits and funnels. */
export function SegmentBar({ items, format = (n: number) => String(n), title, className }: { items: { label: string; value: number; tone: Tone }[]; format?: (n: number) => string; title: string; className?: string }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  return (
    <div className={className}>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-fill-1" role="img" aria-label={title}>
        {total ? items.filter((it) => it.value > 0).map((it) => <span key={it.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", DOT[it.tone])} style={{ width: `${(it.value / total) * 100}%` }} title={`${it.label}: ${format(it.value)}`} />) : null}
      </div>
      <Legend className="mt-2.5" items={items.map((it) => ({ label: it.label, value: format(it.value), tone: it.tone, share: total ? `${Math.round((it.value / total) * 100)}%` : undefined }))} />
    </div>
  );
}

/** A tiny line for a stat card or a table cell: no axis, the last point (now) marked in orange. */
export function Sparkline({ values, tone = "foreground", width = 96, height = 28, label, className }: { values: number[]; tone?: Tone; width?: number; height?: number; label: string; className?: string }) {
  const mark = tone === "foreground" || tone === "neutral" || tone === "subtle" ? "accent" : tone;
  const n = values.length;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i: number) => (n <= 1 ? width / 2 : 2 + (i * (width - 4)) / (n - 1));
  const y = (v: number) => 2 + (height - 4) * (1 - (v - min) / (max - min || 1));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn("shrink-0 overflow-visible", className)}>
      {n ? <path d={d} fill="none" stroke={COLOR[tone]} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {n ? <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2.5} fill={COLOR[mark]} /> : null}
    </svg>
  );
}
