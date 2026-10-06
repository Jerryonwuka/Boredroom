import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Clock, CreditCard, Laptop, ScreenShare, SlidersHorizontal } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PermissionDenied, Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { settingsView } from "@/server/services/views";
import { OrgSettingsForm, ScheduleForm, PolicyForm, GrantsPanel, AssistantConnectionForm, RecordingSwitch, SettingsSection, SettingsGroup, SettingsRow, SettingsFooter } from "@/components/app/settings-forms";
import { assistantStatus } from "@/server/services/orgs";
import { brendaOverview } from "@/server/services/brenda";
import { listDevices } from "@/server/services/desktop";
import { BrendaOrgSettings } from "@/components/app/brenda";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { BrendaReportSettings } from "@/components/app/brenda-report-settings";
import { LinkedComputers } from "@/components/app/desktop-link";
import { orgBilling } from "@/server/admin/billing";
import { BillingCard } from "@/components/app/billing-card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

type SectionKey = "general" | "hours" | "recording" | "brenda" | "billing" | "desktop";
const SECTIONS: { key: SectionKey; label: string; icon: ReactNode }[] = [
  { key: "general", label: "General", icon: <SlidersHorizontal aria-hidden /> },
  { key: "hours", label: "Working hours", icon: <Clock aria-hidden /> },
  { key: "recording", label: "Recording", icon: <ScreenShare aria-hidden /> },
  { key: "brenda", label: "Brenda", icon: <BrendaGlyph aria-hidden /> },
  { key: "billing", label: "Billing", icon: <CreditCard aria-hidden /> },
  { key: "desktop", label: "Desktop", icon: <Laptop aria-hidden /> },
];
const MODE_LABEL: Record<string, string> = { disabled: "Off", optional: "On, each person's choice", required_on_designated_tasks: "On, required on marked tasks" };

/**
 * Settings, v4 (owner brief, 6 October 2026): the page header, then a left sub-navigation of sections (General,
 * Working hours, Recording, Brenda, Billing, Desktop; a scrolling row of the same items on a phone) beside the
 * chosen section. Each section is a set of cards of form rows: the label and a hint on the left, the control on the
 * right. The section is in the address (?section=), so links land on it: the billing banner, the Paystack callback
 * and the pricing page (?billing= or ?plan=) open Billing. Owners and HR only; only owners change recording rules,
 * grants and the AI key. Every change is audited.
 */
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ section?: string; setup?: string; billing?: string; plan?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/settings`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied description="Settings are for the organisation account (owners and HR). Your own picture, name and status are under Your profile." /></AppShell>;
  const isOwner = ctx.membership.role === "owner";
  const base = `/app/${ctx.org.slug}`;
  const section: SectionKey = SECTIONS.some((s) => s.key === sp.section) ? (sp.section as SectionKey) : sp.billing || sp.plan ? "billing" : "general";
  const href = (k: SectionKey) => (k === "general" ? `${base}/settings` : `${base}/settings?section=${k}`);

  let body: ReactNode = null;
  if (section === "general" || section === "hours" || section === "recording") {
    const { policy, schedule, grants, members, teams, counts: c } = await settingsView(ctx);
    if (section === "general") {
      const checklist = [
        { label: "Workspace created", done: true },
        { label: "Time zone and schedule set", done: !!schedule, href: href("hours"), go: "Working hours" },
        { label: "Teams defined and managers assigned", done: c.teams > 0, href: `${base}/people`, go: "People and teams" },
        { label: "Recording rules reviewed", done: !!policy && policy.version >= 1, href: href("recording"), go: "Recording" },
        { label: "At least one project", done: c.projects > 0, href: `${base}/projects`, go: "Projects" },
        { label: "Employees invited", done: c.members > 1, href: `${base}/people`, go: "People and teams" },
      ];
      const done = checklist.filter((i) => i.done).length;
      // Brenda can make teams and send invitations, so the two slowest setup steps are the one place here to hand her work.
      const brendaCanHelp = ctx.plan.features.AI_ASSISTANT && (c.teams === 0 || c.members <= 1);
      const types = (policy?.attachment_mime_types ?? []).map((m) => m.split("/")[1]).join(", ");
      body = (
        <>
          <SettingsSection id="organisation" title="Organisation" description="The organisation's name, and the time zone every day is counted in.">
            <OrgSettingsForm orgSlug={ctx.org.slug} name={ctx.org.name} timezone={ctx.org.timezone} />
          </SettingsSection>
          <SettingsSection id="setup" title="Setup" description="What a new workspace needs before people start." action={<span className="text-sm font-medium tabular-nums text-secondary">{done} of {checklist.length} done</span>}>
            <SettingsGroup>
              <div className="px-5 py-4">
                <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={done} aria-valuetext={`${done} of ${checklist.length} steps done`} className="h-1.5 overflow-hidden rounded-full bg-fill-1">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.round((done / checklist.length) * 100)}%` }} />
                </div>
              </div>
              <ul className="divide-y divide-border">
                {checklist.map((i) => (
                  <li key={i.label} className="flex min-h-12 items-center gap-3 px-5 py-2.5">
                    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full", i.done ? "bg-foreground text-background" : "border border-border-input-hover")}>{i.done ? <Check className="size-3" strokeWidth={3} /> : null}</span>
                    <span className={cn("min-w-0 flex-1 text-sm", i.done ? "font-medium text-foreground" : "font-normal text-secondary")}>{i.label}<span className="sr-only">{i.done ? ", done" : ", to do"}</span></span>
                    {!i.done && i.href ? <Link href={i.href} className={buttonVariants({ variant: "ghost", size: "xs" })}>{i.go}</Link> : null}
                  </li>
                ))}
              </ul>
              {brendaCanHelp ? (
                <SettingsFooter>
                  <Link href={`${base}/home?ask=${encodeURIComponent("Help me finish setting up this workspace: create our teams with their team leads, and invite the people who work here.")}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><BrendaGlyph aria-hidden />Ask Brenda to set up teams and invitations</Link>
                </SettingsFooter>
              ) : null}
            </SettingsGroup>
          </SettingsSection>
          <SettingsSection id="attachments" title="Attachments" description="Files people attach to tasks and messages.">
            <SettingsGroup>
              <SettingsRow label="Allowed files" align="text">{types || "None"}</SettingsRow>
              <SettingsRow label="Size limit" align="text"><span className="tabular-nums">{Math.round((policy?.attachment_max_bytes ?? 0) / 1048576)} MB</span> each</SettingsRow>
              <SettingsRow label="Storage" align="text"><span className="text-secondary">Private storage. Downloads use links that last 60 seconds.</span></SettingsRow>
            </SettingsGroup>
          </SettingsSection>
        </>
      );
    } else if (section === "hours") {
      body = (
        <SettingsSection id="hours" title="Working hours and clocking" description={`Everyone clocks in and out against these times, in the organisation's time zone (${ctx.org.timezone}).`}>
          <ScheduleForm orgSlug={ctx.org.slug} schedule={schedule} />
        </SettingsSection>
      );
    } else {
      const recording = policy?.recording_mode ?? "disabled";
      body = (
        <>
          <SettingsSection id="recording" title="Screen recording" description="When on, staff and team leads see Record screen in their timer. Nothing records until they press it, and the first time they do, they read the notice and agree to it before anything is captured."
            action={<Badge tone={recording === "disabled" ? "neutral" : "success"} dot>{MODE_LABEL[recording] ?? "On"}</Badge>}>
            <SettingsGroup>
              <SettingsRow label="Recording" hint="Switching publishes a new notice version, which each person agrees to once, the next time they record.">
                {isOwner ? <RecordingSwitch orgSlug={ctx.org.slug} mode={recording} /> : <p className="text-sm font-normal text-secondary md:pt-2">Only owners can change this.</p>}
              </SettingsRow>
            </SettingsGroup>
          </SettingsSection>
          <SettingsSection id="notice" title="Recording rules and notice" description="Publishing creates a new version. Nobody signs it in advance: each person agrees to it once, at the moment they start a recorded session."
            action={policy ? <Badge>Version <span className="tabular-nums">{policy.version}</span></Badge> : null}>
            <div className="grid gap-3">
              {isOwner ? <PolicyForm orgSlug={ctx.org.slug} policy={policy} /> : <Alert tone="info">Only owners can publish policy versions.</Alert>}
              <SettingsGroup>
                <SettingsRow label="Agreed so far" hint="People who have agreed to the current version." align="text"><span className="tabular-nums">{c.acknowledged}</span> of <span className="tabular-nums">{c.members}</span></SettingsRow>
                <SettingsRow label="Heartbeat" hint="How often a running session checks in." align="text">Every <span className="tabular-nums">{policy?.heartbeat_seconds ?? 30}</span> seconds; stale after <span className="tabular-nums">{policy?.stale_after_seconds ?? 90}</span></SettingsRow>
              </SettingsGroup>
            </div>
          </SettingsSection>
          <SettingsSection id="grants" title="Recording access" description="Supervisors (the owner, HR and a person's team lead) can watch their people's recordings. Grants extend playback to anyone else; every grant and every play is logged.">
            <GrantsPanel orgSlug={ctx.org.slug} grants={grants} members={members} teams={teams} isOwner={isOwner} />
          </SettingsSection>
        </>
      );
    }
  } else if (section === "brenda") {
    const [ai, brenda] = await Promise.all([assistantStatus(ctx), brendaOverview(ctx)]);
    body = (
      <>
        <SettingsSection id="brenda" title="Brenda" description="Brenda is the AI teammate in every workspace page. She reads what each person is allowed to see, does their own work for them, and asks before anything that lands on someone else. Every action is logged below."
          action={<Badge tone={ai.source === "none" ? "warning" : "success"} dot>{ai.source === "none" ? "AI not connected" : "On Claude"}</Badge>}>
          <div className="card-panel"><BrendaOrgSettings orgSlug={ctx.org.slug} initial={brenda} canEdit /></div>
        </SettingsSection>
        {/* The Reports page is gone; Brenda sends supervisors the day's team report instead (owner decision, 5 October 2026). */}
        <BrendaReportSettings orgSlug={ctx.org.slug} initial={brenda.settings} timezone={ctx.org.timezone} inPlan={ctx.plan.features.AI_ASSISTANT === true} />
        <SettingsSection id="ai" title="AI connection" description="Brenda runs on Claude. Connect an Anthropic API key so she can act; without one a simple built-in helper answers and only suggests, and says so.">
          {isOwner ? <AssistantConnectionForm orgSlug={ctx.org.slug} status={ai} /> : <Alert tone="info">Only owners can connect Brenda to Claude.</Alert>}
        </SettingsSection>
      </>
    );
  } else if (section === "billing") {
    const billing = await orgBilling(ctx);
    body = (
      <SettingsSection id="billing" title="Plan and billing" description="What the organisation is on, and the other plans.">
        <BillingCard preselect={sp.plan} orgSlug={ctx.org.slug} data={billing} notice={sp.billing} />
      </SettingsSection>
    );
  } else {
    const devices = await listDevices(ctx.user);
    body = (
      <SettingsSection id="desktop" title="Brenda desktop" description="Brenda on your computer acts as you, with your permissions, in the workspace you approve it for. Each person links their own computers; these are yours.">
        <SettingsGroup>
          <SettingsRow label="Link a computer" hint="Open Brenda desktop and press Sign in. It shows a code and opens a page in your browser to approve it." align="text">
            <Link href="/desktop/link" className={buttonVariants({ variant: "secondary", size: "sm" })}>Enter a code</Link>
          </SettingsRow>
          <div className="px-5 pb-2 pt-4">
            <p className="text-sm font-medium text-foreground">Linked computers</p>
            <LinkedComputers devices={devices} empty />
          </div>
        </SettingsGroup>
      </SettingsSection>
    );
  }

  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader title="Settings" description="How the workspace runs: working hours, screen recording, Brenda, the plan and your linked computers. Every change is audited." divider />
      {sp.setup ? <Alert tone="success" className="mb-6" title="Workspace ready">Work through the setup list to finish.</Alert> : null}
      <div className="grid gap-6 md:grid-cols-[12.5rem_minmax(0,1fr)] md:gap-10">
        {/* Sub-navigation (spec §6): 32px items, r8, fill-1 for the open one, fill-0 on hover; a scrolling row on a phone. */}
        <nav aria-label="Settings sections" className="-mx-1 min-w-0 md:sticky md:top-[calc(var(--header-height)+1.5rem)] md:mx-0 md:self-start">
          <ul className="flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-col md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {SECTIONS.map((s) => {
              const active = s.key === section;
              return (
                <li key={s.key} className="shrink-0">
                  <Link href={href(s.key)} aria-current={active ? "page" : undefined}
                    className={cn("flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors duration-75 pointer-coarse:h-10 [&_svg]:size-4 [&_svg]:shrink-0", active ? "bg-fill-1 text-foreground [&_svg]:text-foreground" : "text-secondary hover:bg-fill-0 hover:text-foreground [&_svg]:text-secondary")}>
                    {s.icon}{s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 max-w-[56rem] space-y-10">{body}</div>
      </div>
    </AppShell>
  );
}
