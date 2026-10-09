import type { Metadata } from "next";
import Link from "next/link";
import { Handshake, MessageSquareReply, Inbox } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { AssistantItemsList } from "@/components/app/assistant-items-list";
import { WaitingForYou } from "@/components/app/follow-up-reply";
import { AboutYouList } from "@/components/app/follow-ups-list";
import { getFollowUp, listFollowUpsAboutMe } from "@/server/services/follow-ups";
import { listAssistantItems } from "@/server/services/assistant-items";
import { listCommitments } from "@/server/services/commitments";
import { CommitmentCard } from "@/components/app/commitment-card";
import { ASSISTANT_ITEM_WORDS, type AssistantItemKind } from "@/lib/assistant-items";
import { LOOP_LIMITS, LOOP_WORDS, type CommitmentList } from "@/lib/commitments";
import { FilterPills, InboxHeader, InboxNotes, TypePills, isId, loadInbox, param } from "../inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Received" };

const W = ASSISTANT_ITEM_WORDS.page;
type Kind = "all" | "message" | "request" | "reply";
const KINDS: Kind[] = ["all", "message", "request", "reply"];
const KIND_LABEL: Record<Kind, string> = { all: "All", message: "Messages", request: "Requests", reply: "Replies" };

/**
 * Between assistants, "Received" (owner decision, 8 October 2026: personal assistants, phase 6): everything other
 * people's assistants brought the person or asked about them, newest first. Two lists, picked by the pills (`?type=`):
 * - "Messages and requests" (the default): the messages passed on to them, the requests they were asked to accept (and
 *   what became of each) and the one-line replies to their own messages; `?kind=` (All, Messages, Requests, Replies).
 *   Each row opens in place; one waiting for them keeps its buttons under the row.
 * - "Follow-ups about you" (`?type=followups`): phase 4's "Asked about you", unchanged: the asks waiting for their
 *   reply, then every follow-up about their work and exactly what their assistant shared; `?f=` marks one and scrolls to
 *   it. The old /home/follow-ups/about-you address (and every ask's notification) comes here.
 *
 * - "Commitments" (`?type=loops`; phase 7b, owner decision, 8 October 2026: "Brenda keeps the loops closed", contract
 *   H.3): the commitments the workspace's assistant noted for the person and the asks they were told about, once
 *   answered (accepted, declined, not a commitment), from the last 7 days, newest first, as compact cards. Before
 *   migration 0048 it says it needs a database update.
 *
 * Always the person's own. Not gated by the plan. Before migration 0043 the messages list says it needs a database
 * update; the follow-ups list works on its own (0039).
 */
export default async function ReceivedPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ type?: string | string[]; kind?: string | string[]; f?: string | string[] }>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  const type = param(sp.type);
  const followUps = type === "followups";
  const loops = type === "loops";
  const askedKind = param(sp.kind);
  const kind: Kind = KINDS.includes(askedKind as Kind) ? (askedKind as Kind) : "all";
  const f = param(sp.f);
  const highlight = f && isId(f) ? f : null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/assistants/received`);
  const base = `/app/${ctx.org.slug}`;
  const here = `${base}/home/assistants/received`;
  const inbox = await loadInbox(ctx);
  const { name } = inbox;
  const now = new Date();
  now.setSeconds(0, 0);

  const pills = (
    <TypePills label="Show" value={followUps ? "followups" : loops ? "loops" : "items"} options={[
      { label: W.receivedTypes.items, value: "items", href: here },
      { label: W.receivedTypes.followUps, value: "followups", href: `${here}?type=followups` },
      { label: LOOP_WORDS.page.title, value: "loops", href: `${here}?type=loops` },
    ]} />
  );

  let body: React.ReactNode;
  let notes: React.ReactNode;
  if (loops) {
    // Phase 7b: what the person answered of what the workspace's assistant noted for them, the last 7 days.
    const list = await answeredCommitments(ctx);
    const since = now.getTime() - 7 * 86_400_000;
    const answered = (list?.items ?? []).filter((c) => c.viewer === "committer" && !(c.canAccept || c.canDecline || c.canDismiss)
      && Date.parse(c.decidedAt ?? c.createdAt) >= since);
    body = !list ? (
      <Alert tone="danger">Your commitments couldn&apos;t be read just now. Reload the page to try again.</Alert>
    ) : !list.ready ? (
      <Alert tone="info">{LOOP_WORDS.page.notReady}</Alert>
    ) : answered.length ? (
      <ul className="-mx-2 space-y-1">
        {answered.map((c) => (
          <li key={c.id}>
            <CommitmentCard orgSlug={ctx.org.slug} view={c} timeZone={ctx.org.timezone} now={now.getTime()} compact id={`commitment-${c.id}`} highlight={highlight === c.id} />
          </li>
        ))}
      </ul>
    ) : (
      <EmptyState icon={Handshake} title="Nothing answered this week"
        description="Commitments noted for you in group chats show here for 7 days once you answer them."
        action={<Link href={`${base}/commitments`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{LOOP_WORDS.page.tabs.mine}</Link>} />
    );
    notes = <PageNote>{LOOP_WORDS.settings.pageNote}</PageNote>;
  } else if (followUps) {
    // Phase 4's "Asked about you", as it was on /home/follow-ups/about-you.
    const page = await listFollowUpsAboutMe(ctx, { limit: 20 });
    // The asks waiting for a reply have their own cards above; the list below does not repeat them.
    const waitingIds = new Set(page.waiting.map((w) => w.id));
    let items = page.items.filter((v) => !waitingIds.has(v.id));
    // A link to one older than the first page: shown at the top, so `?f=` always lands on something.
    if (page.ready && highlight && !waitingIds.has(highlight) && !items.some((v) => v.id === highlight)) {
      const one = await getFollowUp(ctx, highlight);
      if (one && one.viewer === "subject") items = [one, ...items];
    }
    const nothing = !page.waiting.length && !items.length;
    body = !page.ready ? (
      <Alert tone="info">Follow-ups need a database update first.</Alert>
    ) : nothing ? (
      <EmptyState icon={MessageSquareReply} title="Nobody has asked about your work yet"
        description="When someone's assistant asks about your work, you see here exactly what was shared."
        action={<Link href={`${base}/settings?section=assistant#follow-ups`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Follow-up settings</Link>} />
    ) : (
      <div className="space-y-10">
        <WaitingForYou orgSlug={ctx.org.slug} items={page.waiting} timeZone={ctx.org.timezone} now={now.getTime()} highlight={highlight} />
        {items.length ? (
          <section aria-labelledby="asked-about-you">
            <SectionTitle id="asked-about-you" title="Everything asked about you" />
            <AboutYouList orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} now={now.getTime()} initial={{ items, nextBefore: page.nextBefore }} highlight={highlight} />
          </section>
        ) : null}
      </div>
    );
    notes = (
      <>
        <PageNote>Your to-dos, private documents, messages and your chats with {name} are never shared.</PageNote>
        {/* Owners and HR are never in the collection before the report (it covers staff and team leads). */}
        {ctx.membership.role === "owner" || ctx.membership.role === "hr" ? null : <PageNote>Updates collected for the team report go to your team lead, the owner and HR.</PageNote>}
      </>
    );
  } else {
    const list = await listAssistantItems(ctx, { box: "received", kind: kind === "all" ? null : (kind as AssistantItemKind), status: "all", limit: 20 });
    const q = (k: Kind) => (k === "all" ? here : `${here}?kind=${k}`);
    body = !list.ready ? (
      <Alert tone="info">{W.notReady}</Alert>
    ) : (
      <>
        <FilterPills groups={[{ label: "Show", value: kind, options: KINDS.map((k) => ({ label: KIND_LABEL[k], value: k, href: q(k) })) }]} />
        {list.items.length ? (
          <AssistantItemsList key={kind} orgSlug={ctx.org.slug} box="received" kind={kind === "all" ? null : (kind as AssistantItemKind)} status="all"
            timeZone={ctx.org.timezone} now={now.getTime()} initial={{ items: list.items, nextBefore: list.nextBefore }} highlight={highlight} />
        ) : kind !== "all" ? (
          <EmptyState tone="neutral" icon={Inbox} title="Nothing here" description="Nothing you received matches this filter."
            action={<Link href={here} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all</Link>} />
        ) : (
          <EmptyState icon={Inbox} title={W.emptyReceived.title} description={W.emptyReceived.body} />
        )}
      </>
    );
    notes = <InboxNotes />;
  }

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <InboxHeader base={base} name={name} tab="received" count={inbox.count} />
      <div className="w-full min-w-0 max-w-3xl">
        {pills}
        {body}
      </div>
      <PageNotes>{notes}</PageNotes>
    </AppShell>
  );
}

/** The person's own commitments, newest first (`ready: false` before migration 0048); null when the read failed. */
async function answeredCommitments(ctx: Parameters<typeof listCommitments>[0]): Promise<CommitmentList | null> {
  try {
    return await listCommitments(ctx, { scope: "mine", status: "all", limit: LOOP_LIMITS.listMax });
  } catch (err) {
    console.warn(`[inbox] answered commitments could not be read: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}
