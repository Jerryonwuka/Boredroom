import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { myDay } from "@/server/services/views";
import { currentSession } from "@/server/services/sessions";
import { withUser } from "@/server/db";
import { MyDayBoard } from "@/components/app/my-day";
import { formatDuration } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Day" };

export default async function MyDayPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/my-day`);
  const [data, session, timings] = await Promise.all([
    myDay(ctx),
    currentSession(ctx),
    withUser(ctx.user.profileId, (db) => db.maybeOne<{ heartbeat_seconds: number; stale_after_seconds: number; recording_mode: string }>(`SELECT heartbeat_seconds, stale_after_seconds, recording_mode FROM policies WHERE id = $1`, [ctx.org.current_policy_id])),
  ]);
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline={data.today} title={<>Good day, <span className="gradient-text">{ctx.user.displayName.split(" ")[0]}</span>.</>}
        description={<>Confirmed time today: <strong className="text-fg">{formatDuration(data.todaySeconds)}</strong>. Timers only count while you run them. {data.report ? <Link className="underline" href={`/app/${ctx.org.slug}/timesheets?date=${data.today}`}>Today&apos;s report is {data.report.status.replace("_", " ")}.</Link> : null}</>} />
      <MyDayBoard
        orgSlug={ctx.org.slug}
        today={data.today}
        initialSession={session}
        planned={data.planned}
        assigned={data.assigned}
        projects={data.projects}
        members={data.members.filter((m) => m.id !== ctx.membership.id)}
        membershipId={ctx.membership.id}
        recordingMode={timings?.recording_mode ?? "disabled"}
        reportStatus={data.report?.status ?? null}
      />
    </AppShell>
  );
}
