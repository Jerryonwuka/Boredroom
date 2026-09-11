import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied } from "@/components/ui/states";
import { peopleView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { InviteForm, MemberRow, TeamsPanel, InvitationRow, JoinCodePanel } from "@/components/app/people-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

export default async function PeoplePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/people`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied /></AppShell>;
  const { members, invitations, teams, joinCode } = await peopleView(ctx);
  const isOwner = ctx.membership.role === "owner";
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader overline="People" title="People, teams and access" description="Staff can only join through your join code or link, or an email invitation you send. You decide teams and who leads them." actions={<InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} />} />
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg">Join code and link</h2>
        <JoinCodePanel orgSlug={ctx.org.slug} appOrigin={process.env.APP_ORIGIN ?? "http://localhost:3000"} joinCode={joinCode} teams={teams} />
      </section>
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg">Members</h2>
        <DataTable caption="Members">
          <thead><tr><th>Name</th><th>Employee ID</th><th>Role</th><th>Teams</th><th>Policy</th><th>Actions</th></tr></thead>
          <tbody>{members.map((m) => (
            <MemberRow key={m.id} orgSlug={ctx.org.slug} member={m} teams={teams} isOwner={isOwner} self={m.id === ctx.membership.id} />
          ))}</tbody>
        </DataTable>
      </section>
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg">Invitations</h2>
        {invitations.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No invitations yet.</p> : (
          <DataTable caption="Invitations">
            <thead><tr><th>Email</th><th>Role</th><th>Team</th><th>State</th><th>Expires</th><th></th></tr></thead>
            <tbody>{invitations.map((i) => {
              const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
              return <InvitationRow key={i.id} orgSlug={ctx.org.slug} id={i.id} email={i.email} role={i.role} team={i.team_name} state={state} expires={formatDateTime(i.expires_at, ctx.org.timezone)} sent={!!i.sent_at} />;
            })}</tbody>
          </DataTable>
        )}
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg">Teams</h2>
        <TeamsPanel orgSlug={ctx.org.slug} teams={teams} />
        {teams.length ? <ul className="mt-3 grid gap-2 md:grid-cols-2">{teams.map((t) => <li key={t.id} className="tile flex items-center justify-between px-4 py-3"><span><Link href={`/app/${ctx.org.slug}/teams/${t.id}`} className="font-semibold hover:underline">{t.name}</Link><p className="text-xs text-fg-subtle">{t.member_count} member{t.member_count === 1 ? "" : "s"} · lead: {t.leads.length ? t.leads.join(", ") : <span className="text-warning">none yet</span>}</p></span><Link href={`/app/${ctx.org.slug}/teams/${t.id}`} className="text-sm underline">Open board</Link></li>)}</ul> : null}
        <p className="mt-2 text-xs text-fg-subtle"><Badge tone="accent">Team lead</Badge> in the Teams column marks who creates and assigns that team&apos;s tasks and reviews its records.</p>
      </section>
    </AppShell>
  );
}
