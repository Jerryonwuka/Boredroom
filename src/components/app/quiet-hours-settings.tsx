"use client";

/**
 * Settings → Your assistant → Quiet hours (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed";
 * contract J.3). The person's own times when their assistant doesn't interrupt them (none by default), and their own
 * time zone, which quiet hours and their routines' times are in.
 *
 * One form card: the switch "Quiet hours"; while on, "From" and "To" (24-hour times; a "To" earlier than "From" reads
 * "Ends the next morning") and "On", the days a quiet window starts on (all seven to start with; Monday first, at least
 * one); "Your time zone" ("Workspace time zone (Africa/Lagos)" first, then every zone this browser knows); then
 * "During quiet hours:" as a list of what it means (no pop-ups or sounds from the desktop app, no replies read aloud on
 * their own, routines wait and arrive together, notifications still collect in the bell). While quiet hours are on now,
 * a line says until when ("Quiet until 07:00."). Saved with Save in the footer (PUT /brenda/quiet-hours); the server's
 * words show at the top of the card and on the field. A save refreshes the page, so her chat and the notch follow at
 * once, and tells the Routines card when the time zone moved (their next times move with it).
 *
 * Comes with the page (services/routines `quietHoursFor`, the shape GET /brenda/quiet-hours answers), or is read from
 * that route when the page could not bring it. Before migration 0046: disabled under "This needs a database
 * update first." While someone else is signed in as the person: disabled with "Only the person can change this." No
 * orange of its own (the switch is white; the chosen days are checked boxes in the segmented strip, as Working days).
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/states";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsRow, SettingsSection } from "@/components/app/settings-forms";
import { ROUTINES_CHANGED_EVENT, announceZone } from "@/components/app/routines-settings";
import { routineTime } from "@/components/app/routine-history";
import { api, isApiFailure } from "@/lib/api-client";
import { DAY_NAMES, DAY_SHORT, ROUTINE_WORDS, TIME_PATTERN, WEEK_ORDER, type QuietHours, type QuietState } from "@/lib/routines";

const Q = ROUTINE_WORDS.quiet;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** What GET and PUT /brenda/quiet-hours answer (before 0046 `ready: false` and none): services/routines `QuietHoursView`. */
export type QuietAnswer = QuietHours & { state: QuietState; ready: boolean };
type Draft = { enabled: boolean; start: string; end: string; days: number[]; zone: string /* "" = the workspace's */ };
type Errors = Partial<Record<"form" | "start" | "end" | "days" | "zone", string>>;

const draftOf = (q: QuietAnswer): Draft => ({
  enabled: q.enabled, start: (q.start ?? "22:00").slice(0, 5), end: (q.end ?? "07:00").slice(0, 5),
  days: q.days.length ? q.days : ALL_DAYS, zone: q.ownTimezone ?? "",
});

/** Every zone this browser knows, with the person's own first in line if the browser does not list it ("UTC"). */
function zoneList(own: string | null, orgZone: string): string[] {
  let zones: string[] = [];
  try { zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []; } catch { zones = []; }
  const extra = [own, orgZone].filter((z): z is string => !!z && !zones.includes(z));
  return [...extra, ...zones];
}

export function QuietHoursSettings({ orgSlug, name, impersonated, orgTimeZone, initial }: {
  orgSlug: string; /** The person's own assistant ("Max"). */ name: string; impersonated: boolean; orgTimeZone: string;
  /** As the page read it; null when it could not, and the card reads it itself. */ initial?: QuietAnswer | null;
}) {
  const router = useRouter();
  const id = useId();
  const [saved, setSaved] = useState<QuietAnswer | null>(initial ?? null);
  const [draft, setDraft] = useState<Draft | null>(initial ? draftOf(initial) : null);
  // A refreshed page brings them again: they take over, unless the person is part way through a change here.
  const [seen, setSeen] = useState(initial);
  const dirty = !!saved && !!draft && JSON.stringify(draftOf(saved)) !== JSON.stringify(draft);
  if (initial && initial !== seen) { setSeen(initial); setSaved(initial); if (!dirty) setDraft(draftOf(initial)); }
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const brought = !!initial;
  // Tell the Routines card which zone the person's times are in (and read them here when the page could not).
  useEffect(() => { if (initial?.timezone) announceZone(initial.timezone); }, [initial?.timezone]);
  useEffect(() => {
    if (brought) return;
    let alive = true;
    api<QuietAnswer>(`/api/orgs/${orgSlug}/brenda/quiet-hours`).then(
      (q) => { if (!alive) return; setSaved(q); setDraft(draftOf(q)); if (q.timezone) announceZone(q.timezone); },
      (err) => { if (alive) setLoadError(isApiFailure(err) && err.error.status < 500 ? err.error.message : OFFLINE); },
    );
    return () => { alive = false; };
  }, [orgSlug, brought]);

  const zones = useMemo(() => zoneList(saved?.ownTimezone ?? null, orgTimeZone), [saved?.ownTimezone, orgTimeZone]);
  const ready = saved ? saved.ready : true;
  const locked = impersonated || !ready || busy;
  const change = (patch: Partial<Draft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDone(null); };

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft || locked) return;
    const found: Errors = {};
    if (draft.enabled) {
      if (!TIME_PATTERN.test(draft.start)) found.start = ROUTINE_WORDS.errors.time;
      if (!TIME_PATTERN.test(draft.end)) found.end = ROUTINE_WORDS.errors.time;
      else if (draft.start === draft.end) found.end = Q.sameTimes;
      if (!draft.days.length) found.days = Q.pickDay;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setDone(null);
    try {
      const body = draft.enabled
        ? { enabled: true, start: draft.start, end: draft.end, days: [...draft.days].sort((a, b) => a - b), timezone: draft.zone || null }
        : { enabled: false, timezone: draft.zone || null };
      const q = await api<QuietAnswer>(`/api/orgs/${orgSlug}/brenda/quiet-hours`, { method: "PUT", body });
      const moved = q.timezone !== saved?.timezone;
      setSaved(q); setDraft(draftOf(q)); setDone(Q.saved);
      if (q.timezone) announceZone(q.timezone);
      if (moved) window.dispatchEvent(new Event(ROUTINES_CHANGED_EVENT));
      router.refresh(); // her chat and the drawer read the new quiet state from the page
    } catch (err) {
      const f = isApiFailure(err) ? err.error.fieldErrors ?? {} : {};
      setErrors({ form: isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : OFFLINE, start: f.start?.[0], end: f.end?.[0], days: f.days?.[0], zone: f.timezone?.[0] });
    } finally { setBusy(false); }
  }

  const overnight = !!draft && TIME_PATTERN.test(draft.start) && TIME_PATTERN.test(draft.end) && draft.end < draft.start;
  const active = saved?.state.ready && saved.state.active && saved.state.until ? Q.activeUntil(routineTime(saved.state.until, saved.timezone)) : null;

  return (
    <SettingsSection id="quiet-hours" title={Q.section} description={Q.description(name)}>
      {loadError ? (
        <SettingsGroup><SettingsAlert>{loadError}</SettingsAlert></SettingsGroup>
      ) : !draft || !saved ? (
        <SettingsGroup aria-busy role="status" aria-label="Getting your quiet hours">
          <div className="space-y-2 px-5 py-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-3.5 w-56 max-w-full" /></div>
          <div className="space-y-2 px-5 py-4"><Skeleton className="h-4 w-28" /><Skeleton className="h-9 w-full max-w-64" /></div>
        </SettingsGroup>
      ) : (
        <form noValidate onSubmit={(e) => void save(e)} className="card-panel divide-y divide-border p-0">
          {!ready ? <SettingsAlert tone="info">{Q.notReady}</SettingsAlert> : impersonated ? <SettingsAlert tone="info">{Q.impersonated}</SettingsAlert> : null}
          {errors.form ? <SettingsAlert>{errors.form}</SettingsAlert> : null}
          {active ? <p role="status" className="px-5 py-3 text-sm font-medium text-foreground">{active}</p> : null}
          <Switch className="px-5 py-4" checked={draft.enabled} disabled={locked} onChange={(e) => change({ enabled: e.target.checked })}>{Q.switch}</Switch>
          {draft.enabled ? (
            <>
              <SettingsRow label={Q.from} htmlFor={`${id}-from`} error={errors.start}>
                <Input id={`${id}-from`} type="time" value={draft.start} disabled={locked} className="sm:max-w-48" onChange={(e) => change({ start: e.target.value })} />
              </SettingsRow>
              <SettingsRow label={Q.to} htmlFor={`${id}-to`} hint={overnight ? Q.overnight : undefined} error={errors.end}>
                <Input id={`${id}-to`} type="time" value={draft.end} disabled={locked} className="sm:max-w-48" onChange={(e) => change({ end: e.target.value })} />
              </SettingsRow>
              <SettingsRow label={Q.on} labelId={`${id}-days`} hint="The days it starts on." error={errors.days}>
                <div role="group" aria-labelledby={`${id}-days`} aria-describedby={errors.days ? `${id}-days-error` : `${id}-days-hint`} className="segmented flex-wrap">
                  {WEEK_ORDER.map((d) => (
                    <label key={d} className="segmented-item">
                      <input type="checkbox" checked={draft.days.includes(d)} disabled={locked} aria-label={DAY_NAMES[d]}
                        onChange={(e) => change({ days: e.target.checked ? [...draft.days.filter((x) => x !== d), d] : draft.days.filter((x) => x !== d) })} />
                      <span aria-hidden>{DAY_SHORT[d]}</span>
                    </label>
                  ))}
                </div>
              </SettingsRow>
            </>
          ) : null}
          <SettingsRow label={Q.timezone} htmlFor="quiet-hours-timezone" hint="Your quiet hours and your routines' times are in it." error={errors.zone}>
            <Select id="quiet-hours-timezone" value={draft.zone} disabled={locked} className="sm:max-w-80" onChange={(e) => change({ zone: e.target.value })}>
              <option value="">{Q.workspaceTimezone(orgTimeZone)}</option>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </Select>
          </SettingsRow>
          <div className="px-5 py-4">
            <p id={`${id}-during`} className="text-sm font-medium text-foreground">{Q.duringLead}</p>
            <ul aria-labelledby={`${id}-during`} className="mt-1.5 list-disc space-y-1 pl-5 text-meta font-normal text-secondary marker:text-subtle">
              {Q.during(name).map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
          <SettingsFooter status={done} busy={busy ? "Saving…" : undefined}>
            <Button type="submit" size="md" loading={busy} disabled={impersonated || !ready}>{busy ? "Saving…" : Q.save}</Button>
          </SettingsFooter>
        </form>
      )}
    </SettingsSection>
  );
}
