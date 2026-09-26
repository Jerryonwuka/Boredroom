import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { NewAssignedTask, TaskTable } from "@/components/app/tasks-page";
import { tasksView, listProjects, type TaskListFilter } from "@/server/services/views";
import { AutoSubmitSelect } from "@/components/ui/auto-submit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

/**
 * Tasks: staff see everything assigned to them; team leads create, assign and follow their teams' tasks; organisation
 * accounts see all. The list (owner decision, 26 September 2026) shows face, task, person, date, status and one action;
 * everything else lives in the pop-up a task opens.
 */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ status?: string; who?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/tasks`);
  const status = (["all", "assigned", "open", "check", "done"].includes(sp.status ?? "") ? sp.status : "all") as NonNullable<TaskListFilter["status"]>;
  const [data, projects] = await Promise.all([tasksView(ctx, { status, who: sp.who ?? null }), listProjects(ctx)]);
  const base = `/app/${ctx.org.slug}`;
  const mine = data.scope === "mine";
  const lead = data.scope === "lead";
  const href = (s: string, who = data.who) => `${base}/tasks?status=${s}${who ? `&who=${who}` : ""}`;
  const tabs = [
    { value: "all", label: "All", count: data.counts.open + data.counts.check + data.counts.done, href: href("all") },
    ...(!mine ? [{ value: "assigned", label: "Assigned", count: data.counts.assigned, href: href("assigned") }] : []),
    { value: "open", label: "To do", count: data.counts.open, href: href("open") },
    { value: "check", label: "Sent for check", count: data.counts.check, href: href("check") },
    { value: "done", label: "Done", count: data.counts.done, href: href("done") },
  ];
  const empty = { all: mine ? "Nothing assigned to you right now" : "No tasks yet", assigned: "You have not handed out a task yet", open: mine ? "Nothing to do right now" : "No open tasks", check: "Nothing waiting for a check", done: "Nothing finished yet" }[status];
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="card-check" title={mine ? "Your tasks" : "Tasks"}
        description={mine ? "Everything assigned to you, by your team lead or by yourself. Press Start to pick one up; the clock opens on My Day." : lead ? "Create a task and hand it to someone on your team, to another team lead, or up to the owner or HR. Open a task to see the details; tick several to act on them together." : "Every task in the organisation and who holds it. Open a task to see the details; tick several to act on them together."}
        actions={!mine ? <NewAssignedTask orgSlug={ctx.org.slug} people={data.people.filter((p) => p.id !== ctx.membership.id)} self={ctx.membership.id} selfName={ctx.user.displayName} canKeep={ctx.membership.role !== "employee"} projects={projects.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))} /> : undefined} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Task status" param="status" value={status} tabs={tabs} />
        {!mine && data.people.length > 1 ? (
          <form className="flex items-center gap-2 text-sm" action={`${base}/tasks`}>
            <input type="hidden" name="status" value={status} />
            <label htmlFor="who" className="text-fg-muted">Person</label>
            <AutoSubmitSelect id="who" name="who" defaultValue={data.who ?? ""}>
              <option value="">Everyone{lead ? " on my teams, and anyone I handed a task to" : ""}</option>
              {data.people.some((p) => p.group === "team") ? <optgroup label={lead ? "Your team" : "Staff and team leads"}>{data.people.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
              {data.people.some((p) => p.group === "organisation") ? <optgroup label={lead ? "Others in the organisation" : "Organisation accounts"}>{data.people.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
            </AutoSubmitSelect>
          </form>
        ) : null}
      </div>

      {data.tasks.length === 0 ? (
        <EmptyState icon3d="card-check" title={empty}
          description={mine ? "When your team lead assigns you something it appears here, and on My Day. You can also add your own to-dos on My Day." : "Press Add new task to create one and hand it to someone."}
          action={mine ? <Link href={`${base}/my-day`}><Button size="sm" variant="outline">Open My Day</Button></Link> : undefined} />
      ) : (
        <TaskTable orgSlug={ctx.org.slug} rows={data.tasks} mine={mine} runningTaskId={data.runningTaskId} canBulk={!mine}
          viewer={{ membershipId: ctx.membership.id, displayName: ctx.user.displayName, role: ctx.membership.role, timezone: ctx.org.timezone }}
          people={data.people.filter((p) => p.group === "team").map((p) => ({ id: p.id, display_name: p.display_name }))} />
      )}
    </AppShell>
  );
}
