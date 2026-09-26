import Link from "next/link";
import { Video } from "lucide-react";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { teamBoard } from "@/server/services/views";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { NewTaskForm } from "@/components/app/project-forms";
import { TeamTaskActions, TeamMemberActions } from "@/components/app/team-forms";
import { RecordingsTable } from "@/components/app/recordings-table";
import { listRecordings, recordingCountsByTask } from "@/server/services/recording";
import { Person } from "@/components/ui/person";

export const dynamic = "force-dynamic";

export default async function TeamBoardPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/teams/${id}`);
  const data = await teamBoard(ctx, id);
  if (!data) notFound();
  const { team, members, tasks, isLead, projects, others } = data;
  const [recordings, recordingCounts] = await Promise.all([listRecordings(ctx, { teamId: team.id, limit: 8 }), recordingCountsByTask(ctx, tasks.map((t) => t.id))]);
  const base = `/app/${ctx.org.slug}`;
  const isOrgAdmin = ["owner", "hr"].includes(ctx.membership.role);
  const memberOptions = members.map((m) => ({ id: m.membership_id, display_name: m.display_name }));
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="people" back={{ href: isOrgAdmin ? `/app/${ctx.org.slug}/people` : `/app/${ctx.org.slug}`, label: isOrgAdmin ? "People and teams" : "Back" }} title={team.name}
        description={isLead ? "Your team's work in one place. Create tasks, assign them to your people, and remove what is no longer needed." : "Tasks assigned to the people in this team."}
        actions={isLead && (team.project_id ?? projects[0]?.id) ? <NewTaskForm orgSlug={ctx.org.slug} projectId={team.project_id ?? projects[0].id} members={memberOptions} self={ctx.membership.id} canAssignOthers requiresDueDate={false} requiresEstimate={false} /> : null} />
      <section className="mb-8">
        <CardHeader title={`Members (${members.length})`} className="mb-3" />
        {members.length === 0 ? <EmptyState icon3d="people" title="No members yet" description={isOrgAdmin ? "Add someone with the form below, or from the People page." : "Your organisation adds people to this team from the People page."} action={isOrgAdmin ? <Link href={`${base}/people?tab=people`}><Button size="sm" variant="outline">Open People</Button></Link> : undefined} /> : (
          <DataTable caption="Team members">
            <thead><tr><th>Person</th><th>Role in team</th><th>Now</th><th>Open</th><th>Blocked</th><th>In review</th>{isOrgAdmin ? <th></th> : null}</tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.membership_id}>
                <td><Person orgSlug={ctx.org.slug} membershipId={m.membership_id} name={m.display_name} href={`${base}/timesheets?member=${m.membership_id}`} meta={m.employee_code} /></td>
                <td>{m.is_manager ? <Badge tone="accent">Team lead</Badge> : <Badge>Staff</Badge>}</td>
                <td>{m.session_state ? <><Badge tone={SESSION_STATE_TONE[m.session_state]} dot>{label(m.session_state)}</Badge> <span className="text-sm">{m.task_title}</span></> : <span className="text-fg-subtle">—</span>}</td>
                <td>{m.open_tasks}</td><td>{m.blocked_tasks ? <span className="text-danger">{m.blocked_tasks}</span> : 0}</td><td>{m.in_review_tasks}</td>
                {isOrgAdmin ? <td><TeamMemberActions orgSlug={ctx.org.slug} teamId={team.id} membershipId={m.membership_id} isManager={m.is_manager} /></td> : null}
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        {isOrgAdmin && others.length ? <div className="mt-3"><TeamMemberActions orgSlug={ctx.org.slug} teamId={team.id} addCandidates={others} /></div> : null}
      </section>
      <section>
        <CardHeader title={`Tasks (${tasks.length})`} className="mb-3" />
        {tasks.length === 0 ? <EmptyState icon3d="card-check" title="No tasks for this team yet" description={isLead ? "Create the first task and assign it to someone on the team." : "Your team lead has not assigned tasks yet."} /> : (
          <DataTable caption="Team tasks">
            <thead><tr><th>Task</th><th>Status</th><th>Worked by</th><th>Project</th><th>Due</th><th>Tracked</th><th>Recordings</th>{isLead ? <th></th> : null}</tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}>
                <td><Link href={`${base}/tasks/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>{t.blocked_reason ? <p className="text-sm text-danger">{t.blocked_reason}</p> : null}</td>
                <td><Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge></td>
                <td>{t.assignee_name}</td>
                <td className="text-sm text-fg-muted">{t.project_name}</td>
                <td className="text-sm">{t.due_at ? formatDateTime(t.due_at, ctx.org.timezone) : "—"}</td>
                <td className="tabular-nums">{formatDuration(t.tracked_seconds)}{t.estimate_minutes ? ` / ${formatDuration(t.estimate_minutes * 60)}` : ""}</td>
                <td>{recordingCounts[t.id] ? <Link href={`${base}/tasks/${t.id}`} className="inline-flex items-center gap-1 text-sm hover:underline"><Video className="size-4 text-accent" aria-hidden />{recordingCounts[t.id]}</Link> : <span className="text-fg-subtle">—</span>}</td>
                {isLead ? <td><TeamTaskActions orgSlug={ctx.org.slug} task={{ id: t.id, version: t.version, status: t.status, assigneeId: t.assignee_membership_id }} members={memberOptions} /></td> : null}
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        {isLead && team.project_name ? <p className="mt-3 text-xs text-fg-subtle">New tasks go into the team&apos;s working project (&ldquo;{team.project_name}&rdquo;). Tasks in other projects still appear here when assigned to a team member.</p> : null}
      </section>
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">Screen recordings</h2>
          <Link href={`${base}/recordings?team=${team.id}`} className="link-action">All recordings for this team</Link>
        </div>
        {recordings.length === 0 ? <EmptyState icon3d="screen-record" title="No recordings from this team yet" description="When someone on the team presses Record screen while their timer runs, the footage appears here against their task." /> : (
          <RecordingsTable orgSlug={ctx.org.slug} rows={recordings} timeZone={ctx.org.timezone} compact />
        )}
      </section>
    </AppShell>
  );
}
