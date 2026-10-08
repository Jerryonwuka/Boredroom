import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareQuote, MessageSquareReply } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { AssistantItemsList } from "@/components/app/assistant-items-list";
import { MyFollowUpsList } from "@/components/app/follow-ups-list";
import { getFollowUpBatch, listMyFollowUps } from "@/server/services/follow-ups";
import { listAssistantItems } from "@/server/services/assistant-items";
import { schema0039Ready } from "@/server/lib/schema-0039";
import { withUser } from "@/server/db";
import { ASSISTANT_ITEM_WORDS, type AssistantItemKind } from "@/lib/assistant-items";
import { FilterPills, InboxHeader, InboxNotes, TypePills, isId, loadInbox, param } from "../inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sent" };

const W = ASSISTANT_ITEM_WORDS.page;
type Status = "open" | "done" | "all";
type Kind = "all" | "message" | "request" | "report_note";
const KINDS: Kind[] = ["all", "message", "request", "report_note"];
const STATUSES: Status[] = ["open", "done", "all"];
const FOLLOW_UP_STATUS: Record<Status, string> = { open: "Open", done: "Answered", all: "All" };

/**
 * Between assistants, "Sent" (owner decision, 8 October 2026: personal assistants, phase 6): what the person's own
 * assistant sent for them, newest first, each with where it stands now. Two lists, picked by the pills under the header
 * (`?type=`):
 * - "Messages and requests" (the default): the messages it passed on ("Ben has seen it, 14:02", "Ben replied: “…”"),
 *   the requests it handed over ("Waiting for Ada", "Ada accepted: to-do added", "Ada declined: “…”", with "Cancel
 *   request" while open) and the notes it put in today's team report ("Withdraw note" until the report is written).
 *   Filters: `?kind=` (All, Messages, Requests, Report notes) and `?status=` (Open, Done, All).
 * - "Follow-ups" (`?type=followups`): phase 4's "You asked", unchanged: `?status=` (Open, Answered, All) and `?batch=`
 *   for one ask alone. The old /home/follow-ups address comes here.
 *
 * Not gated by the plan: a record of what was sent stays readable, as past chats are. The first page renders here and
 * refreshes with the workspace's change stream; "Show more" fetches older pages. Before migration 0043 the messages
 * list says it needs a database update; the follow-ups list works on its own (0039).
 */
export default async function SentPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ type?: string | string[]; kind?: string | string[]; status?: string | string[]; batch?: string | string[] }>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  const followUps = param(sp.type) === "followups";
  const askedStatus = param(sp.status);
  const askedKind = param(sp.kind);
  const kind: Kind = KINDS.includes(askedKind as Kind) ? (askedKind as Kind) : "all";
  const status: Status = STATUSES.includes(askedStatus as Status) ? (askedStatus as Status) : "all";
  const batchId = followUps ? param(sp.batch) ?? null : null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/assistants/sent`);
  const base = `/app/${ctx.org.slug}`;
  const here = `${base}/home/assistants/sent`;
  const inbox = await loadInbox(ctx);
  const { name } = inbox;
  const now = new Date();
  now.setSeconds(0, 0);

  const pills = (
    <TypePills label="Show" value={followUps ? "followups" : "items"} options={[
      { label: W.sentTypes.items, value: "items", href: here },
      { label: W.sentTypes.followUps, value: "followups", href: `${here}?type=followups` },
    ]} />
  );

  let body: React.ReactNode;
  let notes: React.ReactNode;
  if (followUps) {
    // Phase 4's "You asked", as it was on /home/follow-ups.
    const [list, one] = await Promise.all([
      batchId ? Promise.resolve(null) : listMyFollowUps(ctx, { status, limit: 20 }),
      batchId && isId(batchId) ? getFollowUpBatch(ctx, batchId) : Promise.resolve(null),
    ]);
    // The list says whether 0039 is applied; `?batch=` alone asks only when the batch is not there.
    const ready = list ? list.ready : one ? true : await withUser(ctx.user.profileId, (db) => schema0039Ready(db));
    const askHref = `${base}/home?ask=${encodeURIComponent("Follow up with ")}`;
    const href = (s: Status) => (s === "all" ? `${here}?type=followups` : `${here}?type=followups&status=${s}`);
    body = !ready ? (
      <Alert tone="info">Follow-ups need a database update first.</Alert>
    ) : batchId ? (
      <>
        <Link href={`${here}?type=followups`} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mb-4`}>Show all follow-ups</Link>
        {one ? <MyFollowUpsList key={one.id} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} now={now.getTime()} status="all" initial={{ batches: [one], nextBefore: null }} />
          : <EmptyState tone="neutral" icon={MessageSquareReply} title="That follow-up isn't here" description="It may be one you can't see, or the link is incomplete." />}
      </>
    ) : (
      <>
        <FilterPills groups={[{ label: "Status", value: status, options: STATUSES.map((s) => ({ label: FOLLOW_UP_STATUS[s], value: s, href: href(s) })) }]} />
        {list && list.batches.length ? (
          <MyFollowUpsList key={status} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} now={now.getTime()} status={status} initial={{ batches: list.batches, nextBefore: list.nextBefore }} />
        ) : status === "all" ? (
          <EmptyState icon={MessageSquareReply} title="No follow-ups yet"
            description={`Ask ${name} “Where is Ben on the landing page?” and their assistant answers from their work.`}
            action={<Link href={askHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>Ask {name}</Link>} />
        ) : (
          <EmptyState tone="neutral" icon={MessageSquareReply} title={status === "open" ? "Nothing waiting for an answer" : "No answers yet"}
            description={status === "open" ? "Everything you asked has been answered." : "Answers show here as other people's assistants send them."}
            action={<Link href={href("all")} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all</Link>} />
        )}
      </>
    );
    notes = (
      <>
        <PageNote>Only you and the person you asked can see a follow-up. The organisation owner and HR see that it happened, not what was said.</PageNote>
        <PageNote>A follow-up never changes anyone&apos;s task.</PageNote>
        {one?.kind === "workspace" ? <PageNote>Updates collected for the team report go to each person&apos;s team lead, the owner and HR.</PageNote> : null}
      </>
    );
  } else {
    const list = await listAssistantItems(ctx, { box: "sent", kind: kind === "all" ? null : (kind as AssistantItemKind), status, limit: 20 });
    const q = (k: Kind, s: Status) => {
      const p = new URLSearchParams();
      if (k !== "all") p.set("kind", k);
      if (s !== "all") p.set("status", s);
      const qs = p.toString();
      return qs ? `${here}?${qs}` : here;
    };
    const filtered = kind !== "all" || status !== "all";
    const askHref = `${base}/home?ask=${encodeURIComponent(W.emptySent.prompt)}`;
    body = !list.ready ? (
      <Alert tone="info">{W.notReady}</Alert>
    ) : (
      <>
        <FilterPills groups={[
          { label: "Show", value: kind, options: KINDS.map((k) => ({ label: W.kindFilters[k], value: k, href: q(k, status) })) },
          { label: "Status", value: status, options: STATUSES.map((s) => ({ label: W.statusFilters[s], value: s, href: q(kind, s) })) },
        ]} />
        {list.items.length ? (
          <AssistantItemsList key={`${kind}-${status}`} orgSlug={ctx.org.slug} box="sent" kind={kind === "all" ? null : (kind as AssistantItemKind)} status={status}
            timeZone={ctx.org.timezone} now={now.getTime()} initial={{ items: list.items, nextBefore: list.nextBefore }} />
        ) : filtered ? (
          <EmptyState tone="neutral" icon={MessageSquareQuote} title="Nothing here" description="Nothing you sent matches these filters."
            action={<Link href={here} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all</Link>} />
        ) : (
          <EmptyState icon={MessageSquareQuote} title={W.emptySent.title} description={W.emptySent.body(name)}
            action={<Link href={askHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>{W.emptySent.action(name)}</Link>} />
        )}
      </>
    );
    notes = <InboxNotes reportNotes />;
  }

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <InboxHeader base={base} name={name} tab="sent" count={inbox.count} />
      <div className="w-full min-w-0 max-w-3xl">
        {pills}
        {body}
      </div>
      <PageNotes>{notes}</PageNotes>
    </AppShell>
  );
}
