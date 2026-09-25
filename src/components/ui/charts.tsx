import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts for the Control Center: plain SVG, server-rendered, coloured by the design tokens.
 * Each one degrades to a quiet "nothing yet" state when every value is zero, so an empty platform never shows a
 * broken axis. Values arrive already counted; the charts do no maths beyond scaling.
 */

export type Tone = "accent" | "info" | "success" | "warning" | "danger" | "neutral";
const COLOR: Record<Tone, string> = { accent: "var(--accent)", info: "var(--info)", success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)", neutral: "var(--fg-subtle)" };
const DOT: Record<Tone, string> = { accent: "bg-accent", info: "bg-info", success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-fg-subtle" };

export type Series = { label: string; values: number[]; tone?: Tone };

const W = 600;
const PAD = { top: 10, right: 8, bottom: 22, left: 34 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** A legend row: dot, label, value. Shared by every chart so the reading order is the same everywhere. */
export function Legend({ items, className }: { items: { label: string; value: React.ReactNode; tone?: Tone; share?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-1.5 text-sm", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[it.tone ?? "neutral"])} aria-hidden />
          <span className="text-fg-muted">{it.label}</span>
          <span className="tabular-nums text-fg">{it.value}</span>
          {it.share !== undefined ? <span className="tabular-nums text-fg-subtle">{it.share}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Lines over time with a soft fill under the first series. Labels are shown at the start, the middle and the end. */
export function AreaChart({ labels, series, height = 170, format = (n: number) => String(n), title, className, empty = "Nothing recorded yet." }: { labels: string[]; series: Series[]; height?: number; format?: (n: number) => string; title: string; className?: string; empty?: string }) {
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const isEmpty = series.every((s) => s.values.every((v) => v === 0));
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (n - 1));
  const y = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - v / max);
  const base = height - PAD.bottom;
  const ticks = [0, 0.5, 1];
  const labelAt = n <= 1 ? [0] : n <= 7 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const gradId = `area-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        <defs><linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: COLOR[series[0]?.tone ?? "accent"], stopOpacity: 0.28 }} /><stop offset="1" style={{ stopColor: COLOR[series[0]?.tone ?? "accent"], stopOpacity: 0 }} /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={PAD.left} x2={W - PAD.right} y1={y(max * t)} y2={y(max * t)} stroke="var(--border-soft)" strokeWidth={1} />{!isEmpty || t === 0 ? <text x={PAD.left - 8} y={y(max * t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-subtle)" className="tabular-nums">{format(max * t)}</text> : null}</g>)}
        {labelAt.map((i) => <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--fg-subtle)">{labels[i]}</text>)}
        {isEmpty ? <text x={PAD.left + (W - PAD.left - PAD.right) / 2} y={PAD.top + (base - PAD.top) / 2} textAnchor="middle" fontSize={13} fill="var(--fg-subtle)">{empty}</text> : null}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          const line = `M${pts.join(" L")}`;
          return (
            <g key={s.label}>
              {si === 0 && !isEmpty ? <path d={`${line} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`} fill={`url(#${gradId})`} /> : null}
              <path d={line} fill="none" stroke={COLOR[s.tone ?? (si === 0 ? "accent" : "info")]} strokeWidth={si === 0 ? 2.25 : 1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={isEmpty ? 0.4 : 1} />
              {!isEmpty ? s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={COLOR[s.tone ?? (si === 0 ? "accent" : "info")]}><title>{`${labels[i]}: ${format(v)} ${s.label.toLowerCase()}`}</title></circle>) : null}
            </g>
          );
        })}
      </svg>
      <Legend className="mt-3" items={series.map((s, si) => ({ label: s.label, value: format(s.values.reduce((a, b) => a + b, 0)), tone: s.tone ?? (si === 0 ? "accent" : "info") }))} />
    </div>
  );
}

/** Vertical bars, one per bucket, with every label under its bar. Used for money by month. */
export function BarChart({ labels, values, tone = "accent", height = 170, format = (n: number) => String(n), title, className, empty = "Nothing recorded yet." }: { labels: string[]; values: number[]; tone?: Tone; height?: number; format?: (n: number) => string; title: string; className?: string; empty?: string }) {
  const n = values.length;
  const max = niceMax(Math.max(0, ...values));
  const isEmpty = values.every((v) => v === 0);
  const inner = W - PAD.left - PAD.right;
  const slot = inner / Math.max(1, n);
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - v / max);
  const base = height - PAD.bottom;
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={PAD.left} x2={W - PAD.right} y1={y(max * t)} y2={y(max * t)} stroke="var(--border-soft)" strokeWidth={1} />{!isEmpty || t === 0 ? <text x={PAD.left - 8} y={y(max * t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-subtle)" className="tabular-nums">{format(max * t)}</text> : null}</g>)}
        {values.map((v, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = Math.max(isEmpty ? 0 : 2, base - y(v));
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={base - h} width={bw} height={h} rx={4} fill={COLOR[tone]} opacity={v === 0 ? 0.25 : 1}><title>{`${labels[i]}: ${format(v)}`}</title></rect>
              <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--fg-subtle)">{labels[i]}</text>
            </g>
          );
        })}
        {isEmpty ? <text x={PAD.left + inner / 2} y={PAD.top + (base - PAD.top) / 2} textAnchor="middle" fontSize={13} fill="var(--fg-subtle)">{empty}</text> : null}
      </svg>
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
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--wash)" strokeWidth={12} />
        {arcs.map((a) => <circle key={a.label} cx="60" cy="60" r={r} fill="none" stroke={COLOR[a.tone]} strokeWidth={12} strokeDasharray={a.dash} strokeDashoffset={-a.offset} transform="rotate(-90 60 60)"><title>{`${a.label}: ${format(a.value)}`}</title></circle>)}
        <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--fg)" className="font-display tabular-nums">{centre?.value ?? format(total)}</text>
        <text x="60" y="74" textAnchor="middle" fontSize="10" fill="var(--fg-subtle)" letterSpacing="0.08em">{(centre?.label ?? "total").toUpperCase()}</text>
      </svg>
      <ul className="min-w-0 flex-1 divide-y divide-border-soft text-sm">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2.5 py-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[it.tone])} aria-hidden />
            <span className="flex-1 truncate text-fg">{it.label}</span>
            <span className="tabular-nums text-fg-muted">{format(it.value)}</span>
            <span className="w-12 text-right tabular-nums text-fg">{total ? `${Math.round((it.value / total) * 100)}%` : "—"}</span>
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
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-wash-strong" role="img" aria-label={title}>
        {total ? items.filter((it) => it.value > 0).map((it) => <span key={it.label} className={cn("h-full", DOT[it.tone])} style={{ width: `${(it.value / total) * 100}%` }} title={`${it.label}: ${format(it.value)}`} />) : null}
      </div>
      <Legend className="mt-2.5" items={items.map((it) => ({ label: it.label, value: format(it.value), tone: it.tone, share: total ? `${Math.round((it.value / total) * 100)}%` : undefined }))} />
    </div>
  );
}
