import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { projectDetail } from "@/server/services/views";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { NewTaskForm, ProjectMembers, ArchiveProjectButton } from "@/components/app/project-forms";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ status?: string; assignee?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/projects/${id}`);
  const data = await projectDetail(ctx, id);
  if (!data) notFound();
  const { project, tasks, members, allMembers, isLead } = data;
  const canManage = isLead || ["owner", "hr"].includes(ctx.membership.role);
  const canCreate = canManage || ctx.membership.role === "manager" || members.some((m) => m.membership_id === ctx.membership.id);
  const visible = tasks.filter((t) => (!sp.status || t.status === sp.status) && (!sp.assignee || t.assignee_membership_id === sp.assignee));
  const statuses = ["todo", "in_progress", "blocked", "in_review", "completed"];
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline={<Link href={`/app/${ctx.org.slug}/projects`} className="hover:underline">Projects</Link>} title={project.name}
        description={<>{project.description}{project.status === "archived" ? " · Archived: no new sessions can start." : ""}</>}
        actions={<>{canCreate && project.status === "active" ? <NewTaskForm orgSlug={ctx.org.slug} projectId={project.id} members={allMembers} self={ctx.membership.id} canAssignOthers={canManage || ctx.membership.role === "manager"} requiresDueDate={project.requires_due_date} requiresEstimate={project.requires_estimate} /> : null}{canManage && project.status === "active" ? <ArchiveProjectButton orgSlug={ctx.org.slug} projectId={project.id} /> : null}</>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">Filter:</span>
        <Link href={`?`} className={`rounded-full border px-3 py-1 ${!sp.status ? "border-accent text-fg" : "border-border text-fg-muted"}`}>All</Link>
        {statuses.map((s) => <Link key={s} href={`?status=${s}${sp.assignee ? `&assignee=${sp.assignee}` : ""}`} className={`rounded-full border px-3 py-1 ${sp.status === s ? "border-accent text-fg" : "border-border text-fg-muted"}`}>{label(s)}</Link>)}
      </div>
      {visible.length === 0 ? <EmptyState title="No tasks match" description={tasks.length === 0 ? "Create the first task with a clear expected output." : "Try another filter."} /> : (
        <DataTable caption={`Tasks in ${project.name}`}>
          <thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>Reviewer</th><th>Due</th><th>Tracked / est.</th></tr></thead>
          <tbody>
            {visible.map((t) => {
              const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
              return (
                <tr key={t.id} className={t.archived_at ? "opacity-60" : ""}>
                  <td><Link href={`/app/${ctx.org.slug}/tasks/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>{t.archived_at ? <Badge className="ml-2">archived</Badge> : null}{t.capture_requirement === "required" ? <Badge tone="warning" className="ml-2">capture</Badge> : null}{t.blocked_reason ? <p className="text-sm text-danger">{t.blocked_reason}</p> : null}</td>
                  <td><Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge></td>
                  <td><Link href={`?assignee=${t.assignee_membership_id}`} className="hover:underline">{t.assignee_name}</Link></td>
                  <td>{t.reviewer_name ?? <span className="text-fg-subtle">—</span>}</td>
                  <td className={overdue ? "text-danger" : ""}>{t.due_at ? formatDateTime(t.due_at, ctx.org.timezone) : "—"}</td>
                  <td>{formatDuration(t.tracked_seconds)}{t.estimate_minutes ? ` / ${formatDuration(t.estimate_minutes * 60)}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-display">Project members</h2>
        <ProjectMembers orgSlug={ctx.org.slug} projectId={project.id} members={members} allMembers={allMembers} canManage={canManage} />
      </section>
    </AppShell>
  );
}
