import { redirect } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { myDay } from "@/server/services/views";
import { currentSession } from "@/server/services/sessions";
import { withUser } from "@/server/db";
import { TodosBoard } from "@/components/app/todo-list";
import { formatLongDate } from "@/lib/utils";
import { assignableMembers } from "@/server/services/tasks";
import { assistantConfigured } from "@/server/services/assistant";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const dynamic = "force-dynamic";
export const metadata = { title: "To-dos" };

/** The server's clock, read once per request: "overdue" on the list is judged by it until the browser's clock takes over. */
const serverNow = () => new Date().toISOString();

/**
 * To-dos (owner request, 7 October 2026: "Take the to-do list that's currently in My Day and create a new separate
 * tab/page for To-do"): the list as it was on My Day, with its tabs and counts, the "+" row (type or dictate), Start and
 * Mark done in each to-do's sheet, Past tasks and, for team leads, handing to-dos out. While a to-do is on the clock
 * its timer shows at the top, as on My Day.
 *
 * Staff and team leads only, like My Day. The organisation account holds no to-dos of its own (a quick to-do for
 * oneself is refused for owners and HR); what is handed up to them is on the Tasks page, so they are sent there.
 */
export default async function TodosPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/todos`);
  const role = ctx.membership.role;
  if (role === "owner" || role === "hr") redirect(`/app/${ctx.org.slug}/tasks`);
  const [data, session, assignable, aiConnected, timings, { personal }] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    assignableMembers(ctx),
    assistantConfigured(ctx.org.id),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ recording_mode: string }>(`SELECT recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
    // The header names the person's own assistant (owner decision, 7 October 2026: personal assistants).
    assistantProfiles(ctx),
  ]);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="To-dos"
        description={`${formatLongDate(data.today)}. Write down what you are doing today, or say it and ${personal.name} writes it down, then press Start when you begin.`} />
      <TodosBoard
        orgSlug={ctx.org.slug}
        today={data.today}
        initialSession={session}
        planned={data.planned}
        ownTodos={data.ownTodos}
        fromLeads={data.fromLeads}
        doneToday={data.doneToday}
        pastTasks={data.pastTasks}
        assignable={assignable}
        membershipId={ctx.membership.id}
        recordingMode={timings?.recording_mode ?? "disabled"}
        assistantConfigured={aiConnected}
        timeZone={ctx.org.timezone}
        serverNow={serverNow()}
      />
      {/* Page notes (owner request, 7 October 2026): explanations at the bottom of the screen, small and grey. Past
          tasks' note shows while there are past tasks (the list refreshes after Clear). */}
      <PageNotes>
        {data.pastTasks.length ? <PageNote section="Past tasks">Clearing only tidies your list. Records, reports and your team lead&apos;s views keep everything.</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}
