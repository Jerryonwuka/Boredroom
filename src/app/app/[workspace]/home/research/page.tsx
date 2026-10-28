import type { Metadata } from "next";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { ResearchList } from "@/components/app/research-list";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { listResearch, researchDailyLimit } from "@/server/research/service";
import { RESEARCH_LIMITS, RESEARCH_WORDS } from "@/lib/research";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Research (owner decision, 28 October 2026: "Brenda, research X and give me a PDF when you're done"): what the person
 * asked their assistant to look into on the web, newest first, with each report's status, its downloads (PDF, Word,
 * Markdown) and Stop while it waits or runs. Always the person's own, whatever their role: owners, HR and leads never see
 * anyone's. A notification's link (`?r=<id>`) marks the report it is about. Reached from "What {name} did" and from
 * the notifications; before migration 0066 it says it needs a database update.
 */
export default async function ResearchPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ r?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const selected = [sp.r].flat()[0]?.trim() ?? "";
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/research`);
  const [data, assistants] = await Promise.all([listResearch(ctx), assistantProfiles(ctx)]);
  const { name } = assistants.personal;
  const base = `/app/${ctx.org.slug}`;
  const now = new Date();
  now.setSeconds(0, 0);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home/activity`, label: `Back to What ${name} did` }} title={RESEARCH_WORDS.title} description={RESEARCH_WORDS.description(name)} />
      <div className="w-full min-w-0 max-w-3xl">
        <ResearchList orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} name={name} initial={data} selected={UUID.test(selected) ? selected.toLowerCase() : null} now={now.getTime()} />
      </div>
      <PageNotes>
        <PageNote>{`${name} researches in the background and tells you when a report is ready. Up to ${researchDailyLimit()} a day; each looks at up to about ${RESEARCH_LIMITS.searches} searches and ${RESEARCH_LIMITS.fetches} pages on the public web, and nothing else.`}</PageNote>
        <PageNote>{`Reports are kept for ${RESEARCH_LIMITS.keepDays} days, then deleted. What the web says is quoted with its sources: check anything important.`}</PageNote>
      </PageNotes>
    </AppShell>
  );
}
