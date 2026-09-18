import Link from "next/link";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/auth/forms";
import { WorkspaceNav, type NavItem } from "@/components/app/nav";
import { Badge } from "@/components/ui/badge";
import type { OrgContext } from "@/server/lib/api";
import type { NavCounts } from "@/server/services/workspace";
import { RealtimeRefresher } from "@/components/app/realtime";
import { MotionRoot, PageRise } from "@/components/ui/motion";

export const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

export function navItems(ctx: OrgContext, counts: NavCounts, teams: { id: string; name: string; is_manager: boolean }[] = []): NavItem[] {
  const base = `/app/${ctx.org.slug}`;
  const role = ctx.membership.role;
  const items: NavItem[] = [];
  if (role === "owner" || role === "hr") {
    // Organisation account: supervision and management only.
    items.push({ href: `${base}/dashboard`, label: "Dashboard", icon: "dashboard" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
    items.push({ href: `${base}/people`, label: "People and teams", icon: "people" });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined });
    items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings" });
    // Records (timesheets, corrections, CSV export) are reached from Reports and from any person's row; not a top-level item.
    items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects" });
    items.push({ href: `${base}/notifications`, label: "Notifications", icon: "notifications", badge: counts.unread || undefined });
    items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
    items.push({ href: `${base}/settings`, label: "Settings", icon: "settings" });
    items.push({ href: `${base}/audit`, label: "Audit", icon: "audit" });
    return items;
  }
  if (role === "manager") {
    for (const t of teams.filter((t) => t.is_manager)) items.push({ href: `${base}/teams/${t.id}`, label: `${t.name} board`, icon: "board" });
    items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined });
    items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings" });
    items.push({ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets" });
    items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects" });
    items.push({ href: `${base}/notifications`, label: "Notifications", icon: "notifications", badge: counts.unread || undefined });
    items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
    return items;
  }
  // Staff: the smallest possible menu.
  items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday" });
  items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
  items.push({ href: `${base}/timesheets`, label: "My timesheet", icon: "timesheets" });
  items.push({ href: `${base}/notifications`, label: "Notifications", icon: "notifications", badge: counts.unread || undefined });
  items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
  return items;
}

export function AppShell({ ctx, counts, teams = [], children }: { ctx: OrgContext; counts: NavCounts; teams?: { id: string; name: string; is_manager: boolean }[]; children: React.ReactNode }) {
  return (
    <MotionRoot>
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border-soft px-3 py-5 md:flex">
        <div className="mb-6 flex items-center justify-between px-2">
          <Logo href={`/app/${ctx.org.slug}`} />
        </div>
        <Link href="/app" className="mb-5 block rounded-[var(--radius-sm)] border border-border px-3 py-2 transition-[border-color,background-color] duration-[var(--duration-fast)] hover:border-border-strong hover:bg-white/[0.03]" aria-label="Switch workspace">
          <p className="truncate text-sm font-semibold">{ctx.org.name}</p>
          <p className="text-xs text-fg-subtle">Switch workspace</p>
        </Link>
        <WorkspaceNav items={navItems(ctx, counts, teams)} />
        <div className="mt-auto border-t border-border pt-4 text-sm">
          <p className="truncate font-semibold">{ctx.user.displayName}</p>
          <p className="truncate text-xs text-fg-subtle">{ctx.user.email}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge tone="accent" className="whitespace-nowrap">{ROLE_LABEL[ctx.membership.role]}</Badge>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Logo href={`/app/${ctx.org.slug}`} />
          <details className="relative">
            <summary className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm">Menu</summary>
            <div className="absolute right-0 z-[var(--z-dropdown)] mt-2 w-64 rounded-[var(--radius)] border border-border-strong bg-popover p-3">
              <WorkspaceNav items={navItems(ctx, counts, teams)} />
              <div className="mt-3 border-t border-border pt-3"><Link href="/app" className="text-sm text-fg-muted">Switch workspace</Link></div>
              <div className="mt-2"><SignOutButton /></div>
            </div>
          </details>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8"><PageRise>{children}</PageRise></main>
        <RealtimeRefresher orgSlug={ctx.org.slug} />
      </div>
    </div>
    </MotionRoot>
  );
}
