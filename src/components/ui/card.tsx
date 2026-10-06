import * as React from "react";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/ui/back-link";
import { Tabs, type Tab } from "@/components/ui/tabs";
import type { Icon3DName } from "@/components/ui/icon";

/**
 * Cards, v4 (spec §7). Hairlines, not shadows; the canvas colour, not glass.
 * - `panel` (default): r16 p20, canvas colour, hairline, the chart card's soft shadow. Most cards.
 * - `section`: r24 p24, fill-0, hairline. A big "hero" section of a page.
 * - `stat`: r12 p20, canvas colour, hairline, natural-xs shadow. Use StatCard for figures.
 * - `tint`: r16 p12, accent at 10% with a hairline. A rare notice (the sidebar's plan card).
 * - `plain`: r16, hairline, no padding (a table or a list that runs to the card's edges).
 * Padding utilities passed in `className` win over the variant's.
 */
export type CardVariant = "panel" | "section" | "stat" | "tint" | "plain";
const VARIANT: Record<CardVariant, string> = { panel: "card-panel", section: "card-section", stat: "card-stat", tint: "card-tint", plain: "card-panel p-0" };

export function Card({ className, glow, variant = "panel", ...props }: React.HTMLAttributes<HTMLDivElement> & { /** The one live card on a screen: a warmer hairline. */ glow?: boolean; variant?: CardVariant }) {
  return <div data-card data-flush={variant === "plain" || undefined} className={cn(VARIANT[variant], glow && "border-accent/40", className)} {...props} />;
}

export function SectionCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card variant="section" className={className} {...props} />;
}

/** The analytics/chart card surface (r16 p20). AnalyticsCard adds the metric strip. */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card variant="panel" className={className} {...props} />;
}
export const ChartCard = Panel;

/**
 * A card's title row: the title (18/26 semibold, or 14/20 with `size="sm"`), an optional description in the secondary
 * grey, and an action on the right that wraps under the title on a narrow card.
 */
export function CardHeader({ title, description, action, className, size = "md", as: Tag = "h2" }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; size?: "sm" | "md"; as?: "h2" | "h3" }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2", className)}>
      <div className="min-w-0 flex-[1_1_14rem]">
        <Tag className={cn("text-foreground", size === "sm" ? "text-sm font-semibold" : "type-section-title")}>{title}</Tag>
        {description ? <p className="mt-0.5 text-sm font-normal text-secondary">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A section heading outside a card (spec: 18/26 semibold, 14px below it): "Recent", "Your day". Optional description
 * and an action on the right (a ghost "View all" button).
 */
export function SectionTitle({ title, description, action, className, id, as: Tag = "h2" }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; id?: string; as?: "h2" | "h3" }) {
  return (
    <div className={cn("mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <Tag id={id} className="type-section-title">{title}</Tag>
        {description ? <p className="mt-0.5 text-sm font-normal text-secondary">{description}</p> : null}
      </div>
      {/* -3px top and bottom: a 32px action sits in the title's 26px line, so a title with an action lines up with
          one without (two sections side by side). */}
      {action ? <div className="-my-[3px] flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Small line above a title: a date, a scope. 12/16 medium, secondary. Never tracked capitals. */
export function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("type-caption", className)}>{children}</p>;
}

/** Micro information: a sync time, a date, a count of things. 12/16 medium, subtle. */
export function Eyebrow({ children, className, as: Tag = "p" }: { children: React.ReactNode; className?: string; as?: "p" | "span" | "div" }) {
  return <Tag className={cn("type-caption text-subtle", className)}>{children}</Tag>;
}

/**
 * A row of figures as stat cards: label (14/20 medium, secondary) over the value (24/30 bold). `note` is a 13px line
 * under the value; `href` makes the card a link. Two across on a phone, four from md.
 */
export function Ledger({ items, className }: { items: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: "default" | "accent" | "danger" }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
      {items.map((it) => {
        const body = (
          <>
            <dt className="truncate text-sm font-medium text-secondary">{it.label}</dt>
            <dd className={cn("type-stat mt-1", it.tone === "accent" && "text-accent", it.tone === "danger" && "text-danger")}>{it.value}</dd>
            {it.note ? <dd className="mt-1 truncate text-meta font-normal text-secondary">{it.note}</dd> : null}
          </>
        );
        return it.href
          ? <a key={it.label} href={it.href} className="card-stat block min-w-0">{body}</a>
          : <div key={it.label} className="card-stat min-w-0">{body}</div>;
      })}
    </dl>
  );
}

/**
 * The page header (spec §6): the page title in the display face (24/30), actions on the right (small outline buttons,
 * one primary at most), an optional description and meta line, then an optional row of underline tabs on a full-width
 * hairline. `nav` replaces the tabs with any row (a sub-nav, a filter bar). `divider` draws the hairline without tabs.
 * Link tabs (`href`) switch pages; value tabs switch `?{tabParam}=`; `onTabChange` (client callers) switches local state.
 */
export function PageHeader({ overline, title, description, meta, actions, back, tabs, tabValue, tabParam, onTabChange, tabsLabel, nav, divider = false, className }: {
  overline?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode;
  /** Micro information under the description (sync time, zone). */ meta?: React.ReactNode;
  actions?: React.ReactNode; back?: { href: string; label: string };
  /** Kept so v3 callers compile; v4 page headers carry no icon. */ icon?: Icon3DName;
  tabs?: Tab[]; tabValue?: string; tabParam?: string; onTabChange?: (v: string) => void; tabsLabel?: string;
  nav?: React.ReactNode; divider?: boolean; className?: string;
}) {
  return (
    <header className={cn("mb-8", divider && !tabs && !nav && "border-b border-border pb-5", className)}>
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      {overline ? <Overline className="mb-1">{overline}</Overline> : null}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="type-page-title min-w-0 break-words">{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-1 max-w-2xl text-sm font-normal text-secondary">{description}</p> : null}
      {meta ? <p className="type-caption mt-1.5 text-subtle">{meta}</p> : null}
      {tabs ? <Tabs className="mt-5" tabs={tabs} value={tabValue} param={tabParam} onChange={onTabChange} label={tabsLabel ?? "Sections"} /> : null}
      {!tabs && nav ? <div className="mt-5">{nav}</div> : null}
    </header>
  );
}
