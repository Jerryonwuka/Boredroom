import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListTodo } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { Badge, CountPill } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { FilterBar, FilterSelect } from "@/components/ui/filter-control";
import { TaskBoard } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";
import { projectDetail } from "@/server/services/views";
import { NewTaskForm, ProjectMembers, ArchiveProjectButton } from "@/components/app/project-forms";

export const dynamic = "force-dynamic";

/** The server's clock, read once per request: "overdue" on the board is judged by it, so the page and the browser agree. */
const serverNow = () => Date.now();

/** A malformed id in the address is a missing page, not a database error. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** One read per request for the tab's title and the page (React's cache; orgContext is cached the same way). */
const loadProject = cache(async (slug: string, id: string) => (isId(id) ? projectDetail(await orgContext(slug), id) : null));

export async function generateMetadata({ params }: { params: Promise<{ workspace: string; id: string }> }): Promise<Metadata> {
  const { workspace, id } = await params;
  try {
    return { title: (await loadProject(workspace, id))?.project.name ?? "Project" };
  } catch {
    return { title: "Project" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

/**
 * A project, v4: its tasks as a board (one calm column per status, cards that open the task's sheet), an Assignee
 * filter in the toolbar (?assignee=), and the project's members under it. `?status=` still narrows the board to one
 * status, for links written before the board.
 */
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ status?: string; assignee?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/projects/${id}`);
  const data = await loadProject(workspace, id);
  if (!data) notFound();
  const { project, tasks, members, allMembers, isLead } = data;
  const canManage = isLead || ["owner", "hr"].includes(ctx.membership.role);
  const canCreate = canManage || ctx.membership.role === "manager" || members.some((m) => m.membership_id === ctx.membership.id);
  const now = serverNow();
  const visible = tasks
    .filter((t) => (!sp.status || t.status === sp.status) && (!sp.assignee || t.assignee_membership_id === sp.assignee))
    .map((t) => ({ ...t, overdue: !!t.due_at && new Date(t.due_at).getTime() < now && t.status !== "completed" }));
  const assignees = [...new Map(tasks.map((t) => [t.assignee_membership_id, t.assignee_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const viewer = taskViewer(ctx);
  const archived = project.status === "archived";
  const base = `/app/${ctx.org.slug}`;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/projects`, label: "All projects" }} title={project.name}
        description={project.description || archived ? <>{archived ? <Badge tone="info" className="mr-2 align-middle">Archived</Badge> : null}{project.description}{archived ? <>{project.description ? " " : ""}No new work sessions can start on its tasks.</> : null}</> : undefined}
        actions={<>{canManage && !archived ? <ArchiveProjectButton orgSlug={ctx.org.slug} projectId={project.id} /> : null}{canCreate && !archived ? <NewTaskForm orgSlug={ctx.org.slug} projectId={project.id} members={allMembers} self={ctx.membership.id} canAssignOthers={canManage || ctx.membership.role === "manager"} requiresDueDate={project.requires_due_date} requiresEstimate={project.requires_estimate} /> : null}</>}
        divider />

      <section aria-labelledby="project-tasks-heading">
        <SectionTitle id="project-tasks-heading" title={<span className="flex items-center gap-2">Tasks <CountPill count={tasks.length} showZero /></span>}
          action={assignees.length > 1 || sp.status ? (
            <FilterBar>
              {assignees.length > 1 ? (
                <form action={`${base}/projects/${project.id}`}>
                  {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
                  <FilterSelect label="Assignee" name="assignee" autoSubmit defaultValue={sp.assignee ?? ""}>
                    <option value="">Everyone</option>
                    {assignees.map(([mid, name]) => <option key={mid} value={mid}>{name}</option>)}
                  </FilterSelect>
                </form>
              ) : null}
              {sp.status || sp.assignee ? <Link href={`${base}/projects/${project.id}`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Clear</Link> : null}
            </FilterBar>
          ) : undefined} />
        {tasks.length === 0
          ? <EmptyState icon={ListTodo} title="No tasks in this project yet" description={canCreate && !archived ? "Press New task and say what a finished result looks like; the reviewer accepts against it." : "Tasks filed in this project appear here."} />
          : visible.length === 0
            ? <EmptyState icon={ListTodo} title="No tasks match" description="Nothing in this project matches that filter right now." action={<Link href={`${base}/projects/${project.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all tasks</Link>} />
            : <TaskBoard orgSlug={ctx.org.slug} viewer={viewer} tasks={visible} label={`Tasks in ${project.name}, by status`} />}
      </section>

      <section className="mt-12" aria-labelledby="project-members-heading">
        <SectionTitle id="project-members-heading" title={<span className="flex items-center gap-2">Members <CountPill count={members.length} showZero /></span>} />
        <ProjectMembers orgSlug={ctx.org.slug} projectId={project.id} members={members} allMembers={allMembers} canManage={canManage} />
      </section>
    </AppShell>
  );
}
