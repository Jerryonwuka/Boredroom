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

export function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[12px] font-semibold uppercase tracking-[0.3em] text-accent/70", className)}>{children}</p>;
}

export function PageHeader({ overline, title, description, actions, back }: { overline?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="glow-header mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back ? <BackLink href={back.href} label={back.label} /> : null}
        {overline ? <Overline className="mb-2">{overline}</Overline> : null}
        <h1 className="text-3xl md:text-4xl font-display text-fg">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
