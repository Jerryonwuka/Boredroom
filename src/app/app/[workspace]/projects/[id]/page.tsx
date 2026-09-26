import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, CardHeader } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { RowList } from "@/components/ui/rows";
import { Person } from "@/components/ui/person";
import { TaskRow } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";
import { projectDetail } from "@/server/services/views";
import { formatDateTime, formatDuration, cn } from "@/lib/utils";
import { NewTaskForm, ProjectMembers, ArchiveProjectButton } from "@/components/app/project-forms";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ status?: string; assignee?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/projects/${id}`);
  const data = await projectDetail(ctx, id);
  if (!data) notFound();
  const { project, tasks, members, allMembers, isLead } = data;
  const canManage = isLead || ["owner", "hr"].includes(ctx.membership.role);
  const canCreate = canManage || ctx.membership.role === "manager" || members.some((m) => m.membership_id === ctx.membership.id);
  const visible = tasks.filter((t) => (!sp.status || t.status === sp.status) && (!sp.assignee || t.assignee_membership_id === sp.assignee));
  const statuses = ["todo", "in_progress", "blocked", "in_review", "completed"];
  const viewer = taskViewer(ctx);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="box-doc-check" back={{ href: `/app/${ctx.org.slug}/projects`, label: "All projects" }} title={project.name}
        description={<>{project.description}{project.status === "archived" ? " Archived: no new sessions can start." : ""}</>}
        actions={<>{canCreate && project.status === "active" ? <NewTaskForm orgSlug={ctx.org.slug} projectId={project.id} members={allMembers} self={ctx.membership.id} canAssignOthers={canManage || ctx.membership.role === "manager"} requiresDueDate={project.requires_due_date} requiresEstimate={project.requires_estimate} /> : null}{canManage && project.status === "active" ? <ArchiveProjectButton orgSlug={ctx.org.slug} projectId={project.id} /> : null}</>} />
      <div className="mb-4"><Tabs label="Task status" value={sp.status ?? "all"} tabs={[{ value: "all", label: "All", count: tasks.length, href: `?${sp.assignee ? `assignee=${sp.assignee}` : ""}` }, ...statuses.map((st) => ({ value: st, label: st === "in_review" ? "Sent for check" : label(st), count: tasks.filter((t) => t.status === st).length, href: `?status=${st}${sp.assignee ? `&assignee=${sp.assignee}` : ""}` }))]} /></div>
      {visible.length === 0 ? <EmptyState icon3d="card-check" title="No tasks match" description={tasks.length === 0 ? "Create the first task with a clear expected output." : "Try another filter."} /> : (
        <RowList className="tile px-3 py-1">
          {visible.map((t) => {
            const overdue = !!t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";
            return (
              <TaskRow key={t.id} orgSlug={ctx.org.slug} viewer={viewer} task={{ ...t, overdue }} className={t.archived_at ? "opacity-60" : undefined}
                leading={<Person orgSlug={ctx.org.slug} membershipId={t.assignee_membership_id} name={t.assignee_name} showName={false} size={36} />}
                meta={<>{t.assignee_name}{t.reviewer_name ? ` · checked by ${t.reviewer_name}` : ""}{t.tracked_seconds ? ` · ${formatDuration(t.tracked_seconds)} tracked` : ""}{t.estimate_minutes ? ` of ${formatDuration(t.estimate_minutes * 60)}` : ""}{t.archived_at ? " · archived" : ""}{t.blocked_reason ? <span className="text-danger"> · {t.blocked_reason}</span> : null}</>}
                trailing={<span className="flex items-center gap-3"><Badge tone={TASK_STATUS_TONE[t.status]}>{t.status === "in_review" ? "Sent for check" : label(t.status)}</Badge><span className="hidden w-[150px] md:block">{t.due_at ? <><span className="eyebrow block">{overdue ? "Overdue" : "Due"}</span><span className={cn("text-sm tabular-nums", overdue ? "text-danger" : "text-fg-muted")}>{formatDateTime(t.due_at, ctx.org.timezone)}</span></> : <span className="text-fg-subtle">—</span>}</span></span>} />
            );
          })}
        </RowList>
      )}
      <section className="mt-8">
        <CardHeader title="Project members" className="mb-3" />
        <ProjectMembers orgSlug={ctx.org.slug} projectId={project.id} members={members} allMembers={allMembers} canManage={canManage} />
      </section>
    </AppShell>
  );
}
