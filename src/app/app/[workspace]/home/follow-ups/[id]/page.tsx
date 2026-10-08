import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { FollowUpExchange } from "@/components/app/follow-up-exchange";
import { CancelFollowUpButton, WaitingForYou } from "@/components/app/follow-up-reply";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { getFollowUp } from "@/server/services/follow-ups";
import { schema0039Ready } from "@/server/lib/schema-0039";
import { withUser } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-up" };

/** A malformed id in the address is a missing page, not a database error. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** One read per request (React's cache; orgContext is cached the same way). */
const loadFollowUp = cache(async (slug: string, id: string) => (isId(id) ? getFollowUp(await orgContext(slug), id) : null));

/**
 * One follow-up between assistants (owner decision, 8 October 2026: personal assistants, phase 4), for whoever may see
 * it: the person who asked, the person asked about, or (for the workspace's own collection before the team report)
 * someone who may see that person's records. The whole exchange; the reply card while the person asked about still
 * owes a reply; "Cancel follow-up" for the person who asked while it is still open. Anyone else gets the workspace's
 * not-found page, the same as for a follow-up that does not exist. The notification of an answer links here.
 */
export default async function FollowUpPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/follow-ups/${id}`);
  const base = `/app/${ctx.org.slug}`;
  const [view, assistants] = await Promise.all([loadFollowUp(workspace, id), assistantProfiles(ctx)]);
  const { name } = assistants.personal;
  const now = new Date();
  now.setSeconds(0, 0);

  if (!view) {
    // Before migration 0039 nothing is there to find: the page says why instead of "not found".
    if (await withUser(ctx.user.profileId, (db) => schema0039Ready(db))) notFound();
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title="Follow-up" />
        <div className="w-full min-w-0 max-w-3xl"><Alert tone="info">Follow-ups need a database update first.</Alert></div>
      </AppShell>
    );
  }

  const S = view.subject.firstName;
  const subjectView = view.viewer === "subject";
  const back = subjectView ? { href: `${base}/home/follow-ups/about-you`, label: "Back to Asked about you" } : { href: `${base}/home/follow-ups`, label: "Back to Follow-ups" };
  const description = !view.requester ? `${S}'s update for today's team report.`
    : subjectView ? `${view.requester.firstName}'s ${view.requester.assistant.name} asked about your work.`
    : view.viewer === "requester" ? `You asked ${S}'s ${view.subject.assistant.name}.`
    : `${view.requester.firstName} asked ${S}'s ${view.subject.assistant.name}.`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={back} title="Follow-up" description={description}
        actions={view.canCancel ? <CancelFollowUpButton orgSlug={ctx.org.slug} view={view} /> : undefined} />
      <div className="w-full min-w-0 max-w-3xl space-y-6">
        {/* The person asked about, while their reply is still wanted (kept, collapsed to "Sent.", once it goes). */}
        <WaitingForYou orgSlug={ctx.org.slug} items={view.canReply ? [view] : []} timeZone={ctx.org.timezone} now={now.getTime()} title={null} />
        <FollowUpExchange view={view} timeZone={ctx.org.timezone} now={now.getTime()} />
      </div>
      <PageNotes>
        {subjectView ? <PageNote>Your to-dos, private documents, messages and your chats with {name} are never shared.</PageNote>
          : view.requester ? <PageNote>Only you and the person you asked can see a follow-up. The organisation owner and HR see that it happened, not what was said.</PageNote>
          : <PageNote>Updates collected for the team report go to each person&apos;s team lead, the owner and HR.</PageNote>}
        <PageNote>A follow-up never changes anyone&apos;s task.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
