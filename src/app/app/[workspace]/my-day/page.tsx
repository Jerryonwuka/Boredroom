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

export const dynamic = "force-dynamic";
export const metadata = { title: "My Day" };

export default async function MyDayPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/my-day`);
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") redirect(`/app/${ctx.org.slug}/dashboard`);
  const [data, session, assignable, aiConnected, timings] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    assignableMembers(ctx),
    assistantConfigured(ctx.org.id),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ heartbeat_seconds: number; stale_after_seconds: number; recording_mode: string }>(`SELECT heartbeat_seconds, stale_after_seconds, recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
  ]);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline={formatLongDate(data.today)} title={<>Good day, {ctx.user.displayName.split(" ")[0]}.</>}
        description={<>Your to-dos for today. {data.todaySeconds ? <>You have worked {formatDuration(data.todaySeconds)} so far.</> : "Press Start on the first one when you begin."} {data.report ? <Link className="underline" href={`/app/${ctx.org.slug}/timesheets?date=${data.today}`}>Today&apos;s report is {data.report.status.replace("_", " ")}.</Link> : null}</>} />
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
