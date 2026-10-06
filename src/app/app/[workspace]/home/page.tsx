import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { BrendaHome, type HomeData } from "@/components/app/brenda-home";
import { briefing } from "@/server/services/brenda";
import { teamStatus } from "@/server/services/views";
import { attendanceBoard } from "@/server/services/attendance";
import { getConversation, listConversations } from "@/server/services/brenda-history";
import { localParts } from "@/server/lib/time";
import { formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brenda" };

type Search = { ask?: string | string[]; tab?: string | string[]; chat?: string | string[] };

/**
 * Brenda's page (owner decision, 5 October 2026): the first screen for everyone. Brenda asks what you want to do today,
 * you talk or type, and she does it. v4 (6 October 2026): laid out like the ElevenLabs Home, with your day, your past
 * chats and (for team leads and the organisation) your team under underline tabs beneath her box. Her chat keeps past
 * chats in a column beside it: `?chat=` opens one of them, `?tab=history` opens the chat on the list (links from the
 * drawer and elsewhere).
 */
export default async function HomePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<Search> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => [v].flat()[0]?.trim() || undefined;
  // `?ask=` from a link elsewhere (the Docs empty state) only fills the box; the person still presses Send.
  const ask = first(sp.ask)?.slice(0, 500);
  const chatId = first(sp.chat);
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home`);
  const role = ctx.membership.role;
  const lead = role !== "employee";
  const aiEnabled = ctx.plan.features.AI_ASSISTANT === true;
  const [brief, team, attendance, history, chat] = await Promise.all([
    briefing(ctx),
    lead ? teamStatus(ctx).then((s) => s.rows) : Promise.resolve([]),
    role === "owner" || role === "hr" ? attendanceBoard(ctx).then((a) => a.counts) : Promise.resolve(null),
    // Past chats are only shown while the plan includes Brenda (carrying one on needs her).
    aiEnabled ? listConversations(ctx) : Promise.resolve([]),
    aiEnabled && chatId ? getConversation(ctx, chatId) : Promise.resolve(null),
  ]);
  const now = new Date();
  const hour = localParts(now, ctx.org.timezone).hour;
  const data: HomeData = {
    orgSlug: ctx.org.slug,
    firstName: ctx.user.displayName.split(" ")[0],
    role,
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    dateLabel: formatLongDate(brief.today),
    aiEnabled,
    brief,
    working: team.filter((r) => r.membership_id !== ctx.membership.id).map((r) => ({ id: r.membership_id, name: r.display_name, state: r.session_state ?? null, task: r.task_title ?? null, todaySeconds: r.today_seconds })),
    attendance: attendance ? { in: attendance.in, out: attendance.out, late: attendance.late, notIn: attendance.not_in } : null,
    ask,
    history,
    now: Math.floor(now.getTime() / 60_000) * 60_000,
    pastChats: first(sp.tab) === "history",
    chat,
    // While an administrator is signed in as the person, past chats are closed (not missing).
    chatMissing: aiEnabled && !!chatId && !chat && !ctx.user.impersonation,
  };
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <BrendaHome data={data} />
    </AppShell>
  );
}
