import Link from "next/link";
import { redirect } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { myDay, teamStatus } from "@/server/services/views";
import { currentSession } from "@/server/services/sessions";
import { briefing } from "@/server/services/brenda";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { withUser } from "@/server/db";
import { MyDayBoard } from "@/components/app/my-day";
import { YourDaySection } from "@/components/app/your-day";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { formatDuration, formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Day" };

/**
 * My Day (owner decision, 5 October 2026): your day at a glance and, while a to-do is on the clock, its timer. Clocking
 * in has its own page (Clock in), so My Day carries no clock-in card and no idle clock. No daily report either (owner
 * decision, 6 October 2026): Brenda's end-of-day report to supervisors replaced it.
 * v4: the display title, then the day and how long you have worked in the secondary grey.
 * "Your day" (owner request, 7 October 2026, moved here from under Brenda's home panel): the day's figures, your clock
 * and what is due, overdue or waiting, from Brenda's briefing; team leads also get a Team tab with who in their team is
 * working. It sits under the timer.
 * The to-do list moved to its own page, To-dos (owner request, 7 October 2026); the header links to it. The page still
 * reads the open to-dos, since the timer's Switch task offers them.
 */
export default async function MyDayPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/my-day`);
  const role = ctx.membership.role;
  if (role === "owner" || role === "hr") redirect(`/app/${ctx.org.slug}/dashboard`);
  const lead = role === "manager";
  const [data, session, timings, brief, team, { personal }] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ recording_mode: string }>(`SELECT recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
    briefing(ctx),
    // Team leads: the people in their team (themselves aside) and the timer each has open.
    lead ? teamStatus(ctx).then((s) => s.rows) : Promise.resolve(null),
    // The header names the person's own assistant (owner decision, 7 October 2026: personal assistants).
    assistantProfiles(ctx),
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
          : `Write your to-dos on the To-dos page, or say them to ${personal.name}, and press Start when you begin.`}</>}
        actions={<Link href={`/app/${ctx.org.slug}/todos`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open your to-dos</Link>} />
      <MyDayBoard
        orgSlug={ctx.org.slug}
        initialSession={session}
        planned={data.planned}
        ownTodos={data.ownTodos}
        fromLeads={data.fromLeads}
        recordingMode={timings?.recording_mode ?? "disabled"}
        lead={lead}
        yourDay={<YourDaySection className="pb-4" orgSlug={ctx.org.slug} role={role} brief={brief} timeZone={ctx.org.timezone} team={yourTeam} />}
      />
      {/* Page notes (owner request, 7 October 2026): explanations at the bottom of the screen, small and grey. No daily
          report any more (owner decision, 6 October 2026); said once, since people were used to one. */}
      <PageNotes>
        <PageNote>There is no daily report to write: your to-dos and timer are the record your team lead sees.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
