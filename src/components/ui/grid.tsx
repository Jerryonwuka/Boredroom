import { cn } from "@/lib/utils";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { ToolSquare } from "@/components/ui/tool-tile";

/**
 * A hairline grid: cells separated by 1px lines drawn from the gap, inside one r16 border. For sets of equal things
 * (rules, features, settings groups). v4: each cell has an optional line icon in a tool square, a 14/20 semibold title
 * and a 14/20 description in the secondary grey; a linked cell takes a faint fill on hover.
 */
export function HairlineGrid({ children, className, cols = 3 }: { children: React.ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  return <div className={cn("grid gap-px overflow-hidden rounded-2xl border border-border bg-border", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}

export function GridCell({ icon, title, children, className, href }: { icon?: Icon3DName; title: React.ReactNode; children?: React.ReactNode; className?: string; href?: string }) {
  const Line = icon ? LINE_ICON[icon] : null;
  const body = (
    <>
      {Line ? <ToolSquare><Line strokeWidth={1.75} /></ToolSquare> : null}
      <h3 className={cn("text-sm font-semibold text-foreground", Line && "mt-4")}>{title}</h3>
      {children ? <div className="mt-1 text-pretty text-sm font-normal text-secondary">{children}</div> : null}
    </>
  );
  const cell = "relative block bg-background p-6";
  return href
    ? <a href={href} className={cn(cell, "transition-colors duration-75 hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))]", className)}>{body}</a>
    : <div className={cn(cell, className)}>{body}</div>;
}
