import type { OrgContext } from "@/server/lib/api";
import { PageHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { PageNote } from "@/components/ui/page-notes";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { waitingForMe } from "@/server/services/follow-ups";
import { listAssistantItems } from "@/server/services/assistant-items";
import { waitingCommitments } from "@/server/services/commitments";
import { waitingBlocks } from "@/server/services/task-blocks";
import { ASSISTANT_ITEM_LIMITS, ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";
import type { LoopInboxItem } from "@/lib/commitments";

/**
 * What every "Between assistants" page shares (owner decision, 8 October 2026: personal assistants, phase 6): the
 * header with its three tabs and the attention count on "Waiting for you", the pills that pick between messages and
 * requests and the follow-ups of phase 4, and the page notes. Server-only (no hooks).
 */

const W = ASSISTANT_ITEM_WORDS.page;
export type InboxTab = "waiting" | "sent" | "received";

/** A malformed id in the address is a missing page, not a database error. */
export const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The first value of a search parameter, trimmed. */
export const param = (v: string | string[] | undefined) => [v].flat()[0]?.trim() || undefined;

/**
 * What every tab needs: the person's own assistant's name (the back link, the empty states), the follow-up asks and
 * the items waiting for them (the tab's count; the Waiting page lists them). Both settle anything past its time as
 * they read (follow-ups at their deadline, requests at their expiry), so the count is right with an old worker too.
 * `ready` is migration 0043's; follow-ups (0039) answer [] on their own before theirs.
 *
 * Phase 7b (owner decision, 8 October 2026: "Brenda keeps the loops closed"; contract H.3): `loops`, what is waiting on
 * the person that is not an assistant item: commitments the workspace's assistant noted for them and open asks they
 * were told about (`waitingCommitments`, which settles expired ones as it reads) and "blocked on you" questions
 * (`waitingBlocks`). They count in the tab. Both answer [] before migration 0048; a read that fails leaves them out
 * (the inbox still shows everything else) and says so in the server log.
 */
export async function loadInbox(ctx: OrgContext) {
  const [assistants, asks, waiting, loops] = await Promise.all([
    assistantProfiles(ctx),
    waitingForMe(ctx),
    listAssistantItems(ctx, { box: "waiting", status: "open", limit: ASSISTANT_ITEM_LIMITS.listMax }),
    loadLoops(ctx),
  ]);
  return { name: assistants.personal.name, asks, items: waiting.items, loops, ready: waiting.ready, count: asks.length + waiting.items.length + loops.length };
}

/** Blocks on the person, then noted commitments and open asks (phase 7b). Never throws: [] when they cannot be read. */
export async function loadLoops(ctx: OrgContext): Promise<LoopInboxItem[]> {
  const [blocks, commitments] = await Promise.all([
    waitingBlocks(ctx).catch((err: unknown) => { console.warn(`[inbox] blocks waiting on the person could not be read: ${(err as Error)?.message ?? String(err)}`); return [] as LoopInboxItem[]; }),
    waitingCommitments(ctx).catch((err: unknown) => { console.warn(`[inbox] commitments waiting on the person could not be read: ${(err as Error)?.message ?? String(err)}`); return [] as LoopInboxItem[]; }),
  ]);
  return [...blocks, ...commitments];
}

export function InboxHeader({ base, name, tab, count }: { base: string; name: string; tab: InboxTab; count: number }) {
  return (
    <PageHeader back={{ href: `${base}/home`, label: W.backTo(name) }} title={W.title} description={W.description}
      tabsLabel={W.title} tabValue={tab}
      tabs={[
        { label: W.tabs.waiting, value: "waiting", href: `${base}/home/assistants`, count, attention: true },
        { label: W.tabs.sent, value: "sent", href: `${base}/home/assistants/sent` },
        { label: W.tabs.received, value: "received", href: `${base}/home/assistants/received` },
      ]} />
  );
}

/** The pills under the header that pick what a tab lists: messages and requests, or follow-ups. */
export function TypePills({ label, value, options }: { label: string; value: string; options: { label: string; value: string; href: string }[] }) {
  // A hairline under them, so the filters below read as part of the list they pick, not as a third row of choices.
  return <div className="mb-4 border-b border-border pb-3"><Tabs variant="pills" bordered={false} label={label} value={value} tabs={options} /></div>;
}

/** A row of filter pills (Show: All, Messages, …; Status: Open, Done, All), wrapping at 400px. */
export function FilterPills({ groups }: { groups: { label: string; value: string; options: { label: string; value: string; href: string }[] }[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {groups.map((g) => (
        <div key={g.label} className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-xs font-medium text-subtle">{g.label}</span>
          <Tabs variant="pills" bordered={false} label={g.label} value={g.value} tabs={g.options} />
        </div>
      ))}
    </div>
  );
}

/** The notes every tab carries at the bottom (H.1). */
export function InboxNotes({ requests = true, reportNotes = false }: { requests?: boolean; reportNotes?: boolean }) {
  return (
    <>
      <PageNote>{W.notes.privacy}</PageNote>
      {requests ? <PageNote>{W.notes.requests}</PageNote> : null}
      {reportNotes ? <PageNote>{W.notes.reportNotes}</PageNote> : null}
    </>
  );
}
