import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { MyFollowUpsList } from "@/components/app/follow-ups-list";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { getFollowUpBatch, listMyFollowUps, waitingForMe } from "@/server/services/follow-ups";
import { schema0039Ready } from "@/server/lib/schema-0039";
import { withUser } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-ups" };

type Status = "open" | "done" | "all";
const STATUS_LABEL: Record<Status, string> = { open: "Open", done: "Answered", all: "All" };
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Follow-ups, "You asked" (owner decision, 8 October 2026: personal assistants, phase 4): what the person asked other
 * people's assistants and what they answered, newest first, each drawn as the exchange between the two assistants. A
 * follow-up with a group or a team is one card with a compact row per person. `?status=` filters (Open, Answered, All);
 * `?batch=` shows one ask alone (the link in her chat, a notification), with "Show all follow-ups". "Asked about you" is
 * the second tab, with an orange count while someone's assistant waits for the person's reply.
 *
 * Not gated by the plan: a record of what was asked and answered stays readable, as past chats are. The page refreshes
 * as follow-ups change (the workspace's change stream). Before migration 0039 it says follow-ups need a database update.
 */
export default async function FollowUpsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ status?: string | string[]; batch?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const asked = [sp.status].flat()[0];
  const status: Status = asked === "open" || asked === "done" ? asked : "all";
  const batchId = [sp.batch].flat()[0]?.trim() || null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/follow-ups`);
  const base = `/app/${ctx.org.slug}`;
  const [assistants, list, waiting, one] = await Promise.all([
    assistantProfiles(ctx),
    batchId ? Promise.resolve(null) : listMyFollowUps(ctx, { status, limit: 20 }),
    waitingForMe(ctx),
    batchId && isId(batchId) ? getFollowUpBatch(ctx, batchId) : Promise.resolve(null),
  ]);
  const { name } = assistants.personal;
  // The list says whether 0039 is applied; `?batch=` alone asks only when the batch is not there.
  const ready = list ? list.ready : one ? true : await withUser(ctx.user.profileId, (db) => schema0039Ready(db));
  const now = new Date();
  now.setSeconds(0, 0);
  const askHref = `${base}/home?ask=${encodeURIComponent("Follow up with ")}`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title="Follow-ups"
        description="What you asked other people's assistants, and what they answered."
        tabsLabel="Follow-ups" tabValue="mine"
        tabs={[
          { label: "You asked", value: "mine", href: `${base}/home/follow-ups` },
          { label: "Asked about you", value: "about", href: `${base}/home/follow-ups/about-you`, count: waiting.length, attention: true },
        ]} />
      <div className="w-full min-w-0 max-w-3xl">
        {!ready ? (
          <Alert tone="info">Follow-ups need a database update first.</Alert>
        ) : batchId ? (
          <>
            <Link href={`${base}/home/follow-ups`} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mb-4`}>Show all follow-ups</Link>
            {one ? <MyFollowUpsList key={one.id} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} now={now.getTime()} status="all" initial={{ batches: [one], nextBefore: null }} />
              : <EmptyState tone="neutral" icon={MessageSquareReply} title="That follow-up isn't here" description="It may be one you can't see, or the link is incomplete." />}
          </>
        ) : (
          <>
            <Tabs variant="pills" label="Show" value={status} className="mb-4"
              tabs={(["open", "done", "all"] as const).map((s) => ({ label: STATUS_LABEL[s], value: s, href: s === "all" ? `${base}/home/follow-ups` : `${base}/home/follow-ups?status=${s}` }))} />
            {list && list.batches.length ? (
              <MyFollowUpsList key={status} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} now={now.getTime()} status={status} initial={{ batches: list.batches, nextBefore: list.nextBefore }} />
            ) : status === "all" ? (
              <EmptyState icon={MessageSquareReply} title="No follow-ups yet"
                description={`Ask ${name} “Where is Ben on the landing page?” and their assistant answers from their work.`}
                action={<Link href={askHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>Ask {name}</Link>} />
            ) : (
              <EmptyState tone="neutral" icon={MessageSquareReply} title={status === "open" ? "Nothing waiting for an answer" : "No answers yet"}
                description={status === "open" ? "Everything you asked has been answered." : "Answers show here as other people's assistants send them."}
                action={<Link href={`${base}/home/follow-ups`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all</Link>} />
            )}
          </>
        )}
      </div>
      <PageNotes>
        <PageNote>Only you and the person you asked can see a follow-up. The organisation owner and HR see that it happened, not what was said.</PageNote>
        <PageNote>A follow-up never changes anyone&apos;s task.</PageNote>
        {one?.kind === "workspace" ? <PageNote>Updates collected for the team report go to each person&apos;s team lead, the owner and HR.</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}
