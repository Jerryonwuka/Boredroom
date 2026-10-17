import type { Metadata } from "next";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { JobsList } from "@/components/app/jobs-list";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { listJobs } from "@/server/services/jobs";
import { JOB_WORDS } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jobs" };

/**
 * Jobs (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "a private Jobs list on the web (only
 * the person)"; contract N.1, S.9): what the person's assistant did for them in the background on their Mac, the Files
 * helper's and the Mac operator's jobs, from the last 30 days. Always the person's own, whatever their role: owners, HR
 * and leads never see anyone's. Undo is pressed on the Mac where a job ran (its record of what moved stays there); the
 * list says so. Forget is disabled while someone else is signed in as the person.
 */
export default async function JobsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/jobs`);
  const [data, assistants] = await Promise.all([listJobs(ctx), assistantProfiles(ctx)]);
  const { name } = assistants.personal;
  const base = `/app/${ctx.org.slug}`;
  const now = new Date();
  now.setSeconds(0, 0);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: JOB_WORDS.back(name) }} title={JOB_WORDS.title} description={JOB_WORDS.description(name)} />
      <div className="w-full min-w-0 max-w-3xl">
        <JobsList orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} name={name} initial={data} impersonated={!!ctx.user.impersonation} now={now.getTime()} />
      </div>
      <PageNotes>
        <PageNote>{`What you asked ${name} to do on your Mac, and what ${name} did, shows only here, only to you, for 30 days. Pictures, file contents and where your files are are never kept.`}</PageNote>
      </PageNotes>
    </AppShell>
  );
}
