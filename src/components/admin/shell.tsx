import Link from "next/link";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AdminNav, type AdminNavGroup } from "@/components/admin/nav";
import { AdminSearch } from "@/components/admin/search";
import { ROLE_LABEL, type Permission } from "@/server/admin/permissions";
import type { Admin } from "@/server/admin/auth";
import type { LaunchSettings } from "@/server/admin/settings";
import { MotionRoot, PageRise } from "@/components/ui/motion";

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

const MODE_TONE = { waitlist: "warning", live: "success", maintenance: "danger" } as const;

/** The Control Center frame: a fixed sidebar of sections the administrator may see, a top bar with search and the launch state. */
export function AdminShell({ admin, launch, children, title }: { admin: Admin; launch: LaunchSettings; children: React.ReactNode; title?: string }) {
  const groups: AdminNavGroup[] = NAV.map((g) => ({ title: g.title, items: g.items.filter((i) => admin.permissions.has(i.permission)) })).filter((g) => g.items.length);
  return (
    <MotionRoot>
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border-soft bg-sidebar px-3 py-5 md:flex">
        <div className="mb-1 px-2"><Logo href="/admin" /></div>
        <p className="eyebrow eyebrow-accent mb-5 px-2">Control Center</p>
        <div className="min-h-0 flex-1 overflow-y-auto"><AdminNav groups={groups} /></div>
        <div className="mt-4 border-t border-border-soft px-2 pt-3 text-xs text-fg-subtle">
          <p className="truncate font-semibold text-fg-muted">{admin.user.displayName}</p>
          <p className="truncate">{ROLE_LABEL[admin.role]}</p>
          <Link href="/app" className="mt-2 inline-block text-fg-muted hover:text-fg">Back to the app</Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border-soft bg-sidebar px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin" className="md:hidden"><Logo /></Link>
            <div className="hidden min-w-0 md:block"><p className="eyebrow">Boredroom</p><p className="truncate text-sm font-semibold leading-tight">{title ?? "Control Center"}</p></div>
            <Link href="/admin/launch" title="Launch state" className="hidden sm:block"><Badge tone={MODE_TONE[launch.mode]} dot>{launch.mode.toUpperCase()}</Badge></Link>
          </div>
          <div className="flex items-center gap-2">
            <AdminSearch />
            <ThemeToggle />
          </div>
        </header>
        <details className="border-b border-border-soft bg-sidebar px-4 py-2 md:hidden">
          <summary className="cursor-pointer text-sm text-fg-muted">Sections</summary>
          <div className="pt-2"><AdminNav groups={groups} /></div>
        </details>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8"><PageRise>{children}</PageRise></main>
      </div>
    </div>
    </MotionRoot>
  );
}
