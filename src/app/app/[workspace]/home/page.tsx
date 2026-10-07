import type { Metadata } from "next";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { BrendaHome, type HomeData } from "@/components/app/brenda-home";
import { assistantConfigured } from "@/server/services/assistant";
import { getConversation, listConversations } from "@/server/services/brenda-history";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { localParts, todayLocal } from "@/server/lib/time";
import { formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The tab carries the person's own assistant's name (owner decision, 7 October 2026: personal assistants). orgContext and
 * assistantProfiles are cached per request, so the shell's read is the same one.
 */
export async function generateMetadata({ params }: { params: Promise<{ workspace: string }> }): Promise<Metadata> {
  const { workspace } = await params;
  try {
    return { title: (await assistantProfiles(await orgContext(workspace))).personal.name };
  } catch {
    return { title: "Brenda" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

type Search = { ask?: string | string[]; tab?: string | string[]; chat?: string | string[] };

/**
 * Brenda's page (owner decision, 5 October 2026): the first screen for everyone. Brenda asks what you want to do today,
 * you talk or type, and she does it. Her chat keeps past chats in a column beside it: `?chat=` opens one of them,
 * `?tab=history` opens the chat on the list (links from the drawer and elsewhere). Her home (owner decision, 7 October
 * 2026) is one large panel with an orange glow, her status (which engine answers: Claude when the organisation's
 * assistant is connected, else the built-in helper), her box, quick asks and three action cards, and nothing under it:
 * "Your day" and "Team" moved to My Day, and for owners and HR to the Dashboard (owner request, 7 October 2026), so
 * this page no longer loads the briefing, the team's timers or attendance.
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
  const aiEnabled = ctx.plan.features.AI_ASSISTANT === true;
  const [history, chat, connected] = await Promise.all([
    // Past chats are only shown while the plan includes Brenda (carrying one on needs her).
    aiEnabled ? listConversations(ctx) : Promise.resolve([]),
    aiEnabled && chatId ? getConversation(ctx, chatId) : Promise.resolve(null),
    // Which engine answers her: the organisation's own key or the server's (Claude), else the built-in helper.
    aiEnabled ? assistantConfigured(ctx.org.id) : Promise.resolve(false),
  ]);
  const now = new Date();
  const hour = localParts(now, ctx.org.timezone).hour;
  const data: HomeData = {
    orgSlug: ctx.org.slug,
    firstName: ctx.user.displayName.split(" ")[0],
    role,
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    dateLabel: formatLongDate(todayLocal(ctx.org.timezone, now)),
    aiEnabled,
    assistantConfigured: connected,
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
