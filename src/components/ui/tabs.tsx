"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SlidingMarker } from "@/components/ui/motion";
import { CountPill } from "@/components/ui/badge";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

export type Tab = { label: string; href?: string; value?: string; count?: number; /** The count asks for action (unread, waiting): an orange pill. */ attention?: boolean; icon?: React.ReactNode };

/**
 * Tabs, v4 (spec §6).
 * - `underline` (default): 14/20 medium, secondary → foreground when active, padding 4px 0 10px, ~24px apart; the
 *   active tab has a 1.5px ORANGE underline (accent rules, 6 October 2026; the label stays the foreground) that slides
 *   between tabs; the row sits on a full-width hairline (`bordered`, default true).
 * - `pills`: the sub-nav look in a row: 32px items, px8, r8; active fill-1 with the foreground, hover fill-0. Neutral:
 *   a vertical sub-nav (SubNavItem) carries the orange marker instead.
 * Link tabs (`href`) for pages that switch by URL; value tabs (`value`) switch `?{param}=` or call `onChange` for local
 * state. Counts sit in a CountPill (orange with `attention: true`). Arrow keys move between tabs; Home and End jump to
 * the ends. A tab's lucide `icon` plays its animated twin on hover and keyboard focus (components/ui/animated-icons).
 */
export function Tabs({ tabs, value, onChange, param = "tab", className, label = "Sections", variant = "underline", bordered = true }: { tabs: Tab[]; value?: string; onChange?: (v: string) => void; param?: string; className?: string; label?: string; variant?: "underline" | "pills"; bordered?: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const marker = `tabs-${React.useId()}`;
  const current = value ?? sp.get(param) ?? tabs[0]?.value ?? tabs[0]?.href;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  const underline = variant === "underline";
  // A page that knows its state passes `value`, so the default tab lights up even before the URL names it.
  const isActive = (t: Tab) => {
    const key = t.value ?? t.href ?? t.label;
    return value !== undefined && t.value ? value === t.value : t.href ? pathname === t.href || ((sp.get(param) ?? "") === (t.value ?? "") && !!t.value) : current === key;
  };
  const activeIndex = tabs.findIndex(isActive);
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown}
      className={cn("flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", underline ? cn("gap-6", bordered && "shadow-[inset_0_-1px_0_var(--border)]") : "gap-1", className)}>
      {tabs.map((t, i) => {
        const key = t.value ?? t.href ?? t.label;
        const active = i === activeIndex;
        // Roving focus: the active tab (or the first, when none is) is the one Tab stop; arrows move between them.
        const tabIndex = i === Math.max(0, activeIndex) ? 0 : -1;
        const inner = (
          <>
            {active && !underline ? <SlidingMarker layoutId={marker} className="absolute inset-0 rounded-lg bg-fill-1" /> : null}
            {t.icon ? <span className="relative inline-flex [&_svg]:size-4">{withAnimatedIcons(t.icon)}</span> : null}
            <span className="relative">{t.label}</span>
            {t.count ? <CountPill count={t.count} tone={t.attention ? "attention" : "neutral"} className="relative" /> : null}
            {active && underline ? <SlidingMarker layoutId={marker} className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-accent" /> : null}
          </>
        );
        const cls = cn("relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-75 focus-visible:rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
          underline ? "pb-2.5 pt-1" : "h-8 rounded-lg px-2 hover:bg-fill-0 pointer-coarse:h-10",
          active ? "text-foreground" : "text-secondary hover:text-foreground");
        return t.href
          ? <Link key={key} role="tab" aria-selected={active} tabIndex={tabIndex} href={t.href} className={cls}>{inner}</Link>
          : <button key={key} type="button" role="tab" aria-selected={active} tabIndex={tabIndex} onClick={() => onChange?.(key)} className={cls}>{inner}</button>;
      })}
    </div>
  );
}
