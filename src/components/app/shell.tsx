import Link from "next/link";
import { Logo } from "@/components/logo";
import { TopBar } from "@/components/app/topbar";
import { WorkspaceNav, type NavItem } from "@/components/app/nav";
import { Sidebar } from "@/components/app/sidebar";
import type { OrgContext } from "@/server/lib/api";
import type { NavCounts } from "@/server/services/workspace";
import { RealtimeRefresher } from "@/components/app/realtime";
import { MessageToasts } from "@/components/app/message-toasts";
import { AssistantDrawer } from "@/components/app/assistant-drawer";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { getAdmin } from "@/server/admin/auth";
import { launchSettings } from "@/server/admin/settings";
import { Logo as BrandLogo } from "@/components/logo";
import { MotionRoot, PageRise } from "@/components/ui/motion";

export const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

export function navItems(ctx: OrgContext, counts: NavCounts, teams: { id: string; name: string; is_manager: boolean }[] = []): NavItem[] {
  const base = `/app/${ctx.org.slug}`;
  const role = ctx.membership.role;
  const items: NavItem[] = [];
  if (role === "owner" || role === "hr") {
    // Organisation account: supervision and management only.
    items.push({ href: `${base}/dashboard`, label: "Dashboard", icon: "dashboard" });
    // No Clock in: the organisation account supervises; it sees who has clocked in on the dashboard and Attendance.
    items.push({ href: `${base}/attendance`, label: "Attendance", icon: "attendance" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
    items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks" });
    items.push({ href: `${base}/people`, label: "People and teams", icon: "people" });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined });
    items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings" });
    // Records (timesheets, corrections, CSV export) are reached from Reports and from any person's row; not a top-level item.
    items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects" });
    items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
    items.push({ href: `${base}/audit`, label: "Audit", icon: "audit" });
    return items;
  }
  if (role === "manager") {
    for (const t of teams.filter((t) => t.is_manager)) items.push({ href: `${base}/teams/${t.id}`, label: `${t.name} board`, icon: "board" });
    items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday" });
    items.push({ href: `${base}/clock`, label: "Clock in", icon: "clock" });
    items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks" });
    items.push({ href: `${base}/attendance`, label: "Attendance", icon: "attendance" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined });
    items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings" });
    items.push({ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets" });
    items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects" });
    items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
    return items;
  }
  // Staff: the smallest possible menu.
  items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday" });
  items.push({ href: `${base}/clock`, label: "Clock in", icon: "clock" });
  items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks" });
  items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined });
  items.push({ href: `${base}/timesheets`, label: "My timesheet", icon: "timesheets" });
  items.push({ href: `${base}/policy`, label: "Policy", icon: "policy" });
  return items;
}

/** `bleed` pages (Messages) take the whole area under the top bar with no padding and no width cap, and do not scroll the page. */
export async function AppShell({ ctx, counts, teams = [], children, bleed = false }: { ctx: OrgContext; counts: NavCounts; teams?: { id: string; name: string; is_manager: boolean }[]; children: React.ReactNode; bleed?: boolean }) {
  const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  const [launch, admin] = await Promise.all([launchSettings(), getAdmin()]);
  // Maintenance: administrators pass; everyone else sees the notice (unless app access was left on).
  if (launch.mode === "maintenance" && !launch.app_access && !admin) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 py-24 text-center">
        <BrandLogo />
        <p className="eyebrow eyebrow-accent mt-8">Maintenance</p>
        <h1 className="mt-2 font-display text-2xl">Boredroom is being looked after</h1>
        <p className="mt-2 text-fg-muted">{launch.message || "We are doing some maintenance and will be back shortly. Your records are safe."}</p>
      </main>
    );
  }
  const items = navItems(ctx, counts, teams);
  const pages = [...items.map((i) => ({ label: i.label, href: i.href })), { label: "Notifications", href: `/app/${ctx.org.slug}/notifications` }, { label: "Your profile", href: `/app/${ctx.org.slug}/profile` }, ...(isOrg ? [{ label: "Settings", href: `/app/${ctx.org.slug}/settings` }] : [])];
  const topbar = <TopBar orgSlug={ctx.org.slug} user={{ profileId: ctx.user.profileId, displayName: ctx.user.displayName, email: ctx.user.email, avatarKey: ctx.user.avatarKey, title: ctx.user.title, statusText: ctx.user.statusText, presence: ctx.user.presence, isAdmin: !!admin }} roleLabel={ROLE_LABEL[ctx.membership.role]} isOrg={isOrg} unread={counts.unread} attention={counts.attention} recent={counts.recent ?? []} pages={pages} />;
  return (
    <MotionRoot>
    {ctx.user.impersonation ? <ImpersonationBanner name={ctx.user.displayName} adminEmail={ctx.user.impersonation.adminEmail} /> : null}
    {launch.mode === "maintenance" && launch.app_access ? <p className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-sm">{launch.message || "Maintenance is under way; some things may be slow for a while."}</p> : null}
    <div className={cn("flex min-h-dvh", bleed && "md:h-dvh md:overflow-hidden")}>
      <Sidebar items={items} orgSlug={ctx.org.slug} orgName={ctx.org.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border-soft bg-sidebar px-4 py-3 md:hidden">
          <Logo href={`/app/${ctx.org.slug}`} />
          <div className="flex items-center gap-2">
            {topbar}
            <details className="relative">
              <summary className="chip chip-link cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-sm">Menu</summary>
              <div className="absolute right-0 z-[var(--z-dropdown)] mt-2 w-64 rounded-[var(--radius)] border border-border-strong bg-popover p-3">
                <WorkspaceNav items={items} />
                <div className="mt-3 border-t border-border pt-3"><Link href="/app" className="text-sm text-fg-muted">Switch workspace</Link></div>
              </div>
            </details>
          </div>
        </header>
        <header className="sticky top-0 z-[var(--z-sticky)] hidden h-16 shrink-0 items-center justify-between gap-4 border-b border-border-soft bg-sidebar px-6 md:flex">
          <div className="min-w-0">
            <p className="eyebrow">Workspace</p>
            <p className="truncate text-sm font-semibold leading-tight">{ctx.org.name}</p>
          </div>
          {topbar}
        </header>
        {bleed
          ? <main id="main" className="flex min-h-0 flex-1 flex-col md:h-[calc(100dvh-4rem)]">{children}</main>
          : <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8"><PageRise>{children}</PageRise></main>}
        <AssistantDrawer orgSlug={ctx.org.slug} isOrg={isOrg} firstName={ctx.user.displayName.split(" ")[0]} floating />
        <RealtimeRefresher orgSlug={ctx.org.slug} />
        <Suspense fallback={null}><MessageToasts orgSlug={ctx.org.slug} /></Suspense>
      </div>
    </div>
    </MotionRoot>
  );
}
