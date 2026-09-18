import * as React from "react";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/ui/back-link";

export function Card({ className, glow, ...props }: React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return <div className={cn("tile p-5", glow && "tile-glow", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-display text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Small line above a title. Use it for information (a date, a scope), not for a category label. */
export function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm font-medium text-accent", className)}>{children}</p>;
}

/**
 * A ledger line: figures in a row, each a display number with a sentence-case label beneath.
 * One strip of facts reads faster than a grid of identical boxes and keeps the page's real hero on top.
 */
export function Ledger({ items, className }: { items: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: "default" | "accent" | "danger" }[]; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-10 gap-y-4 border-y border-border-soft py-5", className)}>
      {items.map((it) => {
        const value = <dd className={cn("font-display text-3xl tabular-nums md:text-4xl", it.tone === "accent" ? "text-accent" : it.tone === "danger" ? "text-danger" : "text-fg")}>{it.value}</dd>;
        const body = <><dt className="text-sm text-fg-muted">{it.label}</dt>{value}{it.note ? <dd className="text-xs text-fg-subtle">{it.note}</dd> : null}</>;
        return <div key={it.label} className="min-w-[8rem]">{it.href ? <a href={it.href} className="block rounded-[var(--radius-sm)] hover:text-accent">{body}</a> : body}</div>;
      })}
    </dl>
  );
}

export function PageHeader({ overline, title, description, actions, back }: { overline?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="glow-header mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back ? <BackLink href={back.href} label={back.label} /> : null}
        {overline ? <Overline className="mb-2">{overline}</Overline> : null}
        <h1 className="text-balance text-3xl md:text-4xl font-display text-fg">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-pretty text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
