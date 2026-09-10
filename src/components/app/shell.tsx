import Link from "next/link";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/auth/forms";
import { WorkspaceNav, type NavItem } from "@/components/app/nav";
import { Badge } from "@/components/ui/badge";
import type { OrgContext } from "@/server/lib/api";
import type { NavCounts } from "@/server/services/workspace";
import { RealtimeRefresher } from "@/components/app/realtime";

export function navItems(ctx: OrgContext, counts: NavCounts): NavItem[] {
  const base = `/app/${ctx.org.slug}`;
  const role = ctx.membership.role;
  const items: NavItem[] = [
    { href: `${base}/my-day`, label: "My Day", icon: "myday" },
    { href: `${base}/projects`, label: "Projects", icon: "projects" },
  ];
  if (role !== "employee") items.push({ href: `${base}/team`, label: "Team", icon: "team" });
  items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined });
  items.push({ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets" });
  items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
  items.push({ href: `${base}/notifications`, label: "Notifications", icon: "notifications", badge: counts.unread || undefined });
  if (role === "owner" || role === "hr") items.push({ href: `${base}/people`, label: "People", icon: "people" });
  items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
  if (role === "owner" || role === "hr") items.push({ href: `${base}/settings`, label: "Settings", icon: "settings" });
  items.push({ href: `${base}/audit`, label: "Audit", icon: "audit" });
  return items;
}

export function AppShell({ ctx, counts, children }: { ctx: OrgContext; counts: NavCounts; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-bg-elevated/60 px-4 py-5 md:flex">
        <div className="mb-6 flex items-center justify-between px-2">
          <Logo href={`/app/${ctx.org.slug}/my-day`} />
        </div>
        <Link href="/app" className="mb-5 block rounded-xl border border-border px-3 py-2 hover:border-border-strong" aria-label="Switch workspace">
          <p className="truncate text-sm font-semibold">{ctx.org.name}</p>
          <p className="text-xs text-fg-subtle">Switch workspace</p>
        </Link>
        <WorkspaceNav items={navItems(ctx, counts)} />
        <div className="mt-auto border-t border-border pt-4 text-sm">
          <p className="truncate font-semibold">{ctx.user.displayName}</p>
          <p className="truncate text-xs text-fg-subtle">{ctx.user.email}</p>
          <div className="mt-2 flex items-center justify-between">
            <Badge tone="accent">{ctx.membership.role}</Badge>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Logo href={`/app/${ctx.org.slug}/my-day`} />
          <details className="relative">
            <summary className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm">Menu</summary>
            <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-border bg-bg-elevated p-3 shadow-xl">
              <WorkspaceNav items={navItems(ctx, counts)} />
              <div className="mt-3 border-t border-border pt-3"><Link href="/app" className="text-sm text-fg-muted">Switch workspace</Link></div>
              <div className="mt-2"><SignOutButton /></div>
            </div>
          </details>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        <RealtimeRefresher orgSlug={ctx.org.slug} />
      </div>
    </div>
  );
}
