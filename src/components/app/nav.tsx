"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bell, CalendarDays, ClipboardCheck, FolderKanban, History, LayoutDashboard, Settings, ShieldCheck, Users, UsersRound, Kanban, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlidingMarker } from "@/components/ui/motion";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
const ICONS = { dashboard: LayoutDashboard, board: Kanban, myday: CalendarDays, projects: FolderKanban, team: Activity, reviews: ClipboardCheck, timesheets: History, reports: BarChart3, people: UsersRound, settings: Settings, audit: ShieldCheck, notifications: Bell, policy: Users, recordings: Video };

export function WorkspaceNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-1">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={cn("relative flex min-h-9 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[14px] font-medium text-fg-muted transition-[color] duration-[var(--duration-fast)] hover:text-fg", active && "text-fg")}>
            {active ? <SlidingMarker layoutId="nav-active" className="absolute inset-0 rounded-[var(--radius-sm)] bg-accent-soft" /> : null}
            <Icon className={cn("relative size-4", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
            <span className="relative flex-1">{it.label}</span>
            {it.badge ? <span className="relative rounded-full bg-accent px-1.5 py-px text-[11px] font-bold tabular-nums text-accent-fg">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
