import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { teamBoard } from "@/server/services/views";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { NewTaskForm } from "@/components/app/project-forms";
import { TeamTaskActions, TeamMemberActions } from "@/components/app/team-forms";

export const dynamic = "force-dynamic";

export default async function TeamBoardPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/teams/${id}`);
  const data = await teamBoard(ctx, id);
  if (!data) notFound();
  const { team, members, tasks, isLead, projects, others } = data;
  const base = `/app/${ctx.org.slug}`;
  const isOrgAdmin = ["owner", "hr"].includes(ctx.membership.role);
  const memberOptions = members.map((m) => ({ id: m.membership_id, display_name: m.display_name }));
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline="Team board" title={team.name}
        description={isLead ? "Your team's work in one place. Create tasks, assign them to your people, and remove what is no longer needed." : "Tasks assigned to the people in this team."}
        actions={isLead && (team.project_id ?? projects[0]?.id) ? <NewTaskForm orgSlug={ctx.org.slug} projectId={team.project_id ?? projects[0].id} members={memberOptions} self={ctx.membership.id} canAssignOthers requiresDueDate={false} requiresEstimate={false} /> : null} />
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg">Members ({members.length})</h2>
        {members.length === 0 ? <EmptyState title="No members yet" description="Add staff to this team from the People page." /> : (
          <DataTable caption="Team members">
            <thead><tr><th>Person</th><th>Role in team</th><th>Now</th><th>Open</th><th>Blocked</th><th>In review</th>{isOrgAdmin ? <th></th> : null}</tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.membership_id}>
                <td><Link href={`${base}/timesheets?member=${m.membership_id}`} className="font-semibold hover:underline">{m.display_name}</Link><p className="text-xs text-fg-subtle">{m.employee_code}</p></td>
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
        <h2 className="mb-3 font-display text-lg">Tasks ({tasks.length})</h2>
        {tasks.length === 0 ? <EmptyState title="No tasks for this team yet" description={isLead ? "Create the first task and assign it to someone on the team." : "Your team lead has not assigned tasks yet."} /> : (
          <DataTable caption="Team tasks">
            <thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>Project</th><th>Due</th><th>Tracked</th>{isLead ? <th></th> : null}</tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}>
                <td><Link href={`${base}/tasks/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>{t.blocked_reason ? <p className="text-sm text-danger">{t.blocked_reason}</p> : null}</td>
                <td><Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge></td>
                <td>{t.assignee_name}</td>
                <td className="text-sm text-fg-muted">{t.project_name}</td>
                <td className="text-sm">{t.due_at ? formatDateTime(t.due_at, ctx.org.timezone) : "—"}</td>
                <td>{formatDuration(t.tracked_seconds)}{t.estimate_minutes ? ` / ${formatDuration(t.estimate_minutes * 60)}` : ""}</td>
                {isLead ? <td><TeamTaskActions orgSlug={ctx.org.slug} task={{ id: t.id, version: t.version, status: t.status, assigneeId: t.assignee_membership_id }} members={memberOptions} /></td> : null}
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        {isLead && team.project_name ? <p className="mt-3 text-xs text-fg-subtle">New tasks go into the team&apos;s working project (&ldquo;{team.project_name}&rdquo;). Tasks in other projects still appear here when assigned to a team member.</p> : null}
      </section>
    </AppShell>
  );
}
