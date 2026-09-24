import { cn } from "@/lib/utils";
import { Icon3D, type Icon3DName } from "@/components/ui/icon";

/**
 * A hairline grid: cells separated by 1px lines drawn from the gap, inside one rounded border. For sets of
 * equal things (rules, features, settings groups). Cells lift their icon and warm their title on hover.
 */
export function HairlineGrid({ children, className, cols = 3 }: { children: React.ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  return <div className={cn("hairline-grid", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}

export function GridCell({ icon, title, children, className, href }: { icon?: Icon3DName; title: React.ReactNode; children?: React.ReactNode; className?: string; href?: string }) {
  const body = (
    <>
      {icon ? <Icon3D name={icon} size={48} /> : null}
      <h3 className={cn("text-[17px] font-semibold text-fg", icon && "mt-4")}>{title}</h3>
      {children ? <div className="mt-1.5 text-pretty text-sm leading-relaxed text-fg-muted">{children}</div> : null}
    </>
  );
  return href ? <a href={href} className={cn("hairline-cell", className)}>{body}</a> : <div className={cn("hairline-cell", className)}>{body}</div>;
}
