"use client";

/**
 * The workspace sidebar, v4 (spec §6, owner decision 6 October 2026): a 256px panel on the sidebar grey with a hairline
 * on its right. The logo row is 50px, level with the top bar. Nav items are 32px tall with 4px between them, inset 12px:
 * an 18px icon and the label, both in the secondary grey; hover and the current page get fill-1 and the foreground,
 * and the current page's icon turns orange (accent rules, owner decision 6 October 2026; its label stays the
 * foreground). Groups after the first carry a quiet label ("Work", "Records"). Counts are unread messages and reviews
 * waiting, so they are orange attention pills. At the bottom: a notice card when the plan needs a word (accent tint),
 * then the workspace row, which opens the workspace menu.
 *
 * Collapsed, it is a 56px rail: the "B." mark, the icons alone (their labels as tooltips to the right), a hairline
 * between groups, a small orange dot for a count, and the workspace avatar. The choice lives on <html data-sidebar>
 * and in localStorage; the root layout's inline script applies it before first paint, and every collapsed style
 * here hangs off that attribute in CSS, so the server's HTML is already right and nothing jumps or hides on load.
 *
 * Below md the sidebar is hidden and `MobileNav` (the top bar's menu button) opens the same list in a sheet from the left.
 *
 * Every nav icon is animated (owner request, 7 October 2026; components/ui/animated-icons): it plays while its item is
 * hovered or focused from the keyboard, once when its item becomes the current page (Brenda's face squints happily),
 * never on a loop, and not at all under reduced motion. The current page's icon is still the orange one.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AnimatedActivity, AnimatedAlarmClock, AnimatedBell, AnimatedCalendarDays, AnimatedChevronsUpDown, AnimatedClipboardCheck, AnimatedClipboardList,
  AnimatedFileText, AnimatedFolderKanban, AnimatedHistory, AnimatedKanban, AnimatedLayoutDashboard, AnimatedListChecks, AnimatedListTodo,
  AnimatedMessageSquare, AnimatedPanelLeft, AnimatedPlus, AnimatedSettings, AnimatedShieldCheck, AnimatedUsersRound, AnimatedVideo, AnimatedX,
} from "@/components/ui/animated-icons";
import { Handshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { CountPill } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Logo } from "@/components/logo";
import { BrendaGlyph } from "@/components/app/brenda-glyph";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; /** Section label shown above the first item of each group. */ group?: string };
export type Workspace = { slug: string; name: string };
/** A short word from the workspace in the sidebar's tinted card (a trial running out, say). */
export type SidebarNotice = { title: string; body: string; href: string; cta: string };
/** Any line icon that takes a class and can hide from screen readers: the animated twins of lucide's, and Brenda's own glyph. */
type NavIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
// Brenda's page carries her face, never a generic AI icon (owner decision, 5 October 2026). Reports and Policy are gone.
const ICONS = {
  brenda: BrendaGlyph, dashboard: AnimatedLayoutDashboard, board: AnimatedKanban, myday: AnimatedCalendarDays, projects: AnimatedFolderKanban, team: AnimatedActivity,
  reviews: AnimatedClipboardCheck, timesheets: AnimatedHistory, people: AnimatedUsersRound, settings: AnimatedSettings, audit: AnimatedShieldCheck,
  notifications: AnimatedBell, calls: AnimatedVideo, messages: AnimatedMessageSquare, tasks: AnimatedListChecks, clock: AnimatedAlarmClock,
  attendance: AnimatedClipboardList, docs: AnimatedFileText, todos: AnimatedListTodo,
  // Commitments (owner decision, 8 October 2026: phase 7b): lucide's Handshake, still (it has no animated twin yet).
  commitments: Handshake,
  // Calls (owner decisions, 8 October 2026: phase 8) take the video icon Recordings had (screen recording is gone).
} satisfies Record<string, NavIcon>;

export const SIDEBAR_KEY = "boredroom-sidebar";

function subscribe(onChange: () => void) {
  const o = new MutationObserver(onChange);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => o.disconnect();
}
const readCollapsed = () => document.documentElement.dataset.sidebar === "collapsed";
const serverCollapsed = () => false;

/** Whether the person collapsed the sidebar (false while the page hydrates; the look itself comes from CSS). */
export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, readCollapsed, serverCollapsed);
}

export function setSidebarCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed"; else delete document.documentElement.dataset.sidebar;
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded"); } catch { /* private mode */ }
}

/** The top bar's panel button (md and up): collapses the sidebar to its rail and back. */
export function SidebarToggle({ className }: { className?: string }) {
  const collapsed = useSidebarCollapsed();
  return (
    <IconButton className={className} aria-controls="workspace-sidebar" aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} onClick={() => setSidebarCollapsed(!collapsed)}>
      <AnimatedPanelLeft aria-hidden />
    </IconButton>
  );
}

type Variant = "rail" | "sheet";

/** The items in order, split where the group changes. */
function groupsOf(items: NavItem[]) {
  const groups: { label?: string; items: NavItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === it.group) last.items.push(it); else groups.push({ label: it.group, items: [it] });
  }
  return groups;
}

const ITEM = "relative flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 [&>svg]:size-[18px] [&>svg]:shrink-0";
// The rail's collapsed look (only inside the desktop sidebar, never in the phone sheet): the icon alone, centred.
const ITEM_RAIL = "in-data-[sidebar=collapsed]:w-8 in-data-[sidebar=collapsed]:px-[7px]";

/**
 * The list of pages. The first group has no label (like the top of ElevenLabs' list); the others carry theirs. In the
 * rail, a collapsed sidebar shows the icons with their labels as tooltips, and a hairline between groups.
 */
export function WorkspaceNav({ items, variant = "rail" }: { items: NavItem[]; variant?: Variant }) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed() && variant === "rail";
  const rail = variant === "rail";
  return (
    <nav aria-label="Workspace">
      {groupsOf(items).map((g, gi) => {
        const labelId = `nav-${variant}-${gi}`;
        const labelled = gi > 0 && g.label;
        return (
          <div key={`${g.label ?? "top"}-${gi}`} className={cn(gi > 0 && "mt-4", gi > 0 && rail && "in-data-[sidebar=collapsed]:mt-2 in-data-[sidebar=collapsed]:border-t in-data-[sidebar=collapsed]:border-border in-data-[sidebar=collapsed]:pt-2")}>
            {labelled ? <p id={labelId} className={cn("mb-1 px-1.5 text-sm font-medium text-secondary", rail && "in-data-[sidebar=collapsed]:sr-only")}>{g.label}</p> : null}
            <ul className="space-y-1" aria-labelledby={labelled ? labelId : undefined}>
              {g.items.map((it) => {
                const Icon: NavIcon = ICONS[it.icon];
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={active ? "page" : undefined} data-tip={collapsed ? (it.badge ? `${it.label}, ${it.badge}` : it.label) : undefined} data-tip-side="right"
                      className={cn(ITEM, active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary hover:bg-fill-1 hover:text-foreground", rail ? ITEM_RAIL : "pointer-coarse:h-10")}>
                      <Icon aria-hidden />
                      <span className={cn("min-w-0 flex-1 truncate", rail && "in-data-[sidebar=collapsed]:sr-only")}>{it.label}</span>
                      {it.badge ? <CountPill count={it.badge} tone="attention" className={cn(rail && "in-data-[sidebar=collapsed]:sr-only")} /> : null}
                      {it.badge && rail ? <span aria-hidden className="absolute right-1 top-1 hidden size-1.5 rounded-full bg-accent in-data-[sidebar=collapsed]:block" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The workspace row: its avatar and name; it opens a menu of the person's workspaces (the current one ticked), then
 * joining or creating another, and the workspace settings for the people who run it.
 */
function WorkspaceSwitcher({ orgSlug, orgName, workspaces, isOrg, variant }: { orgSlug: string; orgName: string; workspaces: Workspace[]; isOrg: boolean; variant: Variant }) {
  const collapsed = useSidebarCollapsed() && variant === "rail";
  const rail = variant === "rail";
  const list = workspaces.some((w) => w.slug === orgSlug) ? workspaces : [{ slug: orgSlug, name: orgName }, ...workspaces];
  return (
    // Menu wraps its trigger in an inline span; the row should span the panel, so that span is made a full-width flex.
    <div className="min-w-0 [&>span]:flex [&>span]:w-full">
    <Menu align="start" label="Workspaces" className="w-[232px]"
      trigger={
        <button type="button" data-tip={collapsed ? `${orgName}, switch workspace` : undefined} data-tip-side="right"
          className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground transition-colors duration-75 hover:bg-fill-1 aria-expanded:bg-fill-1", rail ? "in-data-[sidebar=collapsed]:w-8 in-data-[sidebar=collapsed]:px-1.5" : "pointer-coarse:h-10")}>
          <Avatar profileId={`workspace-${orgSlug}`} name={orgName} size={20} />
          <span className={cn("min-w-0 flex-1 truncate text-left", rail && "in-data-[sidebar=collapsed]:sr-only")}>{orgName}<span className="sr-only">, switch workspace</span></span>
          <AnimatedChevronsUpDown className={cn("size-3.5 shrink-0 text-secondary", rail && "in-data-[sidebar=collapsed]:hidden")} aria-hidden />
        </button>
      }>
      <MenuLabel>Workspaces</MenuLabel>
      {list.map((w) => (
        <MenuItem key={w.slug} href={`/app/${w.slug}`} checked={w.slug === orgSlug} icon={<Avatar profileId={`workspace-${w.slug}`} name={w.name} size={20} />}>{w.name}</MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem href="/app?switch=1" icon={<AnimatedPlus aria-hidden />}>Join or create a workspace</MenuItem>
      {isOrg ? <MenuItem href={`/app/${orgSlug}/settings`} icon={<AnimatedSettings aria-hidden />}>Workspace settings</MenuItem> : null}
    </Menu>
    </div>
  );
}

function NoticeCard({ notice, rail }: { notice: SidebarNotice; rail: boolean }) {
  return (
    <div className={cn("card-tint", rail && "in-data-[sidebar=collapsed]:hidden")}>
      <p className="text-sm font-medium text-foreground">{notice.title}</p>
      <p className="mt-0.5 text-meta font-normal text-secondary">{notice.body}</p>
      <Link href={notice.href} className="mt-2 inline-flex rounded-sm text-meta font-medium text-accent-text hover:underline">{notice.cta}</Link>
    </div>
  );
}

type SidebarProps = { items: NavItem[]; orgSlug: string; orgName: string; workspaces?: Workspace[]; isOrg?: boolean; notice?: SidebarNotice | null };

export function Sidebar({ items, orgSlug, orgName, workspaces = [], isOrg = false, notice = null }: SidebarProps) {
  return (
    // The outer box animates its width; the inner one switches at once, so nothing reflows while the rail slides.
    // data-ready: the server's HTML is already in the right state (the collapsed look is CSS on <html data-sidebar>).
    <aside id="workspace-sidebar" data-app-sidebar data-ready="" aria-label="Sidebar"
      className="sticky top-[var(--shell-banners,0px)] hidden h-[calc(100dvh-var(--shell-banners,0px))] w-64 shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out md:block [[data-sidebar=collapsed]_&]:w-14">
      <div className="flex h-full w-64 flex-col in-data-[sidebar=collapsed]:w-14">
        <div className="flex h-[50px] shrink-0 items-center pl-[18px] pr-3 in-data-[sidebar=collapsed]:justify-center in-data-[sidebar=collapsed]:px-0">
          <Logo href={`/app/${orgSlug}`} height={16} className="in-data-[sidebar=collapsed]:hidden" />
          <Logo href={`/app/${orgSlug}`} variant="mark" height={18} className="hidden in-data-[sidebar=collapsed]:inline-flex" />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1">
          <WorkspaceNav items={items} variant="rail" />
        </div>
        <div className="shrink-0 space-y-2 p-3">
          {notice ? <NoticeCard notice={notice} rail /> : null}
          <WorkspaceSwitcher orgSlug={orgSlug} orgName={orgName} workspaces={workspaces} isOrg={isOrg} variant="rail" />
        </div>
      </div>
    </aside>
  );
}

/**
 * The phone and tablet menu (below md, where the sidebar is hidden): the top bar's panel button opens the sidebar's
 * contents in a sheet from the left, on the native <dialog> (focus moves in and stays, Escape closes, focus returns to
 * the button). Choosing a page, a tap on the overlay or Escape closes it.
 */
export function MobileNav({ items, orgSlug, orgName, workspaces = [], isOrg = false, notice = null, className }: SidebarProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // A page chosen elsewhere (a search result, the browser's back button) closes it too.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) { setShownFor(pathname); if (open) setOpen(false); }
  return (
    <>
      <IconButton className={className} aria-label="Open the menu" aria-haspopup="dialog" aria-controls="mobile-nav" onClick={() => setOpen(true)}>
        <AnimatedPanelLeft aria-hidden />
      </IconButton>
      <dialog ref={ref} id="mobile-nav" aria-label="Menu"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClose={() => setOpen(false)}
        onMouseDown={(e) => { if (e.target === e.currentTarget && e.clientX > e.currentTarget.getBoundingClientRect().right) setOpen(false); }}
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-[min(288px,calc(100vw-48px))] max-w-none border-0 border-r border-border bg-sidebar p-0 text-foreground shadow-sheet transition-transform duration-300 ease-out backdrop:bg-overlay open:flex open:flex-col starting:open:-translate-x-full md:hidden">
        {open ? (
          <>
            <div className="flex h-[50px] shrink-0 items-center justify-between pl-[18px] pr-3">
              <Logo href={`/app/${orgSlug}`} height={16} />
              <IconButton aria-label="Close the menu" onClick={() => setOpen(false)}><AnimatedX aria-hidden /></IconButton>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
              <WorkspaceNav items={items} variant="sheet" />
            </div>
            <div className="shrink-0 space-y-2 p-3">
              {notice ? <NoticeCard notice={notice} rail={false} /> : null}
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1"><WorkspaceSwitcher orgSlug={orgSlug} orgName={orgName} workspaces={workspaces} isOrg={isOrg} variant="sheet" /></div>
                <ThemeToggle />
              </div>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
