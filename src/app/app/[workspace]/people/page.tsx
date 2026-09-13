import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied, EmptyState } from "@/components/ui/states";
import { peopleView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { InviteForm, MemberRow, NewTeamForm, InvitationRow, JoinCodePanel } from "@/components/app/people-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "People and teams" };

const TABS = [
  { key: "teams", label: "Teams" },
  { key: "people", label: "People" },
  { key: "invitations", label: "Invitations" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/people`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied /></AppShell>;
  const { members, invitations, teams, joinCode } = await peopleView(ctx);
  const isOwner = ctx.membership.role === "owner";
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "teams";
  const base = `/app/${ctx.org.slug}`;
  const activeMembers = members.filter((m) => m.status !== "revoked");
  const pendingInvites = invitations.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) >= new Date()).length;
  const countFor: Record<TabKey, number> = { teams: teams.length, people: activeMembers.length, invitations: pendingInvites };
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader back={{ href: `${base}/dashboard`, label: "Dashboard" }} overline="People and teams" title="People and teams"
        description="Create teams and put a team lead on each. Add people with your join code or an invitation, then place them in a team."
        actions={tab === "teams" ? <NewTeamForm orgSlug={ctx.org.slug} /> : tab === "people" ? <InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} label="Add new person" /> : <InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} label="Send an invitation" />} />

      <nav aria-label="Sections" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t.key} href={`${base}/people?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === t.key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}>
            {t.label}<span className={`rounded-full px-2 py-0.5 text-xs ${tab === t.key ? "bg-accent-soft text-accent" : "bg-inset text-fg-subtle"}`}>{countFor[t.key]}</span>
          </Link>
        ))}
      </nav>

      {tab === "teams" ? (
        <section aria-labelledby="teams-heading">
          <h2 id="teams-heading" className="sr-only">Teams</h2>
          {teams.length === 0 ? <EmptyState title="No teams yet" description="Create teams such as Design, Tech or Branding with “Add new team”. Then open a team to add people and choose its lead." /> : (
            <ul className="grid gap-3 md:grid-cols-2">
              {teams.map((t) => (
                <li key={t.id}>
                  <Link href={`${base}/teams/${t.id}`} className="tile block p-5 hover:border-border-strong">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-xl">{t.name}</p>
                        <p className="mt-1 text-sm text-fg-muted">{t.member_count} member{t.member_count === 1 ? "" : "s"}</p>
                      </div>
                      <Badge tone={t.leads.length ? "accent" : "warning"}>{t.leads.length ? `Lead: ${t.leads.join(", ")}` : "No lead yet"}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-accent">Open team → add people, choose the lead, see their tasks</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-fg-subtle">Team leads create and assign tasks for their team and check finished work. Each team gets its own working project automatically.</p>
        </section>
      ) : null}

      {tab === "people" ? (
        <section aria-labelledby="people-heading" className="space-y-6">
          <h2 id="people-heading" className="sr-only">People</h2>
          <div>
            <h3 className="mb-2 font-display text-lg">Join code and link</h3>
            <JoinCodePanel orgSlug={ctx.org.slug} appOrigin={process.env.APP_ORIGIN ?? "http://localhost:3000"} joinCode={joinCode} teams={teams} />
          </div>
          <div>
            <h3 className="mb-2 font-display text-lg">Everyone ({activeMembers.length})</h3>
            <DataTable caption="Members">
              <thead><tr><th>Name</th><th>Employee ID</th><th>Role</th><th>Teams</th><th>Policy</th><th>Actions</th></tr></thead>
              <tbody>{members.map((m) => (
                <MemberRow key={m.id} orgSlug={ctx.org.slug} member={m} teams={teams} isOwner={isOwner} self={m.id === ctx.membership.id} />
              ))}</tbody>
            </DataTable>
            <p className="mt-2 text-xs text-fg-subtle"><Badge tone="accent">Team lead</Badge> in the Teams column marks who creates and assigns that team&apos;s tasks and checks its work. Click a name on a team page to see that person&apos;s records.</p>
          </div>
        </section>
      ) : null}

      {tab === "invitations" ? (
        <section aria-labelledby="inv-heading">
          <h2 id="inv-heading" className="sr-only">Invitations</h2>
          {invitations.length === 0 ? <EmptyState title="No invitations yet" description="Invitations are email links for people who should join with a specific role or team. Most staff can simply use the join code on the People tab." /> : (
            <DataTable caption="Invitations">
              <thead><tr><th>Email</th><th>Role</th><th>Team</th><th>State</th><th>Expires</th><th></th></tr></thead>
              <tbody>{invitations.map((i) => {
                const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                return <InvitationRow key={i.id} orgSlug={ctx.org.slug} id={i.id} email={i.email} role={{ owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" }[i.role] ?? i.role} team={i.team_name} state={state} expires={formatDateTime(i.expires_at, ctx.org.timezone)} sent={!!i.sent_at} />;
              })}</tbody>
            </DataTable>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
