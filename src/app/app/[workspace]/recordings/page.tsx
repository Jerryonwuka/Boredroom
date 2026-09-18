import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { RecordingsTable } from "@/components/app/recordings-table";
import { listRecordings, pendingAssembly } from "@/server/services/recording";
import { Alert } from "@/components/ui/states";
import { withUser } from "@/server/db";
import { myTeams } from "@/server/services/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordings" };

/** Every screen recording the caller may watch: the whole organisation for owners and HR, their teams for leads. */
export default async function RecordingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string; member?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/recordings`);
  const role = ctx.membership.role;
  if (role === "employee") return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied description="Your own recordings are listed on each task you recorded. Team leads and the organisation account see recordings here." /></AppShell>;
  const isOrg = role === "owner" || role === "hr";
  const teams = isOrg
    ? await withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]))
    : (await myTeams(ctx)).filter((t) => t.is_manager);
  const members = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(
    `SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND m.role IN ('employee','manager') AND app_can_view_records($1, m.id) ORDER BY pr.display_name`, [ctx.org.id]));
  const [rows, waiting] = await Promise.all([listRecordings(ctx, { teamId: sp.team || null, membershipId: sp.member || null, limit: 200 }), pendingAssembly(ctx)]);
  const base = `/app/${ctx.org.slug}`;
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader back={{ href: isOrg ? `${base}/dashboard` : base, label: isOrg ? "Dashboard" : "Back" }} title="Recordings"
        description={isOrg ? "Every screen recording in the organisation, newest first. Open a task to see who worked on it, the sessions, and the footage for each one." : "Screen recordings from the people on your teams, newest first. Open a task to see the full history."} />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        {teams.length > 1 || isOrg ? <label><span className="block text-xs text-fg-subtle">Team</span><Select name="team" defaultValue={sp.team ?? ""} className="h-10 w-48 py-1 text-sm"><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label> : null}
        <label><span className="block text-xs text-fg-subtle">Person</span><Select name="member" defaultValue={sp.member ?? ""} className="h-10 w-56 py-1 text-sm"><option value="">Everyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></label>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        {sp.team || sp.member ? <Link href={`${base}/recordings`} className="text-sm underline">Clear</Link> : null}
      </form>
      {waiting ? <Alert tone="warning" className="mb-4" title={`${waiting} recording${waiting === 1 ? " is" : "s are"} waiting to be assembled`}>Uploaded chunks become a watchable video only when the background worker runs. <code>pnpm dev</code> now starts it automatically; on a server run <code>pnpm worker</code> alongside <code>pnpm start</code>.</Alert> : null}
      {rows.length === 0 ? <EmptyState title="No recordings yet" description="A recording appears here as soon as someone presses Record screen while their timer runs. Recording must be on under Settings, and each person acknowledges the notice once." action={isOrg ? <Link href={`${base}/settings`} className="underline">Check the recording setting</Link> : undefined} /> : (
        <RecordingsTable orgSlug={ctx.org.slug} rows={rows} timeZone={ctx.org.timezone} />
      )}
      <p className="mt-4 text-xs text-fg-subtle">Recordings are video only, started by the person, and kept for the retention period in the monitoring policy. Footage a person flags as sensitive is locked until a privacy administrator reviews it.</p>
    </AppShell>
  );
}
