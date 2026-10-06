"use client";

/**
 * The analytics card and its metric strip, v4 (spec §7 "Chart/analytics card"). The card is r16, the canvas colour, a
 * hairline and the chart shadow. Along its top runs a strip of metric tabs: each cell p16 on fill-0 with a 10% line
 * under it; the chosen one sits on the canvas colour with a 1.5px foreground line. Label 13/19.5 medium, subtle (the
 * foreground when chosen); value 18/26 medium, tabular. Under the strip, p20: an optional title row with a toolbar
 * (FilterControls, a Segmented), then the chosen metric's `content` (usually a chart).
 *
 * Works from server pages: pass each metric's chart as `content` (rendered on the server) and the card switches
 * between them on the client. With `href` on the metrics the strip links instead (the page reads the choice from the
 * URL), and `value` names the chosen one.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Metric = { key: string; label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; href?: string };

export function MetricStrip({ metrics, value, onChange, label = "Metrics", className, idBase, panelId }: {
  metrics: Metric[]; value?: string; onChange?: (key: string) => void; label?: string; className?: string;
  /** Ids for the tab ↔ panel link, set by AnalyticsCard. */ idBase?: string; panelId?: string;
}) {
  const interactive = !!onChange || metrics.some((m) => m.href);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    if (onChange && !metrics[next]?.href) onChange(metrics[next].key);
  };
  const cell = (active: boolean) => cn(
    "flex min-w-[9.5rem] flex-1 flex-col items-start gap-0.5 p-4 text-left transition-colors duration-75",
    active ? "bg-background shadow-[inset_0_-1.5px_0_var(--foreground)]" : "bg-fill-0 shadow-[inset_0_-1px_0_var(--border-input)]",
    interactive && !active && "hover:bg-fill-1",
    interactive && "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
  );
  const body = (m: Metric, active: boolean) => (
    <>
      <span className={cn("text-meta font-medium", active ? "text-foreground" : "text-subtle")}>{m.label}</span>
      <span className="type-metric">{m.value}</span>
      {m.hint ? <span className="text-xs font-normal text-secondary">{m.hint}</span> : null}
    </>
  );
  if (!interactive) {
    return (
      <dl className={cn("flex overflow-x-auto divide-x divide-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
        {metrics.map((m) => (
          <div key={m.key} className={cell(m.key === value)}>
            <dt className={cn("text-meta font-medium", m.key === value ? "text-foreground" : "text-subtle")}>{m.label}</dt>
            <dd className="type-metric">{m.value}</dd>
            {m.hint ? <dd className="text-xs font-normal text-secondary">{m.hint}</dd> : null}
          </div>
        ))}
      </dl>
    );
  }
  const current = value ?? metrics[0]?.key;
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex overflow-x-auto divide-x divide-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {metrics.map((m) => {
        const active = m.key === current;
        const common = { role: "tab" as const, "aria-selected": active, tabIndex: active ? 0 : -1, id: idBase ? `${idBase}-${m.key}` : undefined, "aria-controls": panelId, className: cell(active) };
        return m.href
          ? <Link key={m.key} href={m.href} scroll={false} {...common}>{body(m, active)}</Link>
          : <button key={m.key} type="button" onClick={() => onChange?.(m.key)} {...common}>{body(m, active)}</button>;
      })}
    </div>
  );
}

export function AnalyticsCard({ metrics, value, defaultValue, onChange, title, description, toolbar, children, className, label = "Metrics" }: {
  metrics: (Metric & { content?: React.ReactNode })[];
  /** Controlled choice; omit to let the card keep its own (starting at `defaultValue` or the first metric). */
  value?: string; defaultValue?: string; onChange?: (key: string) => void;
  title?: React.ReactNode; description?: React.ReactNode; toolbar?: React.ReactNode;
  /** Shown under the toolbar when the chosen metric has no `content` of its own. */ children?: React.ReactNode;
  className?: string; label?: string;
}) {
  const [inner, setInner] = React.useState(defaultValue ?? metrics[0]?.key);
  const current = value ?? inner;
  const uid = React.useId();
  const panelId = `${uid}-panel`;
  const chosen = metrics.find((m) => m.key === current);
  const linked = metrics.some((m) => m.href);
  const select = (key: string) => { if (value === undefined) setInner(key); onChange?.(key); };
  return (
    <section data-card className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-chart", className)}>
      <MetricStrip metrics={metrics} value={current} onChange={linked ? undefined : select} label={label} idBase={uid} panelId={panelId} />
      <div id={panelId} role={linked ? undefined : "tabpanel"} aria-labelledby={linked ? undefined : `${uid}-${current}`} className="p-5">
        {title || toolbar ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
              {description ? <p className="text-meta font-normal text-secondary">{description}</p> : null}
            </div>
            {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
          </div>
        ) : null}
        {chosen?.content ?? children}
      </div>
    </section>
  );
}
