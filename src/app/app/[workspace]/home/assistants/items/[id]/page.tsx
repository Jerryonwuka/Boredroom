import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { AssistantItemCard } from "@/components/app/assistant-item-card";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { assistantItemsReady, getAssistantItem, markItemSeen } from "@/server/services/assistant-items";
import { ASSISTANT_ITEM_WORDS, assistantOf, type AssistantItemView } from "@/lib/assistant-items";
import { isId } from "../../inbox";

export const dynamic = "force-dynamic";

const W = ASSISTANT_ITEM_WORDS.page;
/** One read per request (React's cache; orgContext is cached the same way), shared by the title and the page. */
const loadItem = cache(async (slug: string, id: string) => (isId(id) ? getAssistantItem(await orgContext(slug), id) : null));

const TITLES: Record<AssistantItemView["kind"], string> = { message: "Message", request: "Request", reply: "Reply", report_note: "Note for the team report" };

export async function generateMetadata({ params }: { params: Promise<{ workspace: string; id: string }> }): Promise<Metadata> {
  const { workspace, id } = await params;
  try {
    const item = await loadItem(workspace, id);
    return { title: item ? TITLES[item.kind] : W.title };
  } catch {
    return { title: W.title }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

/**
 * One thing that passed between two assistants (owner decision, 8 October 2026: personal assistants, phase 6), for its
 * sender, its recipient, or (a note for the team report) someone who receives the report: the whole card, answered in
 * place (Accept or Decline a request, Reply to a message, Cancel a request, Withdraw a note). Anyone else gets the
 * workspace's not-found page, the same as for an item that does not exist. Every notification about an item links here.
 *
 * The recipient opening it counts as seeing it (contract C.3): it is marked seen here, before the card renders, so the
 * sender's card says "Ben has seen it". Not while someone else is signed in as them (the server refuses that too).
 * Next's link prefetch stops at the workspace's loading boundary, so a link coming into view never marks anything.
 */
export default async function AssistantItemPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/assistants/items/${id}`);
  const base = `/app/${ctx.org.slug}`;
  const [found, assistants] = await Promise.all([loadItem(workspace, id), assistantProfiles(ctx)]);
  const { name } = assistants.personal;
  const now = new Date();
  now.setSeconds(0, 0);

  if (!found) {
    // Before migration 0043 nothing is there to find: the page says why instead of "not found".
    if (await assistantItemsReady(ctx)) notFound();
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <PageHeader back={{ href: `${base}/home/assistants`, label: `Back to ${W.title}` }} title={W.title} />
        <div className="w-full min-w-0 max-w-3xl"><Alert tone="info">{W.notReady}</Alert></div>
      </AppShell>
    );
  }

  let item = found;
  if (item.viewer === "recipient" && item.status === "delivered" && !ctx.user.impersonation) {
    try { item = await markItemSeen(ctx, item.id); } catch { /* shown as it is; the card's own button can try again */ }
  }

  const S = item.sender.firstName;
  const R = item.recipient?.firstName ?? "";
  const received = item.viewer === "recipient";
  const back = received ? { href: `${base}/home/assistants/received`, label: "Back to Received" }
    : item.viewer === "sender" ? { href: `${base}/home/assistants/sent`, label: "Back to Sent" }
    : { href: `${base}/home`, label: `Back to ${name}` };
  const description = item.kind === "report_note"
    ? item.viewer === "sender" ? "Your note for the end-of-day team report." : `${item.sender.name}'s note for the end-of-day team report.`
    : received
      ? item.kind === "reply" ? `${S} replied to your message.` : `From ${assistantOf(S, item.sender.assistant.name)}.`
      : item.kind === "reply" ? `Your reply to ${R}.` : `To ${assistantOf(R, item.recipient?.assistant.name ?? "")}.`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={back} title={TITLES[item.kind]} description={description} />
      <div className="w-full min-w-0 max-w-3xl">
        <AssistantItemCard orgSlug={ctx.org.slug} item={item} timeZone={ctx.org.timezone} now={now.getTime()} />
      </div>
      <PageNotes>
        {item.kind === "report_note" ? <PageNote>{W.notes.reportNotes}</PageNote> : <PageNote>{W.notes.privacy}</PageNote>}
        {item.kind === "request" ? <PageNote>{W.notes.requests}</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}
