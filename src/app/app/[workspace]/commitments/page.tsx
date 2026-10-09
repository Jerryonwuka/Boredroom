import type { Metadata } from "next";
import Link from "next/link";
import { Handshake, Info } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { CommitmentFilterBar, CommitmentsTable, type StatusFilter } from "@/components/app/commitments-table";
import { WaitingOnView } from "@/components/app/waiting-on-list";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { commitmentSettings, getCommitment, listCommitments } from "@/server/services/commitments";
import { waitingOnList } from "@/server/services/task-blocks";
import { withUser } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import type { OrgContext } from "@/server/lib/api";
import { LOOP_LIMITS, LOOP_WORDS, type CommitmentList, type CommitmentScope, type CommitmentSettings, type WaitingOnList } from "@/lib/commitments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commitments" };

const P = LOOP_WORDS.page;
type Tab = CommitmentScope | "waiting";
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const first = (v: string | string[] | undefined) => [v].flat()[0]?.trim() || undefined;
/** What each scope can filter by: a supervisor never sees one waiting, declined or "not a commitment" (as the filter bar). */
const STATUSES: Record<CommitmentScope, readonly StatusFilter[]> = {
  mine: ["all", "waiting", "open", "overdue", "done", "declined", "dismissed"],
  team: ["all", "open", "overdue", "done"],
  all: ["all", "open", "overdue", "done"],
};

/**
 * Commitments (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"; contract H.4): what people
 * committed to in the workspace's tracked group conversations, and who is waiting on whom. In the Work group of the
 * navigation for every role.
 *
 * Tabs (`?tab=`): "My commitments" (everyone: what the person owes and what they asked of others, every status, with
 * Answer, Mark done and the links), "Team" (team leads: the accepted commitments of the people on their teams), "Everyone"
 * (the owner and HR: everyone's accepted ones) and "Waiting on" (open "blocked on" questions: the person's own, a lead's
 * teams', everyone's for the owner and HR; `?scope=` picks among those the person may see). Supervisors only ever see
 * accepted commitments (open, overdue, done), never one waiting for an answer, declined or "not a commitment"; and the
 * message's words only when they are in that conversation (contract, decision 3). The database decides all of it.
 *
 * Filters: person (team and everyone), status, "This week" (`?person=`, `?status=`, `?week=1`). `?c=` marks one row and
 * scrolls to it (notifications, the report and the routine's output link here); one older than the first page is read on
 * its own and shown first. While the workspace's tracking is off, an info line says so (past ones still list). Before
 * migration 0048 the page shows its header and an info alert. Not gated by the plan: detection is, answering never is.
 */
export default async function CommitmentsPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tab?: string | string[]; person?: string | string[]; status?: string | string[]; week?: string | string[]; c?: string | string[]; scope?: string | string[] }>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/commitments`);
  const base = `/app/${ctx.org.slug}/commitments`;
  const admin = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  const lead = teams.some((t) => t.is_manager);
  // What the person may see; the server's own answer (`scopes`) replaces this once a list is read.
  let scopes: CommitmentScope[] = ["mine", ...(lead ? ["team" as const] : []), ...(admin ? ["all" as const] : [])];
  const askedTab = first(sp.tab);
  let tab: Tab = askedTab === "waiting" ? "waiting" : scopes.includes(askedTab as CommitmentScope) ? (askedTab as CommitmentScope) : "mine";
  const c = first(sp.c);
  const highlight = c && isId(c) ? c : null;
  const now = new Date();
  now.setSeconds(0, 0);

  const [assistants, settings] = await Promise.all([assistantProfiles(ctx), readSettings(ctx)]);
  const W = assistants.workspace.name;

  let list: CommitmentList | null = null;
  let waiting: WaitingOnList | null = null;
  let failed = false;
  let person: string | null = null;
  let status: StatusFilter = "all";
  let week = false;
  let waitingScope: CommitmentScope = admin ? "all" : lead ? "team" : "mine";

  if (tab === "waiting") {
    const askedScope = first(sp.scope);
    if (askedScope && scopes.includes(askedScope as CommitmentScope)) waitingScope = askedScope as CommitmentScope;
    try {
      waiting = await waitingOnList(ctx, { scope: waitingScope });
    } catch (err) {
      if (err instanceof AppError && err.status === 403 && waitingScope !== "mine") {
        waitingScope = "mine";
        waiting = await waitingOnList(ctx, { scope: "mine" }).catch(() => null);
      }
      failed = !waiting;
      if (failed) console.warn(`[commitments] waiting on could not be read: ${(err as Error)?.message ?? String(err)}`);
    }
  } else {
    const askedPerson = first(sp.person);
    person = tab !== "mine" && askedPerson && isId(askedPerson) ? askedPerson : null;
    const askedStatus = first(sp.status);
    status = STATUSES[tab].includes(askedStatus as StatusFilter) ? (askedStatus as StatusFilter) : "all";
    week = first(sp.week) === "1";
    try {
      list = await listCommitments(ctx, { scope: tab, person, status, thisWeek: week, limit: LOOP_LIMITS.listMax });
    } catch (err) {
      // A scope the server does not give this person (their teams changed): their own instead.
      if (err instanceof AppError && err.status === 403 && tab !== "mine") {
        tab = "mine"; person = null; status = "all";
        list = await listCommitments(ctx, { scope: "mine", status, thisWeek: week, limit: LOOP_LIMITS.listMax }).catch(() => null);
      }
      failed = !list;
      if (failed) console.warn(`[commitments] the list could not be read: ${(err as Error)?.message ?? String(err)}`);
    }
    if (list?.ready) {
      scopes = list.scopes.length ? list.scopes : scopes;
      // A link to one older than the first page (or outside these filters): shown first, so `?c=` always lands.
      if (highlight && !list.items.some((x) => x.id === highlight)) {
        const one = await getCommitment(ctx, highlight).catch(() => null);
        if (one) list = { ...list, items: [one, ...list.items] };
      }
    }
  }

  const ready = tab === "waiting" ? waiting?.ready !== false : list?.ready !== false;
  const tabs = [
    { label: P.tabs.mine, value: "mine", href: base },
    ...(scopes.includes("team") ? [{ label: P.tabs.team, value: "team", href: `${base}?tab=team` }] : []),
    ...(scopes.includes("all") ? [{ label: P.tabs.all, value: "all", href: `${base}?tab=all` }] : []),
    { label: P.tabs.waitingOn, value: "waiting", href: `${base}?tab=waiting` },
  ];
  const filtered = !!person || status !== "all" || week;
  const trackingOff = settings?.ready && !settings.track && tab !== "waiting";

  let body: React.ReactNode;
  if (failed) {
    body = <Alert tone="danger">This couldn&apos;t be read just now. Reload the page to try again.</Alert>;
  } else if (!ready) {
    body = <Alert tone="info">{P.notReady}</Alert>;
  } else if (tab === "waiting" && waiting) {
    const waitingScopes = scopes.length > 1 ? (
      <Tabs variant="pills" bordered={false} label="Whose" value={waitingScope} className="mb-5"
        tabs={scopes.map((s) => ({ label: s === "mine" ? "Mine" : s === "team" ? P.tabs.team : P.tabs.all, value: s, href: `${base}?tab=waiting&scope=${s}` }))} />
    ) : null;
    body = <>{waitingScopes}<WaitingOnView list={waiting} timeZone={ctx.org.timezone} now={now.getTime()} /></>;
  } else if (list && tab !== "waiting") {
    body = (
      <>
        <CommitmentFilterBar base={base} scope={tab} person={person} status={status} week={week} people={list.people} />
        {list.items.length ? (
          <CommitmentsTable key={`${tab}-${person}-${status}-${week}`} orgSlug={ctx.org.slug} scope={tab} filters={{ person, status, week }}
            initial={{ items: list.items, nextBefore: list.nextBefore }} timeZone={ctx.org.timezone} now={now.getTime()} highlight={highlight} />
        ) : filtered ? (
          <EmptyState tone="neutral" icon={Handshake} title="Nothing matches" description="No commitment matches these filters."
            action={<Link href={tab === "mine" ? base : `${base}?tab=${tab}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show all</Link>} />
        ) : tab === "mine" ? (
          <EmptyState icon={Handshake} title={P.emptyMine.title} description={P.emptyMine.body} />
        ) : tab === "all" ? (
          <EmptyState icon={Handshake} title={P.emptyAll.title} description={P.emptyAll.body} />
        ) : (
          <EmptyState icon={Handshake} title={P.emptyTeam.title} description={P.emptyTeam.body} />
        )}
      </>
    );
  }

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title={P.title} description={P.description} tabsLabel={P.title} tabValue={tab} tabs={tabs} />
      <div className="w-full min-w-0">
        {trackingOff ? (
          <p role="note" className="mb-4 flex items-start gap-2 text-meta font-normal text-secondary">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {admin ? <span>{P.trackingOffAdmin}{" "}<Link href={`/app/${ctx.org.slug}/settings?section=brenda#commitments`} className="link-inline font-medium text-foreground">{P.openSettings}</Link></span> : P.trackingOff(W)}
          </p>
        ) : null}
        {body}
      </div>
      <PageNotes>
        <PageNote>{LOOP_WORDS.settings.pageNote}</PageNote>
        {tab === "waiting" ? <PageNote section={P.tabs.waitingOn}>The person waited on answers from their own Between assistants inbox; the answer goes on the task as their comment.</PageNote> : null}
        <PageNote>Dates are in the organisation&apos;s time zone ({ctx.org.timezone}).</PageNote>
      </PageNotes>
    </AppShell>
  );
}

/** The workspace's switches (whether tracking is on); null when they cannot be read (the line is then left out). */
async function readSettings(ctx: OrgContext): Promise<CommitmentSettings | null> {
  try {
    return await withUser(ctx.user.profileId, (db) => commitmentSettings(db, ctx.org.id));
  } catch {
    return null;
  }
}
