import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNotes } from "@/components/ui/page-notes";
import { AssistantWaiting } from "@/components/app/assistant-waiting";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";
import { InboxHeader, InboxNotes, isId, loadInbox, param } from "./inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Between assistants" };

const W = ASSISTANT_ITEM_WORDS.page;

/**
 * Between assistants, "Waiting for you" (owner decision, 8 October 2026: personal assistants, phase 6; it grew out of
 * phase 4's Follow-ups page): everything other people's assistants are waiting on the person for. First the follow-up
 * asks (someone's assistant wants an update on their work, the nearest deadline first), then the requests to accept
 * (oldest first: nothing changes on their account until they accept), then the messages and replies not yet seen. Each
 * is a whole card answered in place; an answered card stays, showing what it became, until the person leaves.
 *
 * The other tabs are "Sent" (what the person's assistant sent for them: messages, requests, notes for the team report
 * and follow-ups) and "Received" (everything other people's assistants brought them or asked about them). `?f=` marks
 * one card and scrolls to it (a follow-up's id or an item's).
 *
 * Not gated by the plan: answering never needs the AI, and a record stays readable. The page refreshes as items and
 * follow-ups change (the workspace's change stream). Before migration 0043 it says the inbox needs a database update
 * and still shows the follow-up asks (0039).
 *
 * Phase 7b (owner decision, 8 October 2026: "Brenda keeps the loops closed"; contract H.3): the page also lists what is
 * waiting on the person that is not an assistant item, in this order: follow-up asks, "Ben is blocked on you" (Answer
 * or Not me), requests to accept, commitments the workspace's assistant noted for them and open asks (Add to my to-dos,
 * Take it on, Decline, Not a commitment), then messages and replies. `?f=` also marks a commitment or a block (their
 * notifications link here). Before migration 0048 none of them shows and nothing else changes.
 */
export default async function WaitingForYouPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ f?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const f = param(sp.f);
  const highlight = f && isId(f) ? f : null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/assistants`);
  const base = `/app/${ctx.org.slug}`;
  const inbox = await loadInbox(ctx);
  const now = new Date();
  now.setSeconds(0, 0);

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <InboxHeader base={base} name={inbox.name} tab="waiting" count={inbox.count} />
      <div className="w-full min-w-0 max-w-3xl space-y-6">
        {!inbox.ready ? <Alert tone="info">{W.notReady}</Alert> : null}
        {/* Always mounted, so a card just answered stays after the refresh drops it; the empty state shows once nothing does. */}
        <AssistantWaiting orgSlug={ctx.org.slug} asks={inbox.asks} items={inbox.items} loops={inbox.loops} timeZone={ctx.org.timezone} now={now.getTime()} title={null} highlight={highlight}
          empty={inbox.ready ? <EmptyState icon={Inbox} title={W.emptyWaiting.title} description={W.emptyWaiting.body} /> : null} />
      </div>
      <PageNotes>
        <InboxNotes />
      </PageNotes>
    </AppShell>
  );
}
