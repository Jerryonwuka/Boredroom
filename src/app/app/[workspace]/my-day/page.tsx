import { redirect } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { myDay, teamStatus } from "@/server/services/views";
import { currentSession } from "@/server/services/sessions";
import { briefing } from "@/server/services/brenda";
import { withUser } from "@/server/db";
import { MyDayBoard } from "@/components/app/my-day";
import { YourDaySection } from "@/components/app/your-day";
import { formatDuration, formatLongDate } from "@/lib/utils";
import { assignableMembers } from "@/server/services/tasks";
import { assistantConfigured } from "@/server/services/assistant";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Day" };

/** The server's clock, read once per request: "overdue" on the list is judged by it until the browser's clock takes over. */
const serverNow = () => new Date().toISOString();

/**
 * My Day (owner decision, 5 October 2026): your to-dos and, while one is on the clock, its timer. Clocking in has its
 * own page (Clock in), so My Day carries no clock-in card and no idle clock. No daily report either (owner decision,
 * 6 October 2026): Brenda's end-of-day report to supervisors replaced it.
 * v4: the display title, then the day and how long you have worked in the secondary grey.
 * "Your day" (owner request, 7 October 2026, moved here from under Brenda's home panel): the day's figures, your clock
 * and what is due, overdue or waiting, from Brenda's briefing; team leads also get a Team tab with who in their team is
 * working. It sits under the timer and above the to-dos.
 */
export default async function MyDayPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/my-day`);
  const role = ctx.membership.role;
  if (role === "owner" || role === "hr") redirect(`/app/${ctx.org.slug}/dashboard`);
  const lead = role === "manager";
  const [data, session, assignable, aiConnected, timings, brief, team] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    assignableMembers(ctx),
    assistantConfigured(ctx.org.id),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ recording_mode: string }>(`SELECT recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
    briefing(ctx),
    // Team leads: the people in their team (themselves aside) and the timer each has open.
    lead ? teamStatus(ctx).then((s) => s.rows) : Promise.resolve(null),
  ]);
  const first = ctx.user.displayName.split(" ")[0];
  const yourTeam = team
    ? { working: team.filter((r) => r.membership_id !== ctx.membership.id).map((r) => ({ id: r.membership_id, name: r.display_name, state: r.session_state ?? null, task: r.task_title ?? null, todaySeconds: r.today_seconds })) }
    : null;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title={`Welcome, ${first}`}
        description={<>{formatLongDate(data.today)}. {data.todaySeconds
          ? <>You&apos;ve worked <span className="font-medium tabular-nums text-foreground">{formatDuration(data.todaySeconds)}</span> today.</>
          : "Add your to-dos, or say them to Brenda, and press Start when you begin."}</>} />
      <MyDayBoard
        orgSlug={ctx.org.slug}
        today={data.today}
        initialSession={session}
        planned={data.planned}
        ownTodos={data.ownTodos}
        fromLeads={data.fromLeads}
        doneToday={data.doneToday}
        pastTasks={data.pastTasks}
        projects={data.projects}
        members={data.members.filter((m) => m.id !== ctx.membership.id)}
        assignable={assignable}
        membershipId={ctx.membership.id}
        recordingMode={timings?.recording_mode ?? "disabled"}
        assistantConfigured={aiConnected}
        timeZone={ctx.org.timezone}
        serverNow={serverNow()}
        yourDay={<YourDaySection className="pb-4" orgSlug={ctx.org.slug} role={role} brief={brief} timeZone={ctx.org.timezone} team={yourTeam} />}
      />
    </AppShell>
  );
}
