import type { Metadata } from "next";
import Link from "next/link";
import { Sunrise } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { StandupCard } from "@/components/app/standup-card";
import { StandupRollupCard } from "@/components/app/standup-rollup-card";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { standupToday } from "@/server/services/standup";
import { abilitiesFor } from "@/server/services/abilities";
import { todayLocal } from "@/server/lib/time";
import type { OrgContext } from "@/server/lib/api";
import { ABILITY_WORDS, abilityOff } from "@/lib/abilities";
import { STANDUP_NOT_READY_SHORT, STANDUP_WORDS, type StandupToday } from "@/lib/standup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: STANDUP_WORDS.page.title };

const P = STANDUP_WORDS.page;

/** A malformed id in the address marks nothing. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const pick = (v: string | string[] | undefined) => { const s = [v].flat()[0]?.trim(); return s && isId(s) ? s : null; };

/**
 * Standup (owner decisions, 8–9 October 2026: phase 7c, async standup option B; contract G.2). The person's standups
 * and, for team leads, their teams' rollups:
 *
 * - **Today**: the person's standup in each team that runs one, whatever state it is in (drafting, ready to post with
 *   Post, Edit and Skip today, posted, skipped with Undo until the cutoff, failed), each a card (standup-card). Only the
 *   first draft waiting to be posted has the orange Post: never two orange buttons on one screen.
 * - **Rollups** (whoever receives one: the team's leads): today's, whole (who posted, the blockers they named, who has no
 *   update, neutrally, and posts that came later), then the last 7 days behind a disclosure.
 * - `?e=` (a draft's notification) and `?r=` (a rollup's) bring that card into view and focus it; an older rollup's
 *   disclosure opens for it.
 *
 * Nothing here chases anyone: no reminders, no "you haven't posted". Before the post time of a team that runs one:
 * "Drafts arrive at 09:30 (Design)." Empty: "No standup today", with where it is switched on (leads, the owner and HR:
 * their team's Standup tab). Before migration 0050 the page shows its header and "Standups
 * need a database update first."; while the workspace does not offer standups, the reason and where it is switched on.
 */
export default async function StandupPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ e?: string | string[]; r?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const focusEntry = pick(sp.e);
  const focusRollup = pick(sp.r);
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/standup`);
  const base = `/app/${ctx.org.slug}`;
  const [view, assistants, abilities] = await Promise.all([readStandup(ctx), assistantProfiles(ctx), abilitiesFor(ctx)]);
  const { name } = assistants.personal;
  const tz = ctx.org.timezone;
  const today = todayLocal(tz);

  const entries = view?.entries ?? [];
  // Standup on for one of their teams and today's not started yet: when it comes, never "switch it on".
  const upcoming = view?.upcoming ?? [];
  const rollups = view?.rollups ?? [];
  const todaysRollups = rollups.filter((r) => r.localDate >= today);
  const earlier = rollups.filter((r) => r.localDate < today);
  // The one orange Post on the page: the first draft waiting to be posted (accent rules, 6 October 2026).
  const standoutId = entries.find((e) => e.status === "ready")?.id ?? null;
  // Who can switch standup on: a team's lead, the owner and HR (the team page's Standup tab).
  const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  const led = teams.find((t) => t.is_manager) ?? (isOrg ? teams[0] : undefined);
  const leads = isOrg || teams.some((t) => t.is_manager);
  const off = view?.off ? abilityOff(abilities, "standup") : null;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title={P.title} description={P.description(name)} />
      <div className="w-full min-w-0 max-w-3xl space-y-10">
        {!view ? (
          <Alert tone="danger">Your standup couldn&apos;t be read just now. Reload the page to try again.</Alert>
        ) : !view.ready ? (
          <Alert tone="info">{STANDUP_NOT_READY_SHORT}</Alert>
        ) : (
          <>
            {off ? <Alert tone="info">{ABILITY_WORDS.refusal("Standup", off, name, isOrg)}</Alert> : null}
            {/* Before today's post time: when it comes, also for a lead whose earlier rollups are listed below. */}
            {!entries.length && upcoming.length ? (
              <EmptyState icon={Sunrise} title={P.upcomingTitle} description={P.upcoming(upcoming)} />
            ) : !entries.length && !rollups.length ? (
              <EmptyState icon={Sunrise} title={P.emptyTitle}
                description={leads ? P.emptyBodyLead : P.emptyBody}
                action={leads && led ? <Link href={`${base}/teams/${led.id}?tab=standup`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open {led.name}&apos;s Standup tab</Link> : undefined} />
            ) : null}
            {entries.length ? (
              <section aria-labelledby="standup-today">
                <SectionTitle id="standup-today" title={P.today} />
                <ul className="space-y-3">
                  {entries.map((e) => (
                    <li key={e.id}><StandupCard orgSlug={ctx.org.slug} entry={e} timeZone={tz} standout={e.id === standoutId} highlight={e.id === focusEntry} /></li>
                  ))}
                </ul>
              </section>
            ) : null}
            {rollups.length || (leads && entries.length) ? (
              <section aria-labelledby="standup-rollups">
                <SectionTitle id="standup-rollups" title={P.rollups} description="One per team you lead, put together at the team's rollup time." />
                {todaysRollups.length ? (
                  <ul className="space-y-3">
                    {todaysRollups.map((r) => (
                      <li key={r.id}><StandupRollupCard orgSlug={ctx.org.slug} rollup={r} timeZone={tz} id={`rollup-${r.id}`} highlight={r.id === focusRollup} /></li>
                    ))}
                  </ul>
                ) : <p className="text-sm font-normal text-secondary">No rollup yet today. Each team&apos;s lead gets theirs at the team&apos;s rollup time.</p>}
                {earlier.length ? (
                  <details className="mt-5" open={earlier.some((r) => r.id === focusRollup) || undefined}>
                    <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                      {P.earlier} <span className="tabular-nums">({earlier.length})</span>
                    </summary>
                    <ul className="mt-3 space-y-3">
                      {earlier.map((r) => (
                        <li key={r.id}><StandupRollupCard orgSlug={ctx.org.slug} rollup={r} timeZone={tz} id={`rollup-${r.id}`} highlight={r.id === focusRollup} /></li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      <PageNotes>
        <PageNote>Only you see your draft. What you post goes to your team&apos;s channel as yours, sent by {name}, and your team lead gets one rollup.</PageNote>
        <PageNote>Nobody is reminded or chased. The rollup lists anyone without an update by name only: skipping the day and not posting read the same.</PageNote>
        <PageNote>Times are in the organisation&apos;s time zone ({tz}).</PageNote>
      </PageNotes>
    </AppShell>
  );
}

/** Today's standups and the last 7 days of rollups; null when they cannot be read (`ready: false` before 0050). */
async function readStandup(ctx: OrgContext): Promise<StandupToday | null> {
  try {
    return await standupToday(ctx, { days: 7 });
  } catch (err) {
    console.warn(`[standup] the page could not be read: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}
