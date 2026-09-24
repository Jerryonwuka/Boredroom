"use client";

/**
 * The workspace sidebar. Expanded it is the list; collapsed it is a dock: one icon tile per page, lifting on hover with
 * its label beside it. The choice lives on <html data-sidebar> and in localStorage, applied before first paint by the
 * root layout's inline script, so the page never jumps.
 */
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Activity, AlarmClock, BarChart3, Bell, Building2, CalendarDays, ClipboardCheck, ClipboardList, FolderKanban, History, LayoutDashboard, ListChecks, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Users, UsersRound, Kanban, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlidingMarker } from "@/components/ui/motion";
import { Logo } from "@/components/logo";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
const ICONS = { dashboard: LayoutDashboard, board: Kanban, myday: CalendarDays, projects: FolderKanban, team: Activity, reviews: ClipboardCheck, timesheets: History, reports: BarChart3, people: UsersRound, settings: Settings, audit: ShieldCheck, notifications: Bell, policy: Users, recordings: Video, messages: MessageSquare, tasks: ListChecks, clock: AlarmClock, attendance: ClipboardList };

export const SIDEBAR_KEY = "boredroom-sidebar";
const EXPANDED = 240;
const COLLAPSED = 76;

function subscribe(onChange: () => void) {
  const o = new MutationObserver(onChange);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => o.disconnect();
}
const readCollapsed = () => document.documentElement.dataset.sidebar === "collapsed";
const serverCollapsed = () => false;

export function setSidebarCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed"; else delete document.documentElement.dataset.sidebar;
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded"); } catch { /* private mode */ }
}

/** The label that appears beside a dock tile on hover or focus. */
function DockLabel({ children }: { children: React.ReactNode }) {
  return <span role="tooltip" className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-[var(--z-dropdown)] -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-[10px] border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-fg opacity-0 shadow-[var(--ring-lift)] transition-[opacity,transform] duration-[var(--duration-fast)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">{children}</span>;
}

/** The list of pages: a quiet white pill slides to the active item; icons lift a little on hover, like a dock. */
export function WorkspaceNav({ items, collapsed = false }: { items: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className={cn("flex flex-col", collapsed ? "items-center gap-1.5" : "gap-0.5")}>
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        if (collapsed) {
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} aria-label={it.badge ? `${it.label}, ${it.badge}` : it.label}
              className={cn("group relative grid size-11 place-items-center rounded-[12px] border text-fg-subtle transition-[transform,color,border-color,background-color] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5 hover:scale-105 hover:border-border-strong hover:text-fg motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100", active ? "border-border bg-wash-strong text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "border-transparent hover:bg-wash")}>
              <Icon className={cn("size-[18px] transition-transform duration-200 group-hover:scale-110", active && "text-accent")} aria-hidden />
              {it.badge ? <span aria-hidden className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums text-accent-fg">{it.badge}</span> : null}
              <DockLabel>{it.label}</DockLabel>
            </Link>
          );
        }
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={cn("group relative flex min-h-9 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[14px] font-medium text-fg-muted transition-[color] duration-[var(--duration-fast)] hover:text-fg", active && "text-fg")}>
            {active ? <SlidingMarker layoutId="nav-active" className="absolute inset-0 rounded-[var(--radius-sm)] bg-wash-strong shadow-[inset_0_1px_0_var(--highlight)]" /> : null}
            <Icon className={cn("relative size-4 transition-transform duration-200 group-hover:-translate-y-px group-hover:scale-110 motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
            <span className="relative flex-1 truncate">{it.label}</span>
            {it.badge ? <span className="relative rounded-full bg-accent px-1.5 py-px text-[11px] font-bold tabular-nums text-accent-fg">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ items, orgSlug, orgName }: { items: NavItem[]; orgSlug: string; orgName: string }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, serverCollapsed);
  const reduced = useReducedMotion();
  return (
    <motion.aside
      aria-label="Sidebar"
      initial={false}
      animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36 }}
      className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-border-soft bg-sidebar py-5 md:flex", collapsed ? "items-center px-3" : "px-3")}
      style={{ width: collapsed ? COLLAPSED : EXPANDED }}>
      <div className={cn("mb-6 flex items-center", collapsed ? "justify-center" : "justify-between px-2")}>
        {collapsed ? <Link href={`/app/${orgSlug}`} aria-label="Boredroom home" className="font-display text-xl tracking-wide text-fg">B<span className="text-accent">.</span></Link> : <Logo href={`/app/${orgSlug}`} />}
      </div>
      {collapsed ? (
        <Link href="/app" aria-label={`${orgName}: switch workspace`} className="group relative mb-5 grid size-11 place-items-center rounded-[12px] border border-border bg-wash text-fg-muted transition-[transform,color] duration-200 hover:-translate-y-0.5 hover:scale-105 hover:text-fg motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100">
          <Building2 className="size-[18px]" aria-hidden />
          <DockLabel>{orgName}, switch workspace</DockLabel>
        </Link>
      ) : (
        <Link href="/app" className="chip chip-link mb-5 block px-3 py-2" aria-label="Switch workspace">
          <p className="truncate text-sm font-semibold">{orgName}</p>
          <p className="text-xs text-fg-subtle">Switch workspace</p>
        </Link>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-visible", collapsed ? "w-full" : "-mx-1 px-1")}><WorkspaceNav items={items} collapsed={collapsed} /></div>
      <div className={cn("mt-auto pt-4", collapsed ? "flex justify-center" : "px-1")}>
        <button type="button" onClick={() => setSidebarCollapsed(!collapsed)} aria-pressed={collapsed} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          className={cn("group relative inline-flex items-center gap-2 rounded-[12px] border border-transparent text-fg-subtle transition-[color,background-color,border-color,transform] duration-200 hover:border-border hover:bg-wash hover:text-fg", collapsed ? "size-11 justify-center hover:-translate-y-0.5 motion-reduce:hover:translate-y-0" : "h-9 px-2.5 text-[13px] font-medium")}>
          {collapsed ? <><PanelLeftOpen className="size-[18px]" aria-hidden /><DockLabel>Expand</DockLabel></> : <><PanelLeftClose className="size-4" aria-hidden />Collapse</>}
        </button>
      </div>
    </motion.aside>
  );
}
