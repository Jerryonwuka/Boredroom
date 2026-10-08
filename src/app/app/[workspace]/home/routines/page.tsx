import type { Metadata } from "next";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { RoutineHistory } from "@/components/app/routine-history";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { listRuns, quietHoursFor } from "@/server/services/routines";
import { ROUTINE_WORDS } from "@/lib/routines";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Routines" };

const P = ROUTINE_WORDS.page;

/**
 * Routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"; contract J.7): what the person's
 * routines sent them on a schedule, newest first, across all their routines: each run named after its routine, when it
 * was due, its status in a word (Sent, Held for quiet hours, Nothing to send, Skipped, Failed), its one-line summary and
 * Open, which shows the run (/home/routines/{runId}); "Load more" fetches the next 20 (routine-history). "Manage
 * routines" goes to Settings → Your assistant → Routines, where they are set up, previewed, enabled and paused. The bundle
 * notification of routines held during quiet hours lands here.
 *
 * Only the person's own runs (row-level security and the service). Times are in their own time zone. Before migration
 * 0046 the page shows its header and "Routines need a database update first."
 */
export default async function RoutinesPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/routines`);
  const [page, assistants, quiet] = await Promise.all([listRuns(ctx, { limit: 20 }), assistantProfiles(ctx), quietHoursFor(ctx)]);
  const { name } = assistants.personal;
  const base = `/app/${ctx.org.slug}`;
  const manageHref = `${base}/settings?section=assistant#routines`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title={P.title} description={P.description(name)}
        actions={<Link href={manageHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>{P.manage}</Link>} />
      <div className="w-full min-w-0 max-w-3xl">
        {!page.ready ? <Alert tone="info">{ROUTINE_WORDS.errors.notReady}</Alert>
          : page.runs.length === 0 ? (
            <EmptyState icon={Repeat} title={P.emptyTitle} description={P.emptyBody}
              action={<Link href={manageHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>{P.manage}</Link>} />
          ) : <RoutineHistory orgSlug={ctx.org.slug} timeZone={quiet.timezone} initial={page} />}
      </div>
      <PageNotes>
        <PageNote>Only you can see what your routines sent you.</PageNote>
        <PageNote>Times are in your time zone ({quiet.timezone}). Routines that ran during your quiet hours arrive together when they end.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
