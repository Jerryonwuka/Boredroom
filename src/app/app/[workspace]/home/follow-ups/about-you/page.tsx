import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { WaitingForYou } from "@/components/app/follow-up-reply";
import { AboutYouList } from "@/components/app/follow-ups-list";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { getFollowUp, listFollowUpsAboutMe } from "@/server/services/follow-ups";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Asked about you" };

const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Follow-ups, "Asked about you" (owner decision, 8 October 2026: personal assistants, phase 4: full transparency for the
 * person asked about). First the asks waiting for the person's reply ("Waiting for you", one reply card each); then
 * every follow-up about them, newest first, as they see it: who asked, the question, exactly what their assistant
 * shared, their reply and the times, including those their assistant answered from their work without asking them.
 * Reached from her home screen's Follow-ups pill, "What Max did", Settings → Your assistant and the ask's notification
 * (`?f=<id>`, which marks that follow-up and scrolls to it).
 *
 * Always the person's own. Not gated by the plan: replying never needs the AI. Before migration 0039 it says follow-ups
 * need a database update.
 */
export default async function AskedAboutYouPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ f?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const f = [sp.f].flat()[0]?.trim();
  const highlight = f && isId(f) ? f : null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/follow-ups/about-you`);
  const base = `/app/${ctx.org.slug}`;
  const [assistants, page] = await Promise.all([assistantProfiles(ctx), listFollowUpsAboutMe(ctx, { limit: 20 })]);
  const { name } = assistants.personal;
  const now = new Date();
  now.setSeconds(0, 0);
  // The asks waiting for a reply have their own cards above; the list below does not repeat them.
  const waitingIds = new Set(page.waiting.map((w) => w.id));
  let items = page.items.filter((v) => !waitingIds.has(v.id));
  // A link to one that is older than the first page: shown at the top, so `?f=` always lands on something.
  if (page.ready && highlight && !waitingIds.has(highlight) && !items.some((v) => v.id === highlight)) {
    const one = await getFollowUp(ctx, highlight);
    if (one && one.viewer === "subject") items = [one, ...items];
  }
  const nothing = !page.waiting.length && !items.length;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title="Follow-ups"
        description="What other people's assistants asked about your work, and exactly what was shared."
        tabsLabel="Follow-ups" tabValue="about"
        tabs={[
          { label: "You asked", value: "mine", href: `${base}/home/follow-ups` },
          { label: "Asked about you", value: "about", href: `${base}/home/follow-ups/about-you`, count: page.waiting.length, attention: true },
        ]} />
      <div className="w-full min-w-0 max-w-3xl">
        {!page.ready ? (
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
        )}
      </div>
      <PageNotes>
        <PageNote>Your to-dos, private documents, messages and your chats with {name} are never shared.</PageNote>
        {/* Owners and HR are never in the collection before the report (it covers staff and team leads). */}
        {ctx.membership.role === "owner" || ctx.membership.role === "hr" ? null : <PageNote>Updates collected for the team report go to your team lead, the owner and HR.</PageNote>}
      </PageNotes>
    </AppShell>
  );
}
