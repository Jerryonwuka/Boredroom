"use client";

/**
 * The Control Center's frame pieces, v4 (spec §6, the workspace app's own frame; accent rules, owner decision 6 October
 * 2026).
 *
 * - `AdminSidebar`: the 256px panel on the sidebar grey with a hairline on its right. The logo row is 50px, level with
 *   the top bar. Items are 32px tall, 4px apart, inset 12px: an 18px icon and the label in the secondary grey; hover and
 *   the current page get fill-1 and the foreground, and the current page's icon turns orange (its label stays the
 *   foreground). Groups after the first carry a quiet label ("Money", "Growth"). At the bottom, the way back to the app.
 *   Collapsed, it is the 56px rail the workspace uses (the same <html data-sidebar> choice, applied before first paint
 *   by the root layout): the "B." mark, the icons alone with their labels as tooltips, a hairline between groups.
 * - `AdminMobileNav`: below md the sidebar is hidden and the top bar's panel button opens the same list in a sheet from
 *   the left, on the native <dialog> (focus moves in, Escape closes, focus returns to the button).
 * - `AdminBreadcrumb`: "Section › Page" in the top bar; on a page inside a page (an organisation, a campaign) the page
 *   name links back to its list.
 * - `AdminAccount`: the avatar at the top bar's right end: who is signed in, their role, the way back to the app, sign out.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ArrowLeft, BarChart3, Bell, Building2, ChevronRight, CreditCard, FileClock, Gauge, LayoutGrid, LifeBuoy, LogOut, Mail, Megaphone, PanelLeft, Rocket, Settings, ShieldAlert, ShieldCheck, Tags, UsersRound, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Logo } from "@/components/logo";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/components/app/sidebar";
import { api } from "@/lib/api-client";

const ICONS = { dashboard: Gauge, organisations: Building2, users: UsersRound, plans: Tags, subscriptions: CreditCard, payments: Wallet, usage: Activity, moderation: ShieldAlert, support: LifeBuoy, marketing: Megaphone, communications: Mail, launch: Rocket, system: BarChart3, audit: FileClock, admins: ShieldCheck, settings: Settings, notifications: Bell };
export type AdminNavGroup = { title: string; items: { label: string; href: string; icon: keyof typeof ICONS }[] };
export type AdminPage = { label: string; href: string; group: string };

const SIDEBAR_ID = "admin-sidebar";
const ITEM = "relative flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 [&>svg]:size-[18px] [&>svg]:shrink-0";
// The rail's collapsed look (only in the desktop sidebar, never in the phone sheet): the icon alone, centred.
const ITEM_RAIL = "in-data-[sidebar=collapsed]:w-8 in-data-[sidebar=collapsed]:px-[7px]";

/** The dashboard is only itself; every other section also owns the pages under it. */
function matches(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

type Variant = "rail" | "sheet";

/** The sections the administrator may open, by group. The first group has no label, as in the workspace sidebar. */
export function AdminNav({ groups, variant = "rail" }: { groups: AdminNavGroup[]; variant?: Variant }) {
  const pathname = usePathname();
  const rail = variant === "rail";
  const collapsed = useSidebarCollapsed() && rail;
  return (
    <nav aria-label="Control Center">
      {groups.map((g, gi) => {
        const labelId = `admin-nav-${variant}-${gi}`;
        const labelled = gi > 0;
        return (
          <div key={g.title} className={cn(gi > 0 && "mt-4", gi > 0 && rail && "in-data-[sidebar=collapsed]:mt-2 in-data-[sidebar=collapsed]:border-t in-data-[sidebar=collapsed]:border-border in-data-[sidebar=collapsed]:pt-2")}>
            {labelled ? <p id={labelId} className={cn("mb-1 px-1.5 text-sm font-medium text-secondary", rail && "in-data-[sidebar=collapsed]:sr-only")}>{g.title}</p> : null}
            <ul className="space-y-1" aria-labelledby={labelled ? labelId : undefined}>
              {g.items.map((it) => {
                const Icon = ICONS[it.icon];
                const active = matches(it.href, pathname);
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={active ? "page" : undefined} data-tip={collapsed ? it.label : undefined} data-tip-side="right"
                      className={cn(ITEM, active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary hover:bg-fill-1 hover:text-foreground", rail ? ITEM_RAIL : "pointer-coarse:h-10")}>
                      <Icon aria-hidden />
                      <span className={cn("min-w-0 flex-1 truncate", rail && "in-data-[sidebar=collapsed]:sr-only")}>{it.label}</span>
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

/** The row at the foot of the sidebar: back to the workspace app. */
function BackToApp({ variant }: { variant: Variant }) {
  const rail = variant === "rail";
  const collapsed = useSidebarCollapsed() && rail;
  return (
    <Link href="/app" data-tip={collapsed ? "Back to the app" : undefined} data-tip-side="right"
      className={cn(ITEM, "text-secondary hover:bg-fill-1 hover:text-foreground", rail ? ITEM_RAIL : "pointer-coarse:h-10")}>
      <ArrowLeft aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate", rail && "in-data-[sidebar=collapsed]:sr-only")}>Back to the app</span>
    </Link>
  );
}

export function AdminSidebar({ groups }: { groups: AdminNavGroup[] }) {
  return (
    // The outer box animates its width; the inner one switches at once, so nothing reflows while the rail slides.
    <aside id={SIDEBAR_ID} aria-label="Sidebar"
      className="sticky top-0 hidden h-dvh w-64 shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out md:block [[data-sidebar=collapsed]_&]:w-14">
      <div className="flex h-full w-64 flex-col in-data-[sidebar=collapsed]:w-14">
        <div className="flex h-[50px] shrink-0 items-center gap-2 pl-[18px] pr-3 in-data-[sidebar=collapsed]:justify-center in-data-[sidebar=collapsed]:px-0">
          <Logo href="/admin" height={16} className="in-data-[sidebar=collapsed]:hidden" />
          <Logo href="/admin" variant="mark" height={18} className="hidden in-data-[sidebar=collapsed]:inline-flex" />
          <Badge size="sm" className="in-data-[sidebar=collapsed]:hidden">Admin</Badge>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1">
          <AdminNav groups={groups} variant="rail" />
        </div>
        <div className="shrink-0 p-3">
          <BackToApp variant="rail" />
        </div>
      </div>
    </aside>
  );
}

/** The top bar's panel button (md and up): collapses the sidebar to its rail and back. */
export function AdminSidebarToggle({ className }: { className?: string }) {
  const collapsed = useSidebarCollapsed();
  return (
    <IconButton className={className} aria-controls={SIDEBAR_ID} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} onClick={() => setSidebarCollapsed(!collapsed)}>
      <PanelLeft aria-hidden />
    </IconButton>
  );
}

/** Below md: the sections in a sheet from the left. Choosing a page, a tap on the overlay or Escape closes it. */
export function AdminMobileNav({ groups, className }: { groups: AdminNavGroup[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // A page chosen elsewhere (a search, the browser's back button) closes it too.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) { setShownFor(pathname); if (open) setOpen(false); }
  return (
    <>
      <IconButton className={className} aria-label="Open the menu" aria-haspopup="dialog" aria-controls="admin-mobile-nav" onClick={() => setOpen(true)}>
        <PanelLeft aria-hidden />
      </IconButton>
      <dialog ref={ref} id="admin-mobile-nav" aria-label="Control Center sections"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClose={() => setOpen(false)}
        onMouseDown={(e) => { if (e.target === e.currentTarget && e.clientX > e.currentTarget.getBoundingClientRect().right) setOpen(false); }}
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-[min(288px,calc(100vw-48px))] max-w-none border-0 border-r border-border bg-sidebar p-0 text-foreground shadow-sheet transition-transform duration-300 ease-out backdrop:bg-overlay open:flex open:flex-col starting:open:-translate-x-full md:hidden">
        {open ? (
          <>
            <div className="flex h-[50px] shrink-0 items-center justify-between gap-2 pl-[18px] pr-3">
              <span className="flex min-w-0 items-center gap-2"><Logo href="/admin" height={16} /><Badge size="sm">Admin</Badge></span>
              <IconButton aria-label="Close the menu" onClick={() => setOpen(false)}><X aria-hidden /></IconButton>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
              <AdminNav groups={groups} variant="sheet" />
            </div>
            <div className="flex shrink-0 items-center gap-1 p-3">
              <div className="min-w-0 flex-1"><BackToApp variant="sheet" /></div>
              <ThemeToggle />
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}

/** "Money › Payments": the section in the secondary grey, a 14px chevron, the page in the foreground. Phones show the page alone. */
export function AdminBreadcrumb({ pages, className }: { pages: AdminPage[]; className?: string }) {
  const pathname = usePathname();
  // The longest matching page wins, so /admin/organisations/123 reads "Organisations" and links back to the list.
  const page = [...pages].sort((a, b) => b.href.length - a.href.length).find((p) => matches(p.href, pathname));
  const parent = page && pathname !== page.href ? page : null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm font-medium">
        {page ? (
          <>
            <li className="hidden min-w-0 shrink items-center gap-1 sm:flex">
              <span className="truncate text-secondary">{page.group}</span>
              <ChevronRight className="size-3.5 shrink-0 text-secondary" aria-hidden />
            </li>
            <li className="flex min-w-0">
              {parent
                ? <Link href={parent.href} className="truncate rounded-md text-foreground transition-colors duration-75 hover:text-secondary">{page.label}</Link>
                : <span aria-current="page" className="truncate text-foreground">{page.label}</span>}
            </li>
          </>
        ) : <li className="flex min-w-0"><span aria-current="page" className="truncate text-foreground">Control Center</span></li>}
      </ol>
    </nav>
  );
}

/** The signed-in administrator: name, email, role; back to the app; sign out. */
export function AdminAccount({ profileId, name, email, avatarKey, role }: { profileId: string; name: string; email: string; avatarKey?: string | null; role: string }) {
  const router = useRouter();
  const [signOut, setSignOut] = useState<"idle" | "pending" | "failed">("idle");
  return (
    <Popover align="end" label="Your account" width={288} className="p-1"
      trigger={
        <button type="button" aria-label={`Your account, ${name}`} className="relative ml-1 grid size-8 shrink-0 place-items-center rounded-full transition-opacity duration-75 hover:opacity-90 pointer-coarse:size-10">
          <Avatar profileId={profileId} name={name} avatarKey={avatarKey} size={32} />
        </button>
      }>
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2 pb-2 pt-1.5">
            <Avatar profileId={profileId} name={name} avatarKey={avatarKey} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{name}</p>
              <p className="truncate text-meta font-normal text-secondary">{email}</p>
            </div>
          </div>
          <div className="px-2 pb-2"><Badge>{role}</Badge></div>
          <div role="separator" className="menu-separator" />
          <Link href="/app" onClick={close} className="menu-item"><LayoutGrid aria-hidden />Back to the app</Link>
          <div role="separator" className="menu-separator" />
          <button type="button" disabled={signOut === "pending"} className="menu-item disabled:opacity-60"
            onClick={async () => { setSignOut("pending"); try { await api("/api/auth/logout", { method: "POST", retries: 0 }); router.push("/login"); router.refresh(); } catch { setSignOut("failed"); } }}>
            <LogOut aria-hidden />{signOut === "pending" ? "Signing out…" : "Sign out"}
          </button>
          {signOut === "failed" ? <p role="alert" className="px-2 pb-1.5 pt-1 text-xs text-danger">Could not sign out. Check your connection and try again.</p> : null}
        </>
      )}
    </Popover>
  );
}
