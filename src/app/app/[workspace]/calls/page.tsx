import { PhoneOff } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { CallsList, HappeningNow } from "@/components/app/calls-list";
import { callHistory, callsAvailability, liveCalls } from "@/server/services/calls";
import { CALL_WORDS, type CallHistoryList, type LiveCallSummary } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calls" };

/**
 * Calls (owner decisions, 8 October 2026: phase 8, calls; contract D.8): screen recording is gone and people call each
 * other instead, on every plan. Underline tabs All and Missed (`?filter=missed`, which also marks the missed-call
 * notifications read); "Happening now" first when a call is running in a conversation the person reads; then their history
 * (`CallsList`). Before migration 0054 the page says calls need a database update; without LiveKit, that calls aren't set
 * up yet (the history still shows). Calls are never recorded: the page's note says so, and how notes work.
 */
export default async function CallsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/calls`);
  const filter = sp.filter === "missed" ? "missed" : "all";
  const base = `/app/${ctx.org.slug}/calls`;
  const availability = await callsAvailability();
  const tabs = [
    { label: CALL_WORDS.history.all, value: "all", href: base },
    { label: CALL_WORDS.history.missed, value: "missed", href: `${base}?filter=missed` },
  ];
  let history: CallHistoryList = { ready: false, items: [], nextBefore: null };
  let live: LiveCallSummary[] = [];
  if (availability.ready) {
    [history, live] = await Promise.all([
      callHistory(ctx, { filter }),
      availability.available ? liveCalls(ctx).catch(() => []) : Promise.resolve([]),
    ]);
  }
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title={CALL_WORDS.history.title} tabs={tabs} tabValue={filter} tabsLabel="Which calls" />
      {!availability.ready || !history.ready ? (
        <EmptyState icon={PhoneOff} tone="neutral" title={CALL_WORDS.notReady} className="py-16" />
      ) : (
        <>
          {!availability.configured ? <Alert tone="warning" className="mb-6">{CALL_WORDS.notConfigured}</Alert> : null}
          {filter === "all" ? <HappeningNow orgSlug={ctx.org.slug} initial={live} me={ctx.membership.id} available={availability.available} timeZone={ctx.org.timezone} /> : null}
          <CallsList orgSlug={ctx.org.slug} initial={history} filter={filter} me={ctx.membership.id} available={availability.available} timeZone={ctx.org.timezone} />
        </>
      )}
      <PageNotes>
        <PageNote>Calls are never recorded. Only the people on a call can read its notes, and transcripts are deleted 7 days after the recap.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
