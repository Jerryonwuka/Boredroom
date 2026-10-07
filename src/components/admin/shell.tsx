import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MotionRoot, PageRise } from "@/components/ui/motion";
import { AdminAccount, AdminBreadcrumb, AdminMobileNav, AdminSidebar, AdminSidebarToggle, type AdminNavGroup, type AdminPage } from "@/components/admin/nav";
import { AdminSearch } from "@/components/admin/search";
import { AdminToaster } from "@/components/admin/actions";
import { ROLE_LABEL, type Permission } from "@/server/admin/permissions";
import type { Admin } from "@/server/admin/auth";
import type { LaunchSettings } from "@/server/admin/settings";
import { cn } from "@/lib/utils";

const NAV: { title: string; items: { label: string; href: string; icon: AdminNavGroup["items"][number]["icon"]; permission: Permission }[] }[] = [
  { title: "Overview", items: [
    { label: "Dashboard", href: "/admin", icon: "dashboard", permission: "dashboard.view" },
    { label: "Organisations", href: "/admin/organisations", icon: "organisations", permission: "organization.view" },
    { label: "Users", href: "/admin/users", icon: "users", permission: "user.view" },
  ] },
  { title: "Money", items: [
    { label: "Plans", href: "/admin/billing/plans", icon: "plans", permission: "plan.view" },
    { label: "Subscriptions", href: "/admin/billing/subscriptions", icon: "subscriptions", permission: "subscription.view" },
    { label: "Payments", href: "/admin/billing/payments", icon: "payments", permission: "payment.view" },
  ] },
  { title: "Product", items: [
    { label: "Usage and activity", href: "/admin/usage", icon: "usage", permission: "usage.view" },
    { label: "Moderation", href: "/admin/moderation", icon: "moderation", permission: "moderation.view" },
    { label: "Support", href: "/admin/support", icon: "support", permission: "support.view" },
  ] },
  { title: "Growth", items: [
    { label: "Marketing", href: "/admin/marketing", icon: "marketing", permission: "marketing.view" },
    { label: "Communications", href: "/admin/communications", icon: "communications", permission: "communications.view" },
    { label: "Waitlist and launch", href: "/admin/launch", icon: "launch", permission: "launch.view" },
  ] },
  { title: "Platform", items: [
    { label: "System", href: "/admin/system", icon: "system", permission: "system.view" },
    { label: "Audit log", href: "/admin/audit", icon: "audit", permission: "audit.view" },
    { label: "Admins and permissions", href: "/admin/admins", icon: "admins", permission: "admin.view" },
    { label: "Settings", href: "/admin/settings", icon: "settings", permission: "settings.view" },
  ] },
];

/** Pages inside a section, so the breadcrumb reads "Marketing › Campaigns" rather than the section alone. */
const SUB_PAGES: (AdminPage & { permission: Permission })[] = [
  { label: "Contacts", href: "/admin/marketing/contacts", group: "Marketing", permission: "marketing.view" },
  { label: "Segments", href: "/admin/marketing/segments", group: "Marketing", permission: "marketing.view" },
  { label: "Campaigns", href: "/admin/marketing/campaigns", group: "Marketing", permission: "marketing.view" },
  { label: "Automations", href: "/admin/marketing/automations", group: "Marketing", permission: "marketing.view" },
  { label: "Templates", href: "/admin/marketing/templates", group: "Marketing", permission: "marketing.view" },
  { label: "Search", href: "/admin/search", group: "Control Center", permission: "dashboard.view" },
];

/** The launch state in the top bar: its status colour on a dot, the word beside it (status meaning, not accent). */
const MODE = { waitlist: { tone: "warning", label: "Waitlist" }, live: { tone: "success", label: "Live" }, maintenance: { tone: "danger", label: "Maintenance" } } as const;

/**
 * The Control Center frame, v4 (spec §6; the workspace app's frame): the 256px sidebar of the sections the
 * administrator may see (a 56px rail when collapsed, a sheet from the left below md), the 50px top bar (the canvas at
 * 90% with an 8px blur and a hairline: the sidebar toggle and breadcrumb | the centred search | the launch state, the
 * theme and the account), and the page at full width with 20px sides and 24px under the bar. Toasts float bottom left.
 *
 * Page notes (owner request, 7 October 2026): pages arrive here through the layout, so their `<PageNotes>` cannot be
 * lifted out as the workspace shell does. Instead the main column fills the screen under the bar, and a page whose
 * own top level ends in `<PageNotes>` (its content in one wrapper, then the notes, in a fragment) turns the page
 * wrapper into a column, where the notes' `margin-top: auto` puts them at the bottom of a short page and after the
 * content on a long one. Pages without notes stay a plain block, exactly as before.
 */
export function AdminShell({ admin, launch, children }: { admin: Admin; launch: LaunchSettings; children: React.ReactNode }) {
  const groups: AdminNavGroup[] = NAV.map((g) => ({ title: g.title, items: g.items.filter((i) => admin.permissions.has(i.permission)).map(({ label, href, icon }) => ({ label, href, icon })) })).filter((g) => g.items.length);
  const pages: AdminPage[] = [
    ...groups.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href, group: g.title }))),
    ...SUB_PAGES.filter((p) => admin.permissions.has(p.permission)).map(({ label, href, group }) => ({ label, href, group })),
  ];
  const mode = MODE[launch.mode];
  return (
    <MotionRoot>
      <div className="flex min-h-dvh">
        <AdminSidebar groups={groups} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className={cn("sticky top-0 z-[var(--z-sticky)] isolate grid h-[50px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3",
            "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[var(--header-bg)] before:backdrop-blur-[8px] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]")}>
            <div className="flex min-w-0 items-center gap-2">
              <AdminMobileNav groups={groups} className="md:hidden" />
              <AdminSidebarToggle className="hidden md:inline-flex" />
              <AdminBreadcrumb pages={pages} />
            </div>
            <div className="hidden justify-center lg:flex">
              <AdminSearch />
            </div>
            <div className="flex items-center justify-end gap-1">
              {admin.permissions.has("launch.view")
                ? <Link href="/admin/launch" aria-label={`Launch state: ${mode.label}`} className="mr-1 hidden rounded-full sm:inline-flex"><Badge tone={mode.tone} dot>{mode.label}</Badge></Link>
                : <span className="mr-1 hidden sm:inline-flex"><Badge tone={mode.tone} dot>{mode.label}</Badge></span>}
              <Link href="/admin/search" aria-label="Search" className={cn(ICON_BUTTON, "lg:hidden")}><Search aria-hidden /></Link>
              {/* On phones the theme switch lives in the menu, so the bar fits a 375px screen. */}
              <ThemeToggle className="hidden sm:inline-flex" />
              <AdminAccount profileId={admin.user.profileId} name={admin.user.displayName} email={admin.user.email} avatarKey={admin.user.avatarKey} role={ROLE_LABEL[admin.role]} />
            </div>
          </header>
          <main id="main" className="flex w-full min-w-0 flex-1 flex-col px-5 pb-16 pt-6">
            <PageRise className="min-w-0 flex-1 has-[>[data-page-notes]]:flex has-[>[data-page-notes]]:flex-col">{children}</PageRise>
          </main>
        </div>
      </div>
      <AdminToaster />
    </MotionRoot>
  );
}
