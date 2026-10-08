import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { RoutineOutputView } from "@/components/app/routine-preview";
import { getRun, quietHoursFor } from "@/server/services/routines";
import { schema0046Ready } from "@/server/lib/schema-0046";
import { AppError } from "@/server/lib/errors";
import { withUser } from "@/server/db";
import { ROUTINE_WORDS, runBadge, skipWords, type RoutineRunView } from "@/lib/routines";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Routine" };

const P = ROUTINE_WORDS.page;

// The same words as the history list's (routine-history, a client module whose functions a server page cannot call).
const format = (iso: string | null, tz: string, opts: Intl.DateTimeFormatOptions) => {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try { return new Intl.DateTimeFormat("en-GB", { ...opts, hourCycle: "h23", timeZone: tz }).format(at); } catch { return new Intl.DateTimeFormat("en-GB", { ...opts, hourCycle: "h23" }).format(at); }
};
/** "Fri 9 Oct, 16:00". */
const routineWhen = (iso: string | null, tz: string) => format(iso, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** "16:00". */
const routineTime = (iso: string | null, tz: string) => format(iso, tz, { hour: "2-digit", minute: "2-digit" });

/** What became of the run, in one line: when it was sent, until when it is held, or why nothing came. */
function deliveryLine(run: RoutineRunView, tz: string): string | null {
  if (run.status === "failed") return ROUTINE_WORDS.notifications.error;
  if (run.status === "skipped") return `It didn't run: ${skipWords(run.reason)}.`;
  if (run.status === "running") return null;
  if (run.delivery === "held") return run.heldUntil ? `Held for your quiet hours. It arrives at ${routineTime(run.heldUntil, tz)}.` : "Held for your quiet hours.";
  if (run.delivery === "delivered") return run.deliveredAt ? `Sent to you at ${routineTime(run.deliveredAt, tz)}.` : null;
  if (run.delivery === "silent" || run.delivery === "none") return "There was nothing to send, so it stayed quiet.";
  return null;
}

/**
 * One run of one of the person's routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed";
 * contract J.7): the routine's name, when it ran, its status in a word with what became of it (sent at 16:00, held for
 * quiet hours until 07:00, nothing to send, skipped and why, failed), then what it found (RoutineOutputView: each line
 * with its links to the task, message or follow-up behind it, "not available" for what could not be read) and what it
 * did. The notification of a run opens here. Someone else's run, or one that does not exist, is the workspace's
 * not-found page. Before migration 0046 the page shows its header and "Routines need a database update first."
 */
export default async function RoutineRunPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/routines/${id}`);
  const base = `/app/${ctx.org.slug}`;
  const back = { href: `${base}/home/routines`, label: "Back to Routines" };
  const manage = <Link href={`${base}/settings?section=assistant#routines`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{P.manage}</Link>;

  if (!(await withUser(ctx.user.profileId, (db) => schema0046Ready(db)))) {
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <PageHeader back={back} title={P.title} />
        <div className="w-full min-w-0 max-w-3xl"><Alert tone="info">{ROUTINE_WORDS.errors.notReady}</Alert></div>
      </AppShell>
    );
  }
  const [run, quiet] = await Promise.all([
    getRun(ctx, id).catch((err: unknown) => { if (err instanceof AppError && err.status === 404) return null; throw err; }),
    quietHoursFor(ctx),
  ]);
  if (!run) notFound();
  const tz = quiet.timezone;
  const badge = runBadge(run);
  const delivery = deliveryLine(run, tz);

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={back} title={run.routineName} description={P.ranAt(routineWhen(run.dueAt, tz))} actions={manage} />
      <div className="w-full min-w-0 max-w-3xl space-y-6">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {delivery ? <span className="text-meta font-normal text-secondary">{delivery}</span> : null}
        </p>
        {run.output ? (
          <div className="card-panel px-5 py-4">
            <RoutineOutputView output={run.output} orgSlug={ctx.org.slug} headingLevel={2} />
          </div>
        ) : run.status === "done" || run.status === "empty" ? (
          <p className="text-sm font-normal text-secondary">{run.summary ?? "Nothing to show for this run."}</p>
        ) : null}
      </div>
      <PageNotes>
        <PageNote>Only you can see what your routines sent you. Each line links to where it came from, when there is a page for it.</PageNote>
        <PageNote>Times are in your time zone ({tz}).</PageNote>
      </PageNotes>
    </AppShell>
  );
}
