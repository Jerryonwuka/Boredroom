import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-control";
import { NewAssignedTask, TaskTable } from "@/components/app/tasks-page";
import { tasksView, listProjects, type TaskListFilter } from "@/server/services/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

/**
 * Tasks: staff see everything assigned to them; team leads create, assign and follow their teams' tasks; organisation
 * accounts see all. The list (owner decision, 26 September 2026) shows face, task, person, date, status and one action;
 * everything else lives in the sheet a task opens. v4: the page header with underline tabs (counts as tiny pills), a
 * toolbar row (search, the Person filter), then the table.
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
    // For a team lead these wait on them (orange, accent rules); for staff they wait on someone else (a plain count).
    { value: "check", label: "Sent for check", count: data.counts.check, attention: lead, href: href("check") },
    { value: "done", label: "Done", count: data.counts.done, href: href("done") },
  ];
  const empty = { all: mine ? "Nothing assigned to you right now" : "No tasks yet", assigned: "You have not handed out a task yet", open: mine ? "Nothing to do right now" : "No open tasks", check: "Nothing waiting for a check", done: "Nothing finished yet" }[status];
  // The Person filter: a GET form whose select submits as soon as it changes (no Show button).
  const personFilter = !mine && data.people.length > 1 ? (
    <form action={`${base}/tasks`} className="min-w-0 max-w-full">
      <input type="hidden" name="status" value={status} />
      <FilterSelect label="Person" id="who" name="who" autoSubmit defaultValue={data.who ?? ""} className="max-w-[16rem]">
        <option value="">Everyone{lead ? " on my teams, and anyone I handed a task to" : ""}</option>
        {data.people.some((p) => p.group === "team") ? <optgroup label={lead ? "Your team" : "Staff and team leads"}>{data.people.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
        {data.people.some((p) => p.group === "organisation") ? <optgroup label={lead ? "Others in the organisation" : "Organisation accounts"}>{data.people.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
      </FilterSelect>
    </form>
  ) : null;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title={mine ? "Your tasks" : "Tasks"}
        description={mine ? "Everything assigned to you, by your team lead or by yourself. Press Start to pick one up; the clock opens on My Day." : lead ? "Create a task and hand it to someone on your team, to another team lead, or up to the owner or HR. Open a task to see the details; tick several to act on them together." : "Every task in the organisation and who holds it. Open a task to see the details; tick several to act on them together."}
        actions={!mine ? <NewAssignedTask orgSlug={ctx.org.slug} people={data.people.filter((p) => p.id !== ctx.membership.id)} self={ctx.membership.id} selfName={ctx.user.displayName} canKeep={ctx.membership.role !== "employee"} projects={projects.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))} /> : undefined}
        tabs={tabs} tabValue={status} tabParam="status" tabsLabel="Task status" />

      {data.tasks.length === 0 ? (
        <>
          {personFilter ? <div className="mb-4 flex flex-wrap items-center gap-2">{personFilter}</div> : null}
          <EmptyState icon3d="card-check" title={empty}
            description={mine ? "When your team lead assigns you something it appears here and on To-dos. You can add your own to-dos there too."
              : status === "all" || status === "assigned" ? "Press New task to create one and hand it to someone, or tell Brenda what needs doing and she drafts the tasks for you to confirm."
              : "Nothing in this list right now. The other tabs hold the rest."}
            action={mine ? <Link href={`${base}/todos`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open your to-dos</Link>
              // The one hand-off to Brenda on this page: she creates and assigns tasks (create_todos), each waiting for a yes.
              : status === "all" || status === "assigned" ? <Link href={`${base}/home?ask=${encodeURIComponent(lead ? "Help me plan this week's tasks for my team and assign them." : "Help me plan this week's tasks and assign them to the right people.")}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><BrendaGlyph aria-hidden />Ask Brenda to plan tasks</Link>
              : <Link href={href("all")} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all tasks</Link>} />
        </>
      ) : (
        <TaskTable orgSlug={ctx.org.slug} rows={data.tasks} mine={mine} runningTaskId={data.runningTaskId} canBulk toolbar={personFilter}
          viewer={{ membershipId: ctx.membership.id, displayName: ctx.user.displayName, role: ctx.membership.role, timezone: ctx.org.timezone }}
          people={data.people.filter((p) => p.group === "team").map((p) => ({ id: p.id, display_name: p.display_name }))} />
      )}
    </AppShell>
  );
}
