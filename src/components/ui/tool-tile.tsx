import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tool tiles and quick links, v4 (spec §6 Home, §7 "List tile").
 *
 * `ToolSquare`: the 40×40 r12 square that holds a tool's icon: fill-1 over the canvas, darkening slightly towards the
 * bottom (fill-1 → fill-150, the one measured gradient in the app; barely visible), a 7.5% ring and the natural
 * shadow, the 20px icon in grey-600. `tone="accent"`: the orange-tinted square with an orange icon (the empty-state
 * look), for the rare thumb that marks something live or new.
 *
 * `ToolTile`: the square with its label (14/20 medium, foreground) 10px under it, at least 81px wide, the label on one
 * line. On hover a r16 fill-1 plate appears behind the whole tile, reaching 8px above/below and 14px to the sides, and
 * the icon turns orange (also on keyboard focus and while `active`; accent rules, 6 October 2026). A button (`onClick`)
 * or a link (`href`). On Brenda's home these fill the prompt box with a suggestion; they never send.
 *
 * `ToolTileRow`: lays the tiles out in equal columns as wide as the widest label, so the squares are evenly spaced
 * (owner request, 6 October 2026), centred; one row when it fits, else a balanced grid of three (globals.css
 * `.tool-tile-grid` has the widths). Keep labels short (up to about 13 characters, 110px).
 *
 * `QuickLink`: the list tile: h56 p16 r12 outline, a 24px icon in the secondary grey, a 14/20 medium label.
 */
export function ToolSquare({ children, size = 40, tone = "neutral", className }: { children: React.ReactNode; size?: number; tone?: "neutral" | "accent"; className?: string }) {
  if (tone === "accent") {
    return (
      <span aria-hidden className={cn("relative grid shrink-0 place-items-center rounded-xl bg-accent-tint text-accent-text shadow-[0_0_0_1px_var(--border)] [&_svg]:size-5", className)} style={{ width: size, height: size }}>
        {children}
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative grid shrink-0 place-items-center rounded-xl bg-background text-grey-600 shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)] [&_svg]:size-5", className)}
      style={{ width: size, height: size, backgroundImage: "linear-gradient(to bottom, var(--fill-1), var(--fill-150))" }}>
      {children}
    </span>
  );
}

type ToolTileProps = { icon: React.ReactNode; label: React.ReactNode; href?: string; className?: string; active?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function ToolTile({ icon, label, href, className, active = false, type = "button", ...button }: ToolTileProps) {
  const cls = cn(
    "group relative isolate flex min-w-[81px] shrink-0 flex-col items-center gap-2.5 rounded-2xl text-center text-sm font-medium text-foreground outline-none",
    "before:absolute before:-inset-x-3.5 before:-inset-y-2 before:-z-10 before:rounded-2xl before:bg-fill-1 before:opacity-0 before:transition-opacity before:duration-75 hover:before:opacity-100",
    "focus-visible:before:opacity-100 focus-visible:before:outline-2 focus-visible:before:outline-offset-0 focus-visible:before:outline-[var(--ring)]",
    active && "before:opacity-100",
    className,
  );
  const body = (
    <>
      <ToolSquare className={cn("transition-colors duration-75 group-hover:text-accent group-focus-visible:text-accent", active && "text-accent")}>{icon}</ToolSquare>
      <span className="w-full whitespace-nowrap leading-5">{label}</span>
    </>
  );
  return href
    ? <Link href={href} className={cls} aria-current={active ? "page" : undefined}>{body}</Link>
    : <button type={type} className={cls} aria-pressed={active || undefined} {...button}>{body}</button>;
}

/**
 * A row of tool tiles: equal columns sized to the widest label, centred, 16px apart in one row; on a narrow row a
 * balanced grid of three (two for four tiles), 10px apart with 20px between rows, its short last row centred. The
 * outer box is a container (it takes the full width it is given); the count picks the layout.
 */
export function ToolTileRow({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  const count = React.Children.toArray(children).length;
  return (
    <div className={cn("tool-tile-row", className)}>
      <div role={label ? "group" : undefined} aria-label={label} data-count={count} className="tool-tile-grid">{children}</div>
    </div>
  );
}

export function QuickLink({ icon, label, href, onClick, className, trailing }: { icon?: React.ReactNode; label: React.ReactNode; href?: string; onClick?: () => void; className?: string; trailing?: React.ReactNode }) {
  const cls = cn("flex h-14 min-w-0 items-center gap-2 rounded-xl border border-border-input bg-background p-4 text-sm font-medium text-foreground transition-colors duration-75 hover:border-border-input-hover hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&>svg:first-child]:-ml-[3px] [&>svg:first-child]:mr-0.5 [&>svg:first-child]:size-6 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-secondary", className);
  const body = (<>{icon}<span className="min-w-0 flex-1 truncate text-left">{label}</span>{trailing}</>);
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
