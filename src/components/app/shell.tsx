import { Logo } from "@/components/logo";
import { TopBar } from "@/components/app/topbar";
import { MobileNav, Sidebar, type NavItem, type SidebarNotice } from "@/components/app/sidebar";
import type { OrgContext } from "@/server/lib/api";
import type { Entitlements } from "@/server/lib/entitlements";
import type { NavCounts } from "@/server/services/workspace";
import { listMyWorkspaces } from "@/server/services/orgs";
import { RealtimeRefresher } from "@/components/app/realtime";
import { MessageToasts } from "@/components/app/message-toasts";
import { AssistantDrawer } from "@/components/app/assistant-drawer";
import { BrendaPresence } from "@/components/app/brenda";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { ImpersonationBanner, ShellBanners } from "@/components/app/impersonation-banner";
import { BillingBanner, ShellStrip } from "@/components/app/billing-banner";
import { Badge } from "@/components/ui/badge";
import { getAdmin } from "@/server/admin/auth";
import { launchSettings } from "@/server/admin/settings";
import { MotionRoot, PageRise } from "@/components/ui/motion";

export const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

export function navItems(ctx: OrgContext, counts: NavCounts, teams: { id: string; name: string; is_manager: boolean }[] = []): NavItem[] {
  const base = `/app/${ctx.org.slug}`;
  const role = ctx.membership.role;
  // Brenda's page first for everyone, named after her and marked with her face; the URL stays /home (owner decision,
  // 5 October 2026). Reports and Policy are gone for every role: Brenda sends supervisors the end-of-day report, and
  // working hours and recording rules live in Settings.
  const items: NavItem[] = [{ href: `${base}/home`, label: "Brenda", icon: "brenda", group: "Overview" }];
  if (role === "owner" || role === "hr") {
    // Organisation account: supervision and management only.
    items.push({ href: `${base}/dashboard`, label: "Dashboard", icon: "dashboard", group: "Overview" });
    // No Clock in: the organisation account supervises; it sees who has clocked in on the dashboard and Attendance.
    items.push({ href: `${base}/attendance`, label: "Attendance", icon: "attendance", group: "Overview" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team", group: "Overview" });
    items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks", group: "Work" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined, group: "Work" });
    items.push({ href: `${base}/docs`, label: "Docs", icon: "docs", group: "Work" });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined, group: "Work" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects", group: "Work" });
    items.push({ href: `${base}/people`, label: "People and teams", icon: "people", group: "Organisation" });
    if (ctx.plan.features.VIDEO_RECORDING) items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings", group: "Organisation" });
    // Records (timesheets, corrections, CSV export) were reached from Reports; with Reports gone they need their own item.
    items.push({ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets", group: "Organisation" });
    if (ctx.plan.features.AUDIT_LOGS) items.push({ href: `${base}/audit`, label: "Audit", icon: "audit", group: "Others" });
    return items;
  }
  if (role === "manager") {
    items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday", group: "Overview" });
    items.push({ href: `${base}/clock`, label: "Clock in", icon: "clock", group: "Overview" });
    for (const t of teams.filter((t) => t.is_manager)) items.push({ href: `${base}/teams/${t.id}`, label: `${t.name} board`, icon: "board", group: "Team" });
    items.push({ href: `${base}/workroom`, label: "Workroom", icon: "team", group: "Team" });
    items.push({ href: `${base}/attendance`, label: "Attendance", icon: "attendance", group: "Team" });
    items.push({ href: `${base}/reviews`, label: "Reviews", icon: "reviews", badge: counts.attention || undefined, group: "Team" });
    // The to-do list has its own page (owner request, 7 October 2026), first in Work.
    items.push({ href: `${base}/todos`, label: "To-dos", icon: "todos", group: "Work" });
    items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks", group: "Work" });
    items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined, group: "Work" });
    items.push({ href: `${base}/docs`, label: "Docs", icon: "docs", group: "Work" });
    items.push({ href: `${base}/projects`, label: "Projects", icon: "projects", group: "Work" });
    if (ctx.plan.features.VIDEO_RECORDING) items.push({ href: `${base}/recordings`, label: "Recordings", icon: "recordings", group: "Work" });
    items.push({ href: `${base}/timesheets`, label: "Timesheets", icon: "timesheets", group: "Records" });
    return items;
  }
  // Staff: the smallest possible menu.
  items.push({ href: `${base}/my-day`, label: "My Day", icon: "myday", group: "Overview" });
  items.push({ href: `${base}/clock`, label: "Clock in", icon: "clock", group: "Overview" });
  items.push({ href: `${base}/todos`, label: "To-dos", icon: "todos", group: "Work" });
  items.push({ href: `${base}/tasks`, label: "Tasks", icon: "tasks", group: "Work" });
  items.push({ href: `${base}/messages`, label: "Messages", icon: "messages", badge: counts.messages || undefined, group: "Work" });
  items.push({ href: `${base}/docs`, label: "Docs", icon: "docs", group: "Work" });
  items.push({ href: `${base}/timesheets`, label: "My timesheet", icon: "timesheets", group: "Records" });
  return items;
}

/**
 * The sidebar's tinted card for the people who run the workspace: a trial running out. Anything the billing strip
 * already says (a lapsed plan, a failed payment, a plan ending within the week) is left to the strip.
 */
function planNotice(plan: Entitlements, orgSlug: string): SidebarNotice | null {
  if (plan.lapsed || plan.status === "payment_failed" || plan.status === "past_due") return null;
  if (plan.status !== "trial" || plan.daysLeft === null || plan.daysLeft < 0) return null;
  if (plan.daysLeft <= 7 && !plan.autoRenew) return null;
  const left = plan.daysLeft === 0 ? "ends today" : `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left`;
  return { title: `Trial: ${left}`, body: "Choose a plan to keep its modules after the trial.", href: `/app/${orgSlug}/settings?billing=1#billing`, cta: "See plans" };
}

/**
 * The app frame, v4 (spec §6, owner decision 6 October 2026): the 256px sidebar on the left (a 56px rail when
 * collapsed, a sheet from the left below md), the 50px top bar over the page, and the page itself at full width with
 * 20px sides and 24px under the bar. Strips above it all (impersonation, billing, maintenance) stay pinned at the top.
 *
 * `bleed` pages (Messages) take the whole area under the top bar with no padding and do not scroll the page: the
 * screen's height less any strip above the shell (--shell-banners), as Brenda's chat does. Brenda's chat itself hides
 * the top bar and drops the page's padding through globals.css (`[data-app-topbar]`, `#main`, `#workspace-sidebar`).
 */
export async function AppShell({ ctx, counts, teams = [], children, bleed = false }: { ctx: OrgContext; counts: NavCounts; teams?: { id: string; name: string; is_manager: boolean }[]; children: React.ReactNode; bleed?: boolean }) {
  const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  // The workspace menu lists the person's workspaces; if that list cannot be read, it shows this one alone.
  const [launch, admin, mine] = await Promise.all([launchSettings(), getAdmin(), listMyWorkspaces(ctx.user.profileId).catch(() => [])]);
  // Maintenance: administrators pass; everyone else sees the notice (unless app access was left on).
  if (launch.mode === "maintenance" && !launch.app_access && !admin) {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-24 text-center">
        <Logo height={18} />
        <Badge tone="warning" dot className="mt-8">Maintenance</Badge>
        <h1 className="type-page-title mt-3">Boredroom is being looked after</h1>
        <p className="mt-2 text-sm font-normal text-secondary">{launch.message || "We are doing some maintenance and will be back shortly. Your records are safe."}</p>
      </main>
    );
  }
  const base = `/app/${ctx.org.slug}`;
  const items = navItems(ctx, counts, teams);
  const pages = [
    ...items.map((i) => ({ label: i.label, href: i.href, group: i.group })),
    { label: "Notifications", href: `${base}/notifications`, group: "Account" },
    { label: "Your profile", href: `${base}/profile`, group: "Account" },
    ...(isOrg ? [{ label: "Settings", href: `${base}/settings`, group: "Organisation" }] : []),
  ];
  const brenda = ctx.plan.features.AI_ASSISTANT === true;
  const workspaces = mine.map((w) => ({ slug: w.slug, name: w.name }));
  const notice = isOrg ? planNotice(ctx.plan, ctx.org.slug) : null;
  const nav = { items, orgSlug: ctx.org.slug, orgName: ctx.org.name, workspaces, isOrg, notice };
  return (
    <MotionRoot>
    <ShellBanners>
      {ctx.user.impersonation ? <ImpersonationBanner name={ctx.user.displayName} adminEmail={ctx.user.impersonation.adminEmail} /> : null}
      {isOrg ? <BillingBanner orgSlug={ctx.org.slug} plan={ctx.plan} /> : null}
      {launch.mode === "maintenance" && launch.app_access ? <ShellStrip tone="warning">{launch.message || "Maintenance is under way; some things may be slow for a while."}</ShellStrip> : null}
    </ShellBanners>
    <div className={cn("flex min-h-[calc(100dvh-var(--shell-banners,0px))]", bleed && "md:h-[calc(100dvh-var(--shell-banners,0px))] md:overflow-hidden")}>
      <Sidebar {...nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar orgSlug={ctx.org.slug} orgName={ctx.org.name} roleLabel={ROLE_LABEL[ctx.membership.role]} isOrg={isOrg} unread={counts.unread} attention={counts.attention} recent={counts.recent ?? []} pages={pages} brenda={brenda}
          user={{ profileId: ctx.user.profileId, displayName: ctx.user.displayName, email: ctx.user.email, avatarKey: ctx.user.avatarKey, title: ctx.user.title, statusText: ctx.user.statusText, presence: ctx.user.presence, isAdmin: !!admin }}
          menu={<MobileNav {...nav} className="md:hidden" />} />
        {bleed
          ? <main id="main" className="flex min-h-0 flex-1 flex-col md:h-[calc(100dvh-var(--header-height)-var(--shell-banners,0px))]">{children}</main>
          : <main id="main" className="w-full min-w-0 flex-1 px-5 pb-16 pt-6"><PageRise>{children}</PageRise></main>}
        {ctx.plan.features.AI_ASSISTANT ? <AssistantDrawer orgSlug={ctx.org.slug} isOrg={isOrg} firstName={ctx.user.displayName.split(" ")[0]} floating /> : null}
        {ctx.plan.features.AI_ASSISTANT && !isOrg ? <BrendaPresence orgSlug={ctx.org.slug} /> : null}
        <RealtimeRefresher orgSlug={ctx.org.slug} />
        <Suspense fallback={null}><MessageToasts orgSlug={ctx.org.slug} /></Suspense>
      </div>
    </div>
    </MotionRoot>
  );
}
