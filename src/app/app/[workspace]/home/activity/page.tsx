import type { Metadata } from "next";
import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { AssistantActivity } from "@/components/app/assistant-activity";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { ACTIVITY_KINDS, listActivity, type ActivityKind } from "@/server/services/assistant-activity";
import { aiAllowance } from "@/server/services/ai-usage";

export const dynamic = "force-dynamic";

/** The tab names the person's own assistant: "What Max did". orgContext and assistantProfiles are cached per request. */
export async function generateMetadata({ params }: { params: Promise<{ workspace: string }> }): Promise<Metadata> {
  const { workspace } = await params;
  try {
    return { title: `What ${(await assistantProfiles(await orgContext(workspace))).personal.name} did` };
  } catch {
    return { title: "What Brenda did" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

const TAB_LABEL: Record<ActivityKind, string> = { all: "All", actions: "Actions", reads: "Reads", problems: "Didn't go through" };

/**
 * "What Max did" (owner decision, 8 October 2026: personal assistants, phase 3): everything the person's own assistant
 * did or read for them, newest first, in pages of 30 (assistant-activity). Reached from her home screen's top row and
 * her chat's header, and from Settings → Your assistant. Always the person's own, whatever their role: owners and HR
 * keep the organisation-wide view of her actions in Settings → Brenda and Audit, never what she read for someone.
 *
 * `?kind=` picks the tab (All, Actions, Reads, Didn't go through); anything else reads as All. The header's meta line
 * shows today's requests against the daily limit once migration 0037 is applied and while the plan includes the
 * assistant. Not gated by the plan otherwise: a record of what happened stays readable, as past chats are.
 *
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4): the header's actions link
 * to "Follow-ups" (what the person asked other people's assistants) and "Asked about you" (every follow-up about their
 * work and exactly what their assistant shared, including the ones answered without disturbing them). Since phase 6
 * (owner decision, 8 October 2026: assistants talk to each other) both are tabs of one inbox, so the header links to
 * "Between assistants": Waiting for you, Sent (follow-ups included) and Received (follow-ups about you included).
 */
export default async function AssistantActivityPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ kind?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const asked = [sp.kind].flat()[0];
  const kind: ActivityKind = (ACTIVITY_KINDS as readonly string[]).includes(asked ?? "") ? (asked as ActivityKind) : "all";
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/activity${kind === "all" ? "" : `?kind=${kind}`}`);
  const [page, assistants, allowance] = await Promise.all([listActivity(ctx, { kind, limit: 30 }), assistantProfiles(ctx), aiAllowance(ctx)]);
  const { name } = assistants.personal;
  const base = `/app/${ctx.org.slug}`;
  const aiEnabled = ctx.plan.features.AI_ASSISTANT === true;
  // The server's clock to the minute, so "Today" and "Yesterday" read the same on both sides.
  const now = new Date();
  now.setSeconds(0, 0);

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      {/* The header and its tabs run the page's width on their hairline; the list reads in a 768px column. */}
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title={`What ${name} did`}
        description={`Everything ${name} did or read for you, newest first.`}
        actions={<Link href={`${base}/home/assistants`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Between assistants</Link>}
        meta={allowance.ready && aiEnabled ? <><span className="tabular-nums">{allowance.used}</span> of <span className="tabular-nums">{allowance.limit}</span> requests used today</> : undefined}
        tabsLabel="Show" tabValue={kind} tabParam="kind"
        tabs={ACTIVITY_KINDS.map((k) => ({ label: TAB_LABEL[k], value: k, href: k === "all" ? `${base}/home/activity` : `${base}/home/activity?kind=${k}` }))} />
      <div className="w-full min-w-0 max-w-3xl">
        <AssistantActivity key={kind} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} kind={kind} initial={page} name={name} now={now.getTime()} canAsk={aiEnabled} />
      </div>
      <PageNotes>
        <PageNote>Only you can see what {name} read for you. The organisation owner and HR can see {name}&apos;s actions, as they can for everyone&apos;s assistant.</PageNote>
        <PageNote>Reading your messages never marks them as read.</PageNote>
        {page.readsHidden ? <PageNote>What {name} read is hidden while someone else is signed in as this person.</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}
