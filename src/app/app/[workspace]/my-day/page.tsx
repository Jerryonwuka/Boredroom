import Link from "next/link";
import { redirect } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { myDay } from "@/server/services/views";
import { currentSession } from "@/server/services/sessions";
import { withUser } from "@/server/db";
import { MyDayBoard } from "@/components/app/my-day";
import { formatDuration, formatLongDate } from "@/lib/utils";
import { assignableMembers } from "@/server/services/tasks";
import { assistantConfigured } from "@/server/services/assistant";
import { myClock } from "@/server/services/attendance";
import { ClockCard } from "@/components/app/clock";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Day" };

export default async function MyDayPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/my-day`);
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") redirect(`/app/${ctx.org.slug}/dashboard`);
  const [data, session, assignable, aiConnected, timings, clock] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    assignableMembers(ctx),
    assistantConfigured(ctx.org.id),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ heartbeat_seconds: number; stale_after_seconds: number; recording_mode: string }>(`SELECT heartbeat_seconds, stale_after_seconds, recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
    myClock(ctx),
  ]);
  const lateNow = Date.parse(clock.serverNow) > Date.parse(clock.scheduledStartAt) + clock.schedule.clock_grace_minutes * 60_000;
  const tz = clock.schedule.timezone;
  const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const first = ctx.user.displayName.split(" ")[0];
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="day-checklist" overline={formatLongDate(data.today)} title={<>Welcome, {first}.</>}
        description={<>What are you doing today? {data.todaySeconds ? <>You have worked {formatDuration(data.todaySeconds)} so far.</> : "Tell the assistant, or add a to-do and press Start when you begin."} {data.report ? <Link className="underline" href={`/app/${ctx.org.slug}/timesheets?date=${data.today}`}>Today&apos;s report is {data.report.status.replace("_", " ")}.</Link> : null}</>} />
      {clock.workingDay ? <ClockCard orgSlug={ctx.org.slug} status={clock.status} startLabel={clock.schedule.start_local.slice(0, 5)} endLabel={clock.schedule.end_local.slice(0, 5)} late={lateNow} clockedInAt={clock.record ? timeOf(clock.record.clock_in_at) : null} lateBy={clock.record && clock.record.late_seconds > 0 ? formatDuration(clock.record.late_seconds) : null} timerOpen={clock.timerOpen} /> : null}
      <MyDayBoard
        orgSlug={ctx.org.slug}
        today={data.today}
        todaySeconds={data.todaySeconds}
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
        reportStatus={data.report?.status ?? null}
        assistantConfigured={aiConnected}
        policyAcknowledged={data.policyAcknowledged}
      />
    </AppShell>
  );
}
