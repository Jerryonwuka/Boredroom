"use client";

/**
 * "From your apps" on My Day and the Dashboard (owner decisions, 22 October 2026: connectors; spec §11.4): the person's
 * own calendar today and the issues assigned to them, never anyone else's. The event happening now carries "Now" (the
 * accent rule's current item). Items: the key, the title, the app and its state as separate meta spans, the due date,
 * Track (or "Tracking: {to-do}" with Start), "Open in {App}" (https on the app's own hosts only), and a menu with "Hide
 * from My Day". Owners and HR see only their own and no Track or timer. Nothing here counts towards anything (D4).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { Badge, MonoChip } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/rows";
import { withAnimatedIcons } from "@/components/ui/animated-icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import { LiveIndicator } from "@/components/ui/status-dot";
import { SectionTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { PROVIDER_CATEGORY, PROVIDER_LABELS, type ConnectedDayView, type DayItem } from "@/lib/connectors/types";
import { ProviderIcon } from "./provider-icon";
import { TrackSheet } from "./track-sheet";

const D = CONNECTOR_WORDS.day;
const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dueWords = (i: DayItem, tz: string) => i.dueOn ? new Date(`${i.dueOn}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
  : i.dueAt ? new Date(i.dueAt).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;

export function ConnectedDaySection({ orgSlug, view, timeZone, todos = [], lead = null }: { orgSlug: string; view: ConnectedDayView; timeZone: string; todos?: { id: string; title: string }[]; lead?: string | null }) {
  const router = useRouter();
  const [showHidden, setShowHidden] = useState(false);
  const [tracking, setTracking] = useState<DayItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!view.ready || !view.enabled) return null;
  const settingsHref = `/app/${orgSlug}/settings?section=assistant#connections`;
  const items = view.items.filter((i) => showHidden || !i.hidden);
  const hidden = view.items.filter((i) => i.hidden).length;
  const allDay = view.events.filter((e) => e.allDay);
  const timed = view.events.filter((e) => !e.allDay);
  async function hide(i: DayItem, on: boolean) {
    setBusy(i.id);
    try { await api(`/api/orgs/${orgSlug}/connectors/items/${i.id}/hide`, { method: on ? "POST" : "DELETE" }); router.refresh(); } catch { /* the row stays as it was */ }
    finally { setBusy(null); }
  }
  async function start(taskId: string) {
    setBusy(taskId);
    try { await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId } }); router.refresh(); } catch { /* the timer page explains */ }
    finally { setBusy(null); }
  }
  return (
    <section aria-labelledby="from-your-apps" className="space-y-4">
      <SectionTitle id="from-your-apps" title={D.heading} />
      {view.attention.map((a) => (
        <p key={`${a.provider}`} className="flex flex-wrap items-center gap-2 text-sm font-normal text-secondary">
          {D.needsReconnect(PROVIDER_LABELS[a.provider])}
          <Link href={settingsHref} className="link-inline">{D.reconnect}</Link>
        </p>
      ))}
      {/* Fix, 22 October 2026: only what feeds this person's day counts as connected (their calendar or work apps, or the
          workspace's work apps with chosen sources); a workspace's Slack or Teams alone keeps the empty state. */}
      {!view.connected ? (
        <EmptyState compact title={D.emptyTitle} description={D.emptyBody} action={<Link href={settingsHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{D.connectApps}</Link>} />
      ) : (
        // min-w-0 on the columns (integration fix, 22 October 2026): long titles truncate at phone width instead of
        // widening the page.
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {view.hasCalendar === false ? (
            <div className="min-w-0">
              <p className="text-meta font-medium text-secondary">{D.calendar}</p>
              <p className="mt-2 text-sm font-normal text-secondary">{D.noCalendar} <Link href={settingsHref} className="link-inline">{D.connectCalendar}</Link></p>
            </div>
          ) : (
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-meta font-medium text-secondary">{D.calendar}<span className="tabular-nums text-subtle">{view.events.length}</span></p>
            {allDay.length ? <div className="mt-2 flex flex-wrap gap-1.5">{allDay.map((e) => <Badge key={e.id}>{`${D.allDay}: ${e.title}`}</Badge>)}</div> : null}
            {timed.length ? (
              <ul className="mt-1">
                {timed.map((e) => (
                  <ListRow key={e.id} leading={<ProviderIcon category="calendar" size={40} />} title={e.title}
                    meta={<><span className="tabular-nums">{hm(e.startsAt, timeZone)}–{hm(e.endsAt, timeZone)}</span><span className="ml-3">{PROVIDER_LABELS[e.provider]}</span>{e.online ? <span className="ml-3">{D.online}</span> : null}</>}
                    trailing={e.now ? <LiveIndicator>{D.now}</LiveIndicator> : null} />
                ))}
              </ul>
            ) : <p className="mt-2 text-sm font-normal text-secondary">{D.noEvents}</p>}
          </div>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-meta font-medium text-secondary">{D.assigned}<span className="tabular-nums text-subtle">{view.items.length - hidden}</span></p>
            {items.length ? (
              <ul className="mt-1">
                {items.map((i) => {
                  const due = dueWords(i, timeZone);
                  const actions = (
                    <>
                      {view.canTrack ? (i.linkedTask
                        ? <Button size="xs" variant="secondary" loading={busy === i.linkedTask.id} onClick={() => start(i.linkedTask!.id)}>{D.start}</Button>
                        : <Button size="xs" variant="secondary" onClick={() => setTracking(i)}>{D.track}</Button>) : null}
                      {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "xs" })} aria-label={D.open(PROVIDER_LABELS[i.provider])}>{withAnimatedIcons(<ExternalLink aria-hidden />)}</a> : null}
                      <Menu label={`${i.externalKey ?? i.title}`} align="end" trigger={<IconButton aria-label="More"><MoreHorizontal aria-hidden /></IconButton>}>
                        <MenuItem disabled={busy === i.id} onSelect={() => hide(i, !i.hidden)}>{i.hidden ? D.show : D.hide}</MenuItem>
                      </Menu>
                    </>
                  );
                  // Fix, 22 October 2026: at phone width the title gets the whole row (up to two lines), the meta wraps
                  // instead of clipping (the due date and "Tracking:" stay visible), and the actions go to their own
                  // line underneath; from sm up they sit at the end of the row as before.
                  return (
                    <li key={i.id} className="flex min-h-16 w-full list-none items-start gap-3 rounded-xl px-2 py-3 sm:items-center">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl"><ProviderIcon category={PROVIDER_CATEGORY[i.provider]} size={40} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-start gap-2 text-sm font-semibold text-foreground sm:items-center">
                          {i.externalKey ? <MonoChip className="shrink-0">{i.externalKey}</MonoChip> : null}
                          <span className="line-clamp-2 min-w-0 break-words sm:line-clamp-none sm:truncate">{i.title}</span>
                        </p>
                        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-meta font-normal text-secondary">
                          <span>{PROVIDER_LABELS[i.provider]}</span>
                          {i.stateLabel ? <span>{i.stateLabel}</span> : null}
                          {due ? <span className="tabular-nums">Due {due}</span> : null}
                          {i.linkedTask ? <span className="min-w-0 break-words">{D.tracking(i.linkedTask.title)}</span> : null}
                        </div>
                        <div className="mt-2 flex items-center gap-2 sm:hidden">{actions}</div>
                      </div>
                      <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-sm font-normal text-secondary">{D.noItems}</p>}
            {hidden ? <Button variant="ghost" size="sm" className="mt-1" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>{D.hidden(hidden)}</Button> : null}
          </div>
        </div>
      )}
      <TrackSheet orgSlug={orgSlug} item={tracking} open={!!tracking} onClose={() => setTracking(null)} todos={todos} lead={lead} />
    </section>
  );
}
