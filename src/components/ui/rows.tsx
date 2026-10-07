import Link from "next/link";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/states";
import { CountPill } from "@/components/ui/badge";
import type { Icon3DName } from "@/components/ui/icon";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

/**
 * Lists, v4 (spec §7 Lists): rows are separated by spacing, never lines.
 *
 * `ListRow`: the 64px row: a 40px leading thumb (an Avatar size 40, or a ToolSquare), the title 14/20 semibold
 * (truncates), a subtitle 13/19.5 regular in the secondary grey, an optional meta line (13px, secondary; put a
 * CountPill in it), and a trailing slot (a value, a Badge, a ghost "…" IconButton). As a link (`href`) or a button
 * (`onClick`) the whole row takes a fill-1 plate on hover. `active` (the selected row: the open item, the current page)
 * keeps the fill-1 plate and adds the 2px orange marker on its left edge (accent rules, 6 October 2026). A lucide icon
 * given as `trailing` (the usual ChevronRight) plays its animated twin while the row is hovered or focused.
 *
 * `SubNavItem`: a sub-navigation item (settings sections, doc folders, past chats): 32px, px8, r8, a 16px icon, the
 * label, an optional count; hover fill-0; the chosen one (`active`) fill-1, the foreground and the orange marker. The
 * look is the `.subnav-item` class (globals.css), so a hand-built item can use it with aria-current or data-selected.
 * Its lucide `icon` plays its animated twin on hover, keyboard focus and once when it becomes the current page.
 *
 * `RowList` / `Row`: the denser v3 list (40px rows, 14px title, 13px meta), kept with the same props, now without lines.
 */
export function ListRow({ leading, title, subtitle, meta, trailing, href, onClick, className, active = false }: { leading?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode; href?: string; onClick?: () => void; className?: string; active?: boolean }) {
  const body = (
    <>
      {leading ? <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {subtitle ? <p className="truncate text-meta font-normal text-secondary">{subtitle}</p> : null}
        {meta ? <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-meta font-normal text-secondary">{meta}</div> : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2 text-sm tabular-nums text-secondary">{withAnimatedIcons(trailing)}</div> : null}
    </>
  );
  const cls = cn("flex min-h-16 w-full items-center gap-3 rounded-xl px-2 py-3 text-left", (href || onClick) && "transition-colors duration-75 hover:bg-fill-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]", active && "selected-marker bg-fill-1", className);
  if (href) return <li className="list-none"><Link href={href} className={cls} aria-current={active ? "page" : undefined}>{body}</Link></li>;
  if (onClick) return <li className="list-none"><button type="button" onClick={onClick} className={cls} aria-pressed={active || undefined}>{body}</button></li>;
  return <li className={cn("list-none", cls)}>{body}</li>;
}

export function SubNavItem({ children, icon, href, onClick, active = false, count, attention = false, trailing, className, ...rest }: {
  children: React.ReactNode; icon?: React.ReactNode; href?: string; onClick?: () => void; active?: boolean;
  /** A count after the label; `attention` draws it orange (unread, waiting). */ count?: number; attention?: boolean;
  trailing?: React.ReactNode; className?: string; "aria-controls"?: string; title?: string;
}) {
  const body = (
    <>
      {withAnimatedIcons(icon)}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count ? <CountPill count={count} tone={attention ? "attention" : "neutral"} /> : null}
      {trailing}
    </>
  );
  const cls = cn("subnav-item", className);
  return href
    ? <Link href={href} aria-current={active ? "page" : undefined} className={cls} {...rest}>{body}</Link>
    : <button type="button" onClick={onClick} aria-current={active ? "true" : undefined} className={cls} {...rest}>{body}</button>;
}

export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn("space-y-0.5", className)}>{children}</ul>;
}

export function Row({ leading, title, meta, trailing, href, className }: { leading?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {meta ? <p className="truncate text-meta font-normal text-secondary">{meta}</p> : null}
      </div>
      {trailing ? <div className="shrink-0 text-right text-meta font-normal tabular-nums text-secondary">{trailing}</div> : null}
    </>
  );
  const cls = cn("flex items-center gap-3 px-2 py-2", href && "-mx-2 rounded-[10px] transition-colors duration-75 hover:bg-fill-1", className);
  return <li>{href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/** The empty row: a line icon and a short line, never a bare "None." */
export function RowEmpty({ title = "Nothing here yet", icon3d = "box-doc-check", description }: { title?: string; icon3d?: Icon3DName; description?: string }) {
  return <li><EmptyState compact icon3d={icon3d} title={title} description={description} /></li>;
}
