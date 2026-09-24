import * as React from "react";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/ui/back-link";
import { Rise } from "@/components/ui/motion";
import { IconTile, type Icon3DName } from "@/components/ui/icon";

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
 * For a verdict per figure (Good, Late, Needs a look) use StatCard instead.
 */
export function Ledger({ items, className }: { items: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: "default" | "accent" | "danger" }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4", className)}>
      {items.map((it) => {
        const value = <dd className={cn("mt-2 font-display text-4xl leading-none tabular-nums md:text-5xl", it.tone === "accent" ? "text-accent" : it.tone === "danger" ? "text-danger" : "text-fg")}>{it.value}</dd>;
        const body = <><dt className="text-sm text-fg-muted">{it.label}</dt>{value}{it.note ? <dd className="mt-2 truncate text-sm text-fg-subtle">{it.note}</dd> : null}</>;
        return it.href
          ? <a key={it.label} href={it.href} className="tile tile-link block min-w-0 p-4 md:p-5">{body}</a>
          : <div key={it.label} className="tile min-w-0 p-4 md:p-5">{body}</div>;
      })}
    </dl>
  );
}

/**
 * Page opener: an optional 3D icon in its lit tile, the title in the display face, one grey line beneath, actions
 * on the right. Same anatomy as a landing section title, left aligned and one size down.
 */
export function PageHeader({ overline, title, description, actions, back, icon }: { overline?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; icon?: Icon3DName }) {
  return (
    <Rise className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-4">
        {icon ? <IconTile name={icon} className="mt-1" /> : null}
        <div>
          {back ? <BackLink href={back.href} label={back.label} /> : null}
          {overline ? <Overline className="mb-2">{overline}</Overline> : null}
          <h1 className="text-balance font-display text-[30px] leading-[1.1] tracking-[-0.02em] text-fg md:text-[38px]">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-pretty text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </Rise>
  );
}
