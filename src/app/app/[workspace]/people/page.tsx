import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { Badge, CountPill } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied, EmptyState } from "@/components/ui/states";
import { peopleView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { InviteForm, MemberRow, NewTeamForm, InvitationRow, JoinCodePanel } from "@/components/app/people-forms";
import { buttonVariants } from "@/components/ui/button";
import { ICON_BUTTON } from "@/components/ui/icon-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "People and teams" };

const TABS = [
  { key: "teams", label: "Teams" },
  { key: "people", label: "People" },
  { key: "invitations", label: "Invitations" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const ROLE = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" } as Record<string, string>;

/**
 * People and teams, v4: the title with underline tabs (Teams, People, Invitations) and the tab's one action on the
 * right, the screen's orange standout (accent rules, 6 October 2026: "Add people"); calm tables underneath. The People tab opens with the join code in a section card.
 */
export default async function PeoplePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/people`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PageHeader title="People and teams" divider /><PermissionDenied /></AppShell>;
  const { members, invitations, teams, joinCode } = await peopleView(ctx);
  const isOwner = ctx.membership.role === "owner";
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "teams";
  const base = `/app/${ctx.org.slug}`;
  const activeMembers = members.filter((m) => m.status !== "revoked");
  const pendingInvites = invitations.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) >= new Date()).length;
  const countFor: Record<TabKey, number> = { teams: teams.length, people: activeMembers.length, invitations: pendingInvites };
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader title="People and teams"
        description="Create teams and put a team lead on each. Add people with your join code or an invitation, then place them in a team."
        actions={tab === "teams" ? (teams.length ? <NewTeamForm orgSlug={ctx.org.slug} /> : null) : tab === "people" ? <InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} label="Add new person" /> : <InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} label="Send an invitation" />}
        tabsLabel="Sections" tabValue={tab}
        tabs={TABS.map((t) => ({ value: t.key, label: t.label, count: countFor[t.key], href: `${base}/people?tab=${t.key}` }))} />

      {tab === "teams" ? (
        <section aria-labelledby="teams-heading">
          <h2 id="teams-heading" className="sr-only">Teams</h2>
          {teams.length === 0 ? <EmptyState icon3d="people" title="No teams yet" description="Create teams such as Design, Tech or Branding, then open one to add people and choose its lead." action={<NewTeamForm orgSlug={ctx.org.slug} />} /> : (
            <DataTable caption="Teams">
              <thead><tr><th>Team</th><th>Team lead</th><th className="!text-right">Members</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{teams.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`${base}/teams/${t.id}`} className="font-medium hover:underline">{t.name}</Link></td>
                  <td>{t.leads.length ? <span className="text-foreground">{t.leads.join(", ")}</span> : <Badge tone="warning" dot>No lead yet</Badge>}</td>
                  <td className="text-right tabular-nums">{t.member_count}</td>
                  <td className="w-10"><span className="flex justify-end"><Link href={`${base}/teams/${t.id}`} aria-label={`Open ${t.name}`} className={ICON_BUTTON}><ChevronRight aria-hidden /></Link></span></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
          <p className="mt-6 max-w-3xl text-meta font-normal text-secondary">Open a team to add people, choose its lead and see its tasks. Team leads create and assign their team&apos;s tasks and check finished work; each team gets its own project automatically.</p>
        </section>
      ) : null}

      {tab === "people" ? (
        <div className="space-y-10">
          <section aria-labelledby="join-heading">
            <SectionTitle id="join-heading" title="Join code" description="The quickest way for staff to join: they enter the code or open the link." />
            <JoinCodePanel orgSlug={ctx.org.slug} joinCode={joinCode} teams={teams} />
          </section>
          <section aria-labelledby="people-heading">
            <SectionTitle id="people-heading" title={<span className="inline-flex items-center gap-2">Everyone<CountPill count={activeMembers.length} showZero /></span>} />
            <DataTable caption="Members">
              <thead><tr><th>Name</th><th>Employee ID</th><th>Role</th><th>Teams</th><th>Recording rules</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{members.map((m) => (
                <MemberRow key={m.id} orgSlug={ctx.org.slug} member={m} teams={teams} isOwner={isOwner} self={m.id === ctx.membership.id} />
              ))}</tbody>
            </DataTable>
            <p className="mt-6 max-w-3xl text-meta font-normal text-secondary">Team leads create and assign their team&apos;s tasks and check its work. Recording rules shows whether each person has agreed to the current rules (asked the first time they record). Open a team to see a person&apos;s records.</p>
          </section>
        </div>
      ) : null}

      {tab === "invitations" ? (
        <section aria-labelledby="inv-heading">
          <h2 id="inv-heading" className="sr-only">Invitations</h2>
          {invitations.length === 0 ? <EmptyState icon3d="doc-link-check" title="No invitations yet" description="Invitations are email links for people who should join with a set role or team. Most staff can use the join code on the People tab instead." action={<Link href={`${base}/people?tab=people`} className={buttonVariants({ variant: "secondary", size: "sm" })}>See the join code</Link>} /> : (
            <DataTable caption="Invitations">
              <thead><tr><th>Email</th><th>Role</th><th>Team</th><th>State</th><th>Expires</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{invitations.map((i) => {
                const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                return <InvitationRow key={i.id} orgSlug={ctx.org.slug} id={i.id} email={i.email} role={ROLE[i.role] ?? i.role} team={i.team_name} state={state} expires={formatDateTime(i.expires_at, ctx.org.timezone)} sent={!!i.sent_at} />;
              })}</tbody>
            </DataTable>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
