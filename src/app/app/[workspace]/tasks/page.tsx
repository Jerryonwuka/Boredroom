import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { NewAssignedTask, PickUpTask, MarkDone } from "@/components/app/tasks-page";
import { tasksView, type TaskListFilter } from "@/server/services/views";
import { formatDateTime, formatDuration, cn } from "@/lib/utils";
import { Person } from "@/components/ui/person";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

const PRIORITY_TONE = { urgent: "danger", high: "warning", normal: "neutral", low: "neutral" } as const;

/** Tasks: staff see everything assigned to them; team leads create, assign and follow their teams' tasks; organisation accounts see all. */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ status?: string; who?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/tasks`);
  const status = (["open", "check", "done", "all"].includes(sp.status ?? "") ? sp.status : "open") as NonNullable<TaskListFilter["status"]>;
  const data = await tasksView(ctx, { status, who: sp.who ?? null });
  const base = `/app/${ctx.org.slug}`;
  const mine = data.scope === "mine";
  const lead = data.scope === "lead";
  const href = (s: string, who = data.who) => `${base}/tasks?status=${s}${who ? `&who=${who}` : ""}`;
  const tabs = [
    { value: "open", label: "To do", count: data.counts.open, href: href("open") },
    { value: "check", label: "Sent for check", count: data.counts.check, href: href("check") },
    { value: "done", label: "Done", count: data.counts.done, href: href("done") },
    { value: "all", label: "All", count: data.counts.open + data.counts.check + data.counts.done, href: href("all") },
  ];
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="card-check" title={mine ? "Your tasks" : "Tasks"}
        description={mine ? "Everything assigned to you, by your team lead or by yourself. Press Start to pick one up; the clock opens on My Day." : lead ? "Create a task and hand it to someone on your team, to another team lead, or up to the owner or HR. They are notified and see it under their tasks; follow it here until it is done." : "Every task in the organisation and who holds it. Add a task and assign it to anyone; anything handed to you appears here with a Mark done button."} />
      {!mine ? <NewAssignedTask orgSlug={ctx.org.slug} people={data.people.filter((p) => p.id !== ctx.membership.id)} self={ctx.membership.id} selfName={ctx.user.displayName} canKeep={ctx.membership.role !== "employee"} /> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Task status" param="status" value={status} tabs={tabs} />
        {!mine && data.people.length > 1 ? (
          <form className="flex items-center gap-2 text-sm" action={`${base}/tasks`}>
            <input type="hidden" name="status" value={status} />
            <label htmlFor="who" className="text-fg-muted">Person</label>
            <select id="who" name="who" defaultValue={data.who ?? ""} className="field field-sm">
              <option value="">Everyone{lead ? " on my teams, and anyone I handed a task to" : ""}</option>
              {data.people.some((p) => p.group === "team") ? <optgroup label={lead ? "Your team" : "Staff and team leads"}>{data.people.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
              {data.people.some((p) => p.group === "organisation") ? <optgroup label={lead ? "Others in the organisation" : "Organisation accounts"}>{data.people.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</optgroup> : null}
            </select>
            <Button type="submit" size="sm" variant="subtle">Show</Button>
          </form>
        ) : null}
      </div>

      {data.tasks.length === 0 ? (
        <EmptyState icon3d="card-check" title={status === "open" ? (mine ? "Nothing assigned to you right now" : "No open tasks") : status === "check" ? "Nothing waiting for a check" : status === "done" ? "Nothing finished yet" : "No tasks yet"}
          description={mine ? "When your team lead assigns you something it appears here, and on My Day. You can also add your own to-dos on My Day." : lead ? "Press Add new task to create one and hand it to someone on your team." : "Team leads create tasks from their Tasks page."}
          action={mine ? <Link href={`${base}/my-day`}><Button size="sm" variant="outline">Open My Day</Button></Link> : undefined} />
      ) : (
        <DataTable caption="Tasks">
          <thead><tr><th>Task</th>{!mine ? <th className="hidden md:table-cell">Assigned to</th> : null}<th>Status</th><th className="hidden md:table-cell">Priority</th><th className="hidden md:table-cell">Due</th><th className="hidden lg:table-cell">Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.tasks.map((t) => {
            const running = data.runningTaskId === t.id;
            return (
              <tr key={t.id} className={running ? "bg-accent-soft/30" : ""}>
                <td>
                  <Link href={`${base}/tasks/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
                  <p className="text-xs text-fg-subtle">{mine ? (t.created_by === ctx.membership.id ? "your own to-do" : `from ${t.created_by_name}`) : (t.created_by === t.assignee_membership_id ? "their own to-do" : `from ${t.created_by_name}`)}{t.estimate_minutes ? `, est. ${formatDuration(t.estimate_minutes * 60)}` : ""}{!mine ? <span className="md:hidden">, {t.assignee_name}</span> : null}{t.due_at ? <span className={cn("md:hidden", t.overdue ? "text-danger" : "")}>, due {formatDateTime(t.due_at, ctx.org.timezone)}</span> : null}</p>
                </td>
                {!mine ? <td className="hidden md:table-cell"><Person orgSlug={ctx.org.slug} membershipId={t.assignee_membership_id} name={t.assignee_name} you={t.assignee_membership_id === ctx.membership.id} href={t.assignee_membership_id === ctx.membership.id ? undefined : `${base}/workroom/${t.assignee_membership_id}`} />{t.team_name ? <p className="text-xs text-fg-subtle">{t.team_name}</p> : null}</td> : null}
                <td>{running ? <Badge tone="success" dot>Working now</Badge> : <Badge tone={TASK_STATUS_TONE[t.status]}>{t.status === "in_review" ? "Sent for check" : label(t.status)}</Badge>}{t.blocked_reason ? <p className="mt-1 max-w-[16rem] text-xs text-danger">{t.blocked_reason}</p> : null}</td>
                <td className="hidden md:table-cell">{t.priority === "normal" ? <span className="text-sm text-fg-subtle">Normal</span> : <Badge tone={PRIORITY_TONE[t.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{label(t.priority)}</Badge>}</td>
                <td className={cn("hidden text-sm md:table-cell", t.overdue ? "text-danger" : "")}>{t.due_at ? formatDateTime(t.due_at, ctx.org.timezone) : <span className="text-fg-subtle">—</span>}</td>
                <td className="hidden tabular-nums text-sm lg:table-cell">{t.tracked_seconds ? formatDuration(t.tracked_seconds) : <span className="text-fg-subtle">—</span>}</td>
                <td className="text-right">
                  {mine && t.status !== "completed" && t.status !== "in_review" ? <PickUpTask orgSlug={ctx.org.slug} taskId={t.id} running={running} anyRunning={!!data.runningTaskId} /> : null}
                  {!mine && t.assignee_membership_id === ctx.membership.id && ["todo", "in_progress", "blocked"].includes(t.status) ? <MarkDone orgSlug={ctx.org.slug} taskId={t.id} /> : null}
                  {!mine && t.assignee_membership_id !== ctx.membership.id && t.status !== "completed" ? <Link href={`${base}/messages?to=${t.assignee_membership_id}&task=${t.id}`} className="whitespace-nowrap text-sm text-fg-muted hover:text-fg">Ask for an update</Link> : null}
                </td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      )}
    </AppShell>
  );
}
