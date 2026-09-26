"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SlidingMarker } from "@/components/ui/motion";

export type Tab = { label: string; href?: string; value?: string; count?: number };

/**
 * Pill tabs, one strip, the active pill slides between items. Link tabs (href) for pages that switch by URL;
 * value tabs with onChange for local state. Counts sit in a small pill after the label.
 */
export function Tabs({ tabs, value, onChange, param = "tab", className, label = "Sections" }: { tabs: Tab[]; value?: string; onChange?: (v: string) => void; param?: string; className?: string; label?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = value ?? sp.get(param) ?? tabs[0]?.value ?? tabs[0]?.href;
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-wash-soft p-1", className)}>
      {tabs.map((t) => {
        const key = t.value ?? t.href ?? t.label;
        // A page that knows its state passes `value`, so the default tab lights up even before the URL names it.
        const active = value !== undefined && t.value ? value === t.value : t.href ? pathname === t.href || (sp.get(param) ?? "") === (t.value ?? "") && !!t.value : current === key;
        const inner = (
          <>
            {active ? <SlidingMarker layoutId="tabs-active" className="absolute inset-0 rounded-full bg-wash-active" /> : null}
            <span className="relative">{t.label}</span>
            {t.count ? <span className={cn("relative ml-2 whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums", active ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent")}>{t.count}</span> : null}
          </>
        );
        // The chosen tab reads orange (owner decision, 26 September 2026): the one place on the strip the eye should land.
        const cls = cn("relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]", active ? "text-accent" : "text-fg-muted hover:text-fg");
        return t.href
          ? <Link key={key} role="tab" aria-selected={active} href={t.href} className={cls}>{inner}</Link>
          : <button key={key} type="button" role="tab" aria-selected={active} onClick={() => onChange?.(key)} className={cls}>{inner}</button>;
      })}
    </div>
  );
}
