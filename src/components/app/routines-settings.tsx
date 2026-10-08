"use client";

/**
 * Settings → Your assistant → Routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed";
 * contract J.1). Everyone can have their own assistant do a few fixed things on a schedule: a morning brief, what's still
 * owed, an afternoon check that speaks only when something needs them, and (for those who may) chasing stalled tasks on
 * their team. This card lists the person's routines and opens each in its sheet (routine-editor: set up, preview and
 * Enable, history).
 *
 * - The list: one row per routine (a list): its name, its status badge with a word (On, success; Paused, neutral; Needs
 *   you, warning, when it was paused for a reason the person must look at; never orange), then in grey when it runs and
 *   when next ("Every Friday at 16:00, next Fri 9 Oct, 16:00"), and why it is paused when the badge does not say it
 *   ("Paused until you enable it"; nothing more for one the person paused), or that a chase lost its lead rights. Rows
 *   wrap rather than truncate, so the times stay readable at 400px. Each row's menu ("Actions for {name}"): Preview, Edit,
 *   Enable or Pause, History and Delete ("Delete “{name}”? What it sent stays on your Routines page.", a centred
 *   confirm: a deleted routine leaves this list, its runs stay on /home/routines). Pause is at once;
 *   Enable always goes through the preview, so the person sees what they agree to.
 * - "Add a routine" (secondary) in the section's header; at 20 routines it stays but says why it does nothing.
 * - Empty: "No routines yet" with "Add a routine". Before migration 0046: the card is disabled under "This needs a
 *   database update first." While someone else is signed in as the person: read-only, "Only the person can change this."
 *
 * The list comes with the page (services/routines `listRoutines`, the shape GET /brenda/routines answers), or is read
 * from that route when the page could not bring it; it follows every change made here from the answers, a refreshed
 * page brings it again (a time zone changed in Quiet hours moves the next times), and Quiet hours' change of zone
 * reads it again too. No orange of its own: the sheet's Enable is the one standout.
 */
import { useCallback, useEffect, useState } from "react";
import { Ellipsis, Eye, History, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { notify, successToast } from "@/components/ui/toast";
import { SettingsAlert, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { RoutineSheet, type RoutineSheetMode, type RoutineStep } from "@/components/app/routine-editor";
import { routineWhen } from "@/components/app/routine-history";
import { api, isApiFailure } from "@/lib/api-client";
import { ROUTINE_LIMITS, ROUTINE_WORDS, isChasing, pausedWords, routineBadge, type PausedReason, type RoutineList, type RoutineView } from "@/lib/routines";

const S = ROUTINE_WORDS.settings;
const OFFLINE = "Cannot reach the server. Check your connection and try again.";
const told = (err: unknown) => (isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : OFFLINE);

/** Said on the page when the person's time zone or anything else that moves a routine's next run changes (quiet-hours-settings). */
export const ROUTINES_CHANGED_EVENT = "boredroom:routines-changed";
/** Said with the person's effective time zone once Quiet hours has read it, and when it changes. */
export const ASSISTANT_ZONE_EVENT = "boredroom:assistant-timezone";
/** The latest zone said on this page (a card that mounts later starts from it). */
let knownZone: string | null = null;
export function announceZone(zone: string) {
  knownZone = zone;
  window.dispatchEvent(new CustomEvent<string>(ASSISTANT_ZONE_EVENT, { detail: zone }));
}

export function RoutinesSettings({ orgSlug, name, impersonated, timeZone, initial }: {
  orgSlug: string; /** The person's own assistant ("Max"). */ name: string; impersonated: boolean;
  /** The person's own time zone (the organisation's until they choose one in Quiet hours). */ timeZone: string;
  /** The list as the page read it; null when it could not, and the card reads it itself. */ initial?: RoutineList | null;
}) {
  const [list, setList] = useState<RoutineList | null>(initial ?? null);
  // A refreshed page brings the list again: it takes over.
  const [seen, setSeen] = useState(initial);
  if (initial && initial !== seen) { setSeen(initial); setList(initial); }
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<RoutineSheetMode | null>(null);
  const [opened, setOpened] = useState(0);
  const [pausing, setPausing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RoutineView | null>(null);
  const [zone, setZone] = useState<string | null>(knownZone);

  const load = useCallback(() => api<RoutineList>(`/api/orgs/${orgSlug}/brenda/routines`).then(
    (l) => { setList(l); setLoadError(null); },
    (err: unknown) => setLoadError(told(err)),
  ), [orgSlug]);
  const brought = !!initial;
  useEffect(() => {
    if (!brought) void load();
    const reread = () => void load();
    const onZone = (e: Event) => setZone((e as CustomEvent<string>).detail);
    window.addEventListener(ROUTINES_CHANGED_EVENT, reread);
    window.addEventListener(ASSISTANT_ZONE_EVENT, onZone);
    return () => { window.removeEventListener(ROUTINES_CHANGED_EVENT, reread); window.removeEventListener(ASSISTANT_ZONE_EVENT, onZone); };
  }, [load, brought]);

  const ready = list?.ready ?? true;
  const readOnly = impersonated || !ready;
  const routines = list?.routines ?? [];
  const limit = list?.limits.perPerson ?? ROUTINE_LIMITS.perPerson;
  const full = routines.length >= limit;
  const personZone = zone ?? timeZone;

  /** A saved state of one routine: it takes its row's place (a new one goes last, as the list reads, oldest first). */
  const upsert = (v: RoutineView) => setList((cur) => (cur ? { ...cur, routines: cur.routines.some((r) => r.id === v.id) ? cur.routines.map((r) => (r.id === v.id ? v : r)) : [...cur.routines, v] } : cur));
  const open = (step: RoutineStep, routine: RoutineView | null) => { setOpened((n) => n + 1); setSheet(routine ? { step, routine } : { step: "setup", routine: null }); };
  const add = () => { if (!readOnly && !full) open("setup", null); };

  async function pause(r: RoutineView) {
    if (pausing) return;
    setPausing(r.id);
    try {
      const v = await api<RoutineView>(`/api/orgs/${orgSlug}/brenda/routines/${r.id}/pause`, { method: "POST" });
      upsert(v);
      successToast(S.paused(v.name));
    } catch (err) { notify(told(err), { tone: "danger" }); }
    finally { setPausing(null); }
  }

  async function remove(r: RoutineView) {
    await api(`/api/orgs/${orgSlug}/brenda/routines/${r.id}`, { method: "DELETE" }); // a failure stays in the dialog, with why
    setList((cur) => (cur ? { ...cur, routines: cur.routines.filter((x) => x.id !== r.id) } : cur));
    successToast(S.deleted(r.name));
  }

  /** Quiet hours holds the time zone: the sheet closes and the focus goes to it. */
  const toTimeZone = () => {
    setSheet(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const select = document.getElementById("quiet-hours-timezone");
      document.getElementById("quiet-hours")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      select?.focus({ preventScroll: true });
    }));
  };

  // While the list is on its way (or failed), the add button waits.
  const addButton = (
    <Button size="sm" variant="secondary" onClick={add} disabled={!list || readOnly}
      aria-disabled={full || undefined} data-tip={full ? S.limitTip : undefined} className={full ? "opacity-50" : undefined}>
      {S.add}
    </Button>
  );

  return (
    <SettingsSection id="routines" title={S.section} description={S.description(name)} action={addButton}>
      <SettingsGroup aria-busy={!list && !loadError}>
        {loadError ? (
          <SettingsAlert>
            <span className="flex flex-wrap items-center justify-between gap-2">{loadError}<Button size="xs" variant="secondary" onClick={() => { setLoadError(null); void load(); }}>Try again</Button></span>
          </SettingsAlert>
        ) : !list ? (
          <div className="space-y-1 p-2" role="status" aria-label="Getting your routines">
            {[0, 1].map((i) => <div key={i} className="space-y-1.5 px-2 py-3"><Skeleton className="h-4 w-44" /><Skeleton className="h-3.5 w-64 max-w-full" /></div>)}
          </div>
        ) : (
          <>
            {!ready ? <SettingsAlert tone="info">{S.notReady}</SettingsAlert> : impersonated ? <SettingsAlert tone="info">{S.impersonated}</SettingsAlert> : null}
            {ready && !routines.length ? (
              <EmptyState compact title={S.emptyTitle} description={S.emptyBody}
                action={readOnly ? undefined : <Button size="sm" variant="secondary" onClick={add}>{S.add}</Button>} />
            ) : routines.length ? (
              <ul className="space-y-0.5 p-2">
                {routines.map((r) => (
                  <RoutineRow key={r.id} routine={r} readOnly={readOnly} pausing={pausing === r.id} chaseAllowed={list.chase.allowed}
                    onOpen={(step) => open(step, r)} onPause={() => void pause(r)} onDelete={() => setDeleting(r)} />
                ))}
              </ul>
            ) : null}
            {/* The workspace's rule for routines that chase other people, read by everyone (J.6). */}
            {ready ? <p className="px-4 pb-3 pt-1 text-meta font-normal text-secondary">{list.chase.leadsOnly ? ROUTINE_WORDS.workspace.ruleLeadsOnly : ROUTINE_WORDS.workspace.ruleAnyone}</p> : null}
          </>
        )}
      </SettingsGroup>

      {sheet && list ? (
        <RoutineSheet key={opened} orgSlug={orgSlug} mode={sheet} onClose={() => setSheet(null)} chase={list.chase} assistantName={name}
          timeZone={sheet.routine?.timezone ?? personZone} readOnly={readOnly} onTimeZone={toTimeZone}
          onChange={(v) => upsert(v)} />
      ) : null}

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title={deleting ? S.deleteConfirm(deleting.name) : ""}
        confirmLabel={S.menu.delete} pendingLabel="Deleting…" onConfirm={() => (deleting ? remove(deleting) : undefined)} />
    </SettingsSection>
  );
}

/** Paused for a reason the badge alone does not say ("Paused" by the person says nothing more: review, 8 October 2026). */
const REASON_LINE: readonly PausedReason[] = ["new", "consent_changed", "no_rights", "failing"];

/**
 * One routine: its name and status badge, when it runs (and next) or why it is paused, and its menu. Wraps at 400px
 * (ListRow's 64px look, with lines that wrap instead of truncating).
 */
function RoutineRow({ routine: r, readOnly, pausing, chaseAllowed, onOpen, onPause, onDelete }: {
  routine: RoutineView; readOnly: boolean; pausing: boolean; /** Whether the person may chase other people now. */ chaseAllowed: boolean;
  onOpen: (step: RoutineStep) => void; onPause: () => void; onDelete: () => void;
}) {
  // A chase its owner can no longer turn on (review, 8 October 2026): it needs them, and the row says what to do.
  const lostRights = isChasing(r.template) && !chaseAllowed;
  const badge = lostRights && !r.enabled ? { label: ROUTINE_WORDS.status.needsYou, tone: "warning" as const } : routineBadge(r);
  const why = lostRights ? (r.enabled ? S.lostRightsOn : S.lostRights) : r.enabled || !REASON_LINE.includes(r.pausedReason ?? "person") ? null : pausedWords(r.pausedReason);
  const next = r.enabled && r.nextRunAt ? S.next(r.scheduleWords, routineWhen(r.nextRunAt, r.timezone)) : r.scheduleWords;
  const actions = S.actionsFor(r.name);
  return (
    <li className="flex min-h-16 items-start gap-3 rounded-xl px-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-medium text-foreground">{r.name}</span>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </p>
        <p className="mt-0.5 text-meta font-normal text-secondary">{next}</p>
        {why ? <p className="text-meta font-normal text-secondary">{why}</p> : null}
      </div>
      <Menu align="end" label={actions} trigger={<IconButton aria-label={actions} aria-busy={pausing || undefined} disabled={pausing} className="-my-1"><Ellipsis aria-hidden /></IconButton>}>
        <MenuItem icon={<Eye aria-hidden />} onSelect={() => onOpen("preview")}>{S.menu.preview}</MenuItem>
        <MenuItem icon={<Pencil aria-hidden />} disabled={readOnly} onSelect={() => onOpen("setup")}>{S.menu.edit}</MenuItem>
        {r.enabled
          ? <MenuItem icon={<Pause aria-hidden />} disabled={readOnly} onSelect={onPause}>{S.menu.pause}</MenuItem>
          : <MenuItem icon={<Play aria-hidden />} disabled={readOnly} onSelect={() => onOpen("preview")}>{S.menu.enable}</MenuItem>}
        <MenuItem icon={<History aria-hidden />} onSelect={() => onOpen("history")}>{S.menu.history}</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 aria-hidden />} tone="danger" disabled={readOnly} onSelect={onDelete}>{S.menu.delete}</MenuItem>
      </Menu>
    </li>
  );
}
