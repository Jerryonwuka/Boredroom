"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bell, CalendarDays, ClipboardCheck, FolderKanban, History, LayoutDashboard, Settings, ShieldCheck, Users, UsersRound, Kanban } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
const ICONS = { dashboard: LayoutDashboard, board: Kanban, myday: CalendarDays, projects: FolderKanban, team: Activity, reviews: ClipboardCheck, timesheets: History, reports: BarChart3, people: UsersRound, settings: Settings, audit: ShieldCheck, notifications: Bell, policy: Users };

export function WorkspaceNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-1">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium text-fg-muted hover:bg-white/5 hover:text-fg", active && "bg-accent-soft text-fg")}>
            <Icon className={cn("h-4.5 w-4.5", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
            <span className="flex-1">{it.label}</span>
            {it.badge ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
