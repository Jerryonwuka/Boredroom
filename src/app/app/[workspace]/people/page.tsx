import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied } from "@/components/ui/states";
import { peopleView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { InviteForm, MemberRow, TeamsPanel, InvitationRow } from "@/components/app/people-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

export default async function PeoplePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/people`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts}><PermissionDenied /></AppShell>;
  const { members, invitations, teams } = await peopleView(ctx);
  const isOwner = ctx.membership.role === "owner";
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline="People" title="Members and invitations" description="Invitations are email-bound, single-use and expire after 72 hours. Nothing is sent until you click Invite." actions={<InviteForm orgSlug={ctx.org.slug} teams={teams} isOwner={isOwner} />} />
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
        <p className="mt-2 text-xs text-fg-subtle"><Badge>manager</Badge> flags in the Teams column above mark who reviews that team&apos;s records.</p>
      </section>
    </AppShell>
  );
}
