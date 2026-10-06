import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ListTodo, Users, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { TaskBoard } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";
import { Card, PageHeader, SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { teamBoard } from "@/server/services/views";
import { NewTaskForm } from "@/components/app/project-forms";
import { TeamMemberActions } from "@/components/app/team-forms";
import { RecordingsTable } from "@/components/app/recordings-table";
import { listRecordings, recordingCountsByTask } from "@/server/services/recording";
import { Person } from "@/components/ui/person";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The server's clock, read once per request: "overdue" on the board is judged by it, so the page and the browser agree. */
const serverNow = () => Date.now();

/** A malformed id in the address is a missing page, not a database error. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** One read per request for the tab's title and the page (React's cache; orgContext is cached the same way). */
const loadBoard = cache(async (slug: string, id: string) => (isId(id) ? teamBoard(await orgContext(slug), id) : null));

export async function generateMetadata({ params }: { params: Promise<{ workspace: string; id: string }> }): Promise<Metadata> {
  const { workspace, id } = await params;
  try {
    const board = await loadBoard(workspace, id);
    return { title: board ? `${board.team.name} board` : "Team" };
  } catch {
    return { title: "Team" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

type Tab = "tasks" | "members" | "recordings";

/**
 * A team's board, v4: underline tabs for its tasks (a board, one calm column per status), its members (a grid of cards
 * with what each is doing now and their open work) and its screen recordings. `?tab=` picks one; tasks by default.
 */
export default async function TeamBoardPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/teams/${id}`);
  const data = await loadBoard(workspace, id);
  if (!data) notFound();
  const { team, members, tasks, isLead, projects, others } = data;
  const tab: Tab = sp.tab === "members" || sp.tab === "recordings" ? sp.tab : "tasks";
  const [recordings, recordingCounts] = await Promise.all([listRecordings(ctx, { teamId: team.id, limit: 8 }), recordingCountsByTask(ctx, tasks.map((t) => t.id))]);
  const base = `/app/${ctx.org.slug}`;
  const here = `${base}/teams/${team.id}`;
  const isOrgAdmin = ["owner", "hr"].includes(ctx.membership.role);
  const viewer = taskViewer(ctx);
  const now = serverNow();
  const boardTasks = tasks.map((t) => ({ ...t, overdue: !!t.due_at && new Date(t.due_at).getTime() < now && t.status !== "completed" }));
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: isOrgAdmin ? `${base}/people` : base, label: isOrgAdmin ? "People and teams" : "Back" }} title={team.name}
        description={isLead ? "Your team's work in one place. Create tasks, assign them to your people, and remove what is no longer needed." : "Tasks assigned to the people in this team."}
        actions={isLead && (team.project_id ?? projects[0]?.id) ? <NewTaskForm orgSlug={ctx.org.slug} projectId={team.project_id ?? projects[0].id} members={members.map((m) => ({ id: m.membership_id, display_name: m.display_name }))} self={ctx.membership.id} canAssignOthers requiresDueDate={false} requiresEstimate={false} /> : null}
        tabs={[
          { value: "tasks", label: "Tasks", count: tasks.length, href: here },
          { value: "members", label: "Members", count: members.length, href: `${here}?tab=members` },
          { value: "recordings", label: "Screen recordings", href: `${here}?tab=recordings` },
        ]} tabValue={tab} tabParam="tab" tabsLabel="Team sections" />

      {tab === "tasks" ? (
        <section aria-label="Tasks">
          {tasks.length === 0 ? (
            <EmptyState icon={ListTodo} title="No tasks for this team yet"
              description={isLead ? "Press New task to create one and assign it to someone on the team, or tell Brenda what needs doing and she drafts the tasks for you to confirm." : "Your team lead has not assigned tasks yet."}
              // The one hand-off to Brenda on this page: she creates and assigns tasks (create_todos), each waiting for a yes.
              action={isLead && members.length ? <Link href={`${base}/home?ask=${encodeURIComponent(`Help me plan this week's tasks for the ${team.name} team and assign them.`)}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><BrendaGlyph aria-hidden />Ask Brenda to plan tasks</Link> : undefined} />
          ) : <TaskBoard orgSlug={ctx.org.slug} viewer={viewer} tasks={boardTasks} showProject recordings={recordingCounts} label={`${team.name} tasks, by status`} />}
          {isLead && team.project_name ? <p className="mt-4 text-meta font-normal text-secondary">New tasks go into the team&apos;s working project (&ldquo;{team.project_name}&rdquo;). Tasks in other projects still appear here when assigned to a team member.</p> : null}
        </section>
      ) : null}

      {tab === "members" ? (
        <section aria-label="Members" className="space-y-6">
          {members.length === 0 ? <EmptyState icon={Users} title="No members yet" description={isOrgAdmin ? "Add someone with the form below, or from the People page." : "Your organisation adds people to this team from the People page."} action={isOrgAdmin ? <Link href={`${base}/people?tab=people`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open People</Link> : undefined} /> : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {members.map((m) => (
                <li key={m.membership_id} className="card-stat flex min-w-0 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <Person orgSlug={ctx.org.slug} membershipId={m.membership_id} name={m.display_name} size={40} href={`${base}/timesheets?member=${m.membership_id}`} meta={m.employee_code} />
                    {isOrgAdmin ? <TeamMemberActions orgSlug={ctx.org.slug} teamId={team.id} membershipId={m.membership_id} name={m.display_name} isManager={m.is_manager} /> : null}
                  </div>
                  <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
                    {m.is_manager ? <Badge tone="accent">Team lead</Badge> : <Badge>Staff</Badge>}
                    {m.session_state ? <Badge tone={SESSION_STATE_TONE[m.session_state]} dot>{label(m.session_state)}</Badge> : <Badge tone="info">Not on the clock</Badge>}
                  </div>
                  <p className="mt-2 truncate text-meta font-normal text-secondary">{m.session_state && m.task_title ? m.task_title : "No task running"}</p>
                  <dl className="mt-auto grid grid-cols-3 gap-3 pt-5">
                    <div><dt className="text-xs font-medium text-subtle">Open</dt><dd className="text-sm font-medium tabular-nums text-foreground">{m.open_tasks}</dd></div>
                    <div><dt className="text-xs font-medium text-subtle">Blocked</dt><dd className={cn("text-sm font-medium tabular-nums", m.blocked_tasks ? "text-danger" : "text-foreground")}>{m.blocked_tasks}</dd></div>
                    <div><dt className="text-xs font-medium text-subtle">Sent for check</dt><dd className="text-sm font-medium tabular-nums text-foreground">{m.in_review_tasks}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
          {isOrgAdmin && others.length ? <Card><TeamMemberActions orgSlug={ctx.org.slug} teamId={team.id} addCandidates={others} /></Card> : null}
        </section>
      ) : null}

      {tab === "recordings" ? (
        <section aria-labelledby="team-recordings-heading">
          <SectionTitle id="team-recordings-heading" title="Latest recordings" action={<Link href={`${base}/recordings?team=${team.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>All recordings for this team</Link>} />
          {recordings.length === 0 ? <EmptyState icon={Video} title="No recordings from this team yet" description="When someone on the team presses Record screen while their timer runs, the footage appears here against their task." /> : (
            <RecordingsTable orgSlug={ctx.org.slug} rows={recordings} timeZone={ctx.org.timezone} compact />
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
