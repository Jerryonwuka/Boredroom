import Link from "next/link";
import { CirclePlay, Clock, MonitorPlay, Lock } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { UpgradeGate } from "@/components/app/upgrade-gate";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PermissionDenied, Alert } from "@/components/ui/states";
import { FilterBar, FilterSelect } from "@/components/ui/filter-control";
import { RecordingsTable } from "@/components/app/recordings-table";
import { listRecordings, pendingAssembly } from "@/server/services/recording";
import { withUser } from "@/server/db";
import { uuid } from "@/server/lib/api";
import { myTeams } from "@/server/services/views";
import { formatDuration } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordings" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

const LIMIT = 200;
const idOrNull = (s: string | undefined) => (s && uuid.safeParse(s).success ? s : null);

/**
 * Every screen recording the caller may watch, v4: the whole organisation for owners and HR, their teams for leads.
 * The filter bar (Team, Person; each applies itself), four stat cards over what is listed, then a calm table whose
 * Watch opens the player in a side sheet.
 */
export default async function RecordingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string; member?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/recordings`);
  const role = ctx.membership.role;
  if (!ctx.plan.features.VIDEO_RECORDING) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><UpgradeGate feature="VIDEO_RECORDING" orgSlug={ctx.org.slug} planName={ctx.plan.plan?.name ?? null} upgradeTo={ctx.plan.upgradeTo} isOwner={role === "owner" || role === "hr"} lapsed={ctx.plan.lapsed} /></AppShell>;
  if (role === "employee") return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PageHeader title="Recordings" divider /><PermissionDenied description="Your own recordings are listed on each task you recorded. Team leads and the organisation account see recordings here." /></AppShell>;
  const isOrg = role === "owner" || role === "hr";
  // Ids from the address bar are checked before they reach a uuid column: a mistyped link shows everyone, not an error.
  const teamId = idOrNull(sp.team);
  const memberId = idOrNull(sp.member);
  const [teams, members, rows, waiting] = await Promise.all([
    isOrg
      ? withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]))
      : myTeams(ctx).then((t) => t.filter((x) => x.is_manager)),
    withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(
      `SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND m.role IN ('employee','manager') AND app_can_view_records($1, m.id) ORDER BY pr.display_name`, [ctx.org.id])),
    listRecordings(ctx, { teamId, membershipId: memberId, limit: LIMIT }),
    pendingAssembly(ctx),
  ]);
  const base = `/app/${ctx.org.slug}`;
  const filtered = !!(teamId || memberId);
  const ready = rows.filter((r) => r.upload_state === "ready" && !r.restricted_at).length;
  const restricted = rows.filter((r) => r.restricted_at).length;
  const recordedSeconds = rows.reduce((a, r) => a + r.duration_seconds, 0);
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader title="Recordings" divider
        description={isOrg ? "Every screen recording in the organisation, newest first. Open a task to see who worked on it, its sessions and the footage for each." : "Screen recordings from the people on your teams, newest first. Open a task to see its full history."} />
      {/* Each filter applies itself (owner decision, 26 September 2026: no Show buttons). */}
      <form className="mb-6" action={`${base}/recordings`}>
        <FilterBar>
          {teams.length > 1 || isOrg ? <FilterSelect key={`t-${teamId}`} id="rec-team" label="Team" name="team" defaultValue={teamId ?? ""} autoSubmit options={[{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} /> : null}
          <FilterSelect key={`m-${memberId}`} id="rec-member" label="Person" name="member" defaultValue={memberId ?? ""} autoSubmit options={[{ value: "", label: "Everyone" }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]} />
          {filtered ? <Link href={`${base}/recordings`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Clear filters</Link> : null}
        </FilterBar>
      </form>
      {waiting ? <Alert tone="warning" className="mb-6" title={`${waiting} recording${waiting === 1 ? " is" : "s are"} still being processed`}>Uploaded footage becomes a video you can watch once processing finishes, usually within a few minutes. If this stays for more than an hour, the background worker that assembles recordings is not running: ask whoever runs your Boredroom server to start it.</Alert> : null}

      {rows.length ? (
        <div className="@container mb-10">
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
            <StatCard label="Recordings" value={rows.length} icon={<MonitorPlay />} hint={rows.length >= LIMIT ? `The latest ${LIMIT}` : filtered ? "Matching the filters" : "All you can watch"} />
            <StatCard label="Length" value={hours(recordedSeconds)} icon={<Clock />} hint="Footage listed here" />
            <StatCard label="Ready to watch" value={ready} icon={<CirclePlay />} hint={<><span className="tabular-nums">{rows.length - ready - restricted}</span> still processing or incomplete</>} />
            <StatCard label="Restricted" value={restricted} icon={<Lock />} hint="Flagged as sensitive, locked" />
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        filtered
          ? <EmptyState icon3d="screen-record" title="No recordings match" description="Nobody in this team or for this person has recorded yet." action={<Link href={`${base}/recordings`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Clear filters</Link>} />
          : <EmptyState icon3d="screen-record" title="No recordings yet" description={`A recording appears here as soon as someone presses Record screen while their timer runs. ${isOrg ? "Recording must be on under Settings" : "The organisation owner switches recording on"}, and each person agrees to the rules the first time they record.`} action={isOrg ? <Link href={`${base}/settings?section=recording`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Check the recording setting</Link> : undefined} />
      ) : (
        <RecordingsTable orgSlug={ctx.org.slug} rows={rows} timeZone={ctx.org.timezone} />
      )}
      {rows.length >= LIMIT ? <p className="mt-4 text-meta font-normal text-secondary">Showing the latest <span className="tabular-nums">{LIMIT}</span> recordings. Choose a team or a person to see older ones.</p> : null}
      <p className="mt-6 max-w-3xl text-meta font-normal text-secondary">Recordings are video only, started by the person, and kept for the retention period in the monitoring notice. Footage a person flags as sensitive is locked until a privacy administrator reviews it.</p>
    </AppShell>
  );
}
