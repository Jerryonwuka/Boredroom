"use client";

/**
 * A team's async standup, on the team page's Standup tab (owner decisions, 8–9 October 2026: phase 7c, async standup
 * option B; contract B.1 and G.1). Off for every team until its lead, the owner or HR switches it on here. When on, at
 * the time below on the organisation's clock (09:30 by default, Monday to Friday), each member's own assistant drafts
 * their update from their own work, and nothing is posted until they press Post; at the rollup time (12:00 by default,
 * at least 30 minutes later) the team's lead gets one rollup: who posted, the blockers they named and who has no update.
 *
 * One card, "Async standup":
 * - "Run a daily standup for {Team}" (`Switch`, saved the moment it moves; white when on, no orange of its own).
 * - "Drafts arrive at" and "Rollup at" (time inputs) and the days (a fieldset of seven checkboxes, the week starting on
 *   Monday), saved together with "Save times" (a toast says it went; the server's words sit on their fields).
 * - A note: the organisation's time zone, and that Boredroom knows no holidays (untick a day, or people skip it).
 * - Leads, the owner and HR edit; everyone else reads one line ("On: weekdays at 09:30, rollup at 12:00" or "Off").
 * - A team with no lead says so (warning): nobody receives the rollup. While the workspace does not offer standups
 *   (Settings → Brenda → Abilities) the controls are disabled under the reason; before migration 0050 under
 *   "Standups need a database update first."
 *
 * It reads its settings from GET /teams/{id}/standup (the page does not bring them) and saves with PATCH; switching it
 * off cancels today's drafts that were not posted, on the server.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsRow, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { DAY_NAMES, DAY_SHORT, TIME_PATTERN, WEEK_ORDER } from "@/lib/routines";
import { STANDUP_LIMITS, STANDUP_NOT_READY_SHORT, STANDUP_WORDS, standupDaysWords, type StandupSettingsView } from "@/lib/standup";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const FAILED = "Something went wrong. Nothing was changed; try again.";
/** The server's words for a refusal; a server error is not "cannot reach" (fix review, 9 October 2026). */
const told = (err: unknown) => (!isApiFailure(err) ? OFFLINE : err.error.status < 500 || err.error.code === "NOT_READY" ? err.error.message : FAILED);

const SET = STANDUP_WORDS.settings;
/** The card's words: lib/standup's (contract G.1), and the few only this card says. */
const S = {
  title: SET.title,
  description: "A daily update from everyone, drafted by their own assistant and posted only when they press Post.",
  switch: SET.switch,
  switchHint: SET.switchHint,
  time: SET.draftsAt,
  cutoff: SET.rollupAt,
  cutoffHint: SET.rollupHint,
  days: SET.days,
  note: SET.footnote,
  noLead: SET.noLead,
  save: "Save times",
  saved: "Standup times saved",
  on: "Standup is on",
  off: "Standup is off",
  gap: STANDUP_WORDS.errors.gap,
  pickDay: STANDUP_WORDS.errors.days,
  badTime: STANDUP_WORDS.errors.time,
} as const;

/** "On: weekdays at 09:30, rollup at 12:00", or "Off" (lib/standup's words). */
export function standupSummary(v: Pick<StandupSettingsView, "enabled" | "time" | "cutoff" | "days">): string {
  return v.enabled ? SET.readOn(standupDaysWords(v.days), v.time, v.cutoff) : SET.readOff;
}

const minutes = (t: string) => (TIME_PATTERN.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : NaN);

type Errors = Partial<Record<"time" | "cutoff" | "days" | "form", string>>;

export function StandupSettings({ orgSlug, teamId, teamName, initial = null }: {
  orgSlug: string; teamId: string; teamName: string;
  /** The settings when the page read them; null: the card reads them itself. */ initial?: StandupSettingsView | null;
}) {
  const id = useId();
  const [view, setView] = useState<StandupSettingsView | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [time, setTime] = useState(initial?.time ?? "09:30");
  const [cutoff, setCutoff] = useState(initial?.cutoff ?? "12:00");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<"switch" | "times" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const url = `/api/orgs/${orgSlug}/teams/${teamId}/standup`;

  /** Takes the server's settings as they are now, fields and all. */
  const take = useCallback((v: StandupSettingsView) => {
    setView(v); setTime(v.time); setCutoff(v.cutoff); setDays(v.days);
  }, []);
  const load = useCallback(() => api<StandupSettingsView>(url).then((v) => { take(v); setLoadError(null); }, (err: unknown) => setLoadError(told(err))), [url, take]);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);

  if (loadError) {
    return (
      <SettingsSection id="standup" title={S.title} description={S.description}>
        <SettingsGroup>
          <SettingsAlert>
            <span className="flex flex-wrap items-center justify-between gap-2">{loadError}<Button size="xs" variant="secondary" onClick={() => { setLoadError(null); void load(); }}>Try again</Button></span>
          </SettingsAlert>
        </SettingsGroup>
      </SettingsSection>
    );
  }
  if (!view) {
    return (
      <SettingsSection id="standup" title={S.title} description={S.description}>
        <SettingsGroup aria-busy>
          <div className="space-y-2 px-5 py-4" role="status" aria-label="Getting the standup settings">
            <Skeleton className="h-4 w-56" /><Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
        </SettingsGroup>
      </SettingsSection>
    );
  }

  const { ready, canEdit, offered } = view;
  const name = view.teamName || teamName;
  // Not offered by the workspace: switching on is refused (409); switching off and the times stay allowed.
  const locked = !ready || !canEdit;
  const dirty = time !== view.time || cutoff !== view.cutoff || days.length !== view.days.length || days.some((d) => !view.days.includes(d));

  async function patch(body: Record<string, unknown>, kind: "switch" | "times") {
    setSaving(kind); setStatus(null);
    try {
      const v = await api<StandupSettingsView>(url, { method: "PATCH", body, retries: 1 });
      take(v); setErrors({});
      const words = kind === "times" ? S.saved : v.enabled ? S.on : S.off;
      setStatus(words); successToast(words);
    } catch (err) {
      const f = isApiFailure(err) ? err.error.fieldErrors ?? {} : {};
      setErrors({ form: told(err), time: f.time?.[0], cutoff: f.cutoff?.[0], days: f.days?.[0] });
    } finally { setSaving(null); }
  }

  const saveTimes = () => {
    const found: Errors = {};
    if (!TIME_PATTERN.test(time)) found.time = S.badTime;
    if (!TIME_PATTERN.test(cutoff)) found.cutoff = S.badTime;
    else if (TIME_PATTERN.test(time) && minutes(cutoff) - minutes(time) < STANDUP_LIMITS.minGapMinutes) found.cutoff = S.gap;
    if (!days.length) found.days = S.pickDay;
    setErrors(found);
    if (Object.keys(found).length) return;
    void patch({ time, cutoff, days: [...days].sort((a, b) => a - b) }, "times");
  };

  return (
    <SettingsSection id="standup" title={S.title} description={S.description}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{STANDUP_NOT_READY_SHORT}</SettingsAlert>
          : !offered ? <SettingsAlert tone="info">{STANDUP_WORDS.errors.notOffered}</SettingsAlert> : null}
        {ready && view.noLead ? <SettingsAlert tone="warning">{S.noLead}</SettingsAlert> : null}
        {errors.form ? <SettingsAlert>{errors.form}</SettingsAlert> : null}

        {canEdit ? (
          <>
            <Switch className="px-5 py-4" checked={ready && view.enabled} disabled={locked || saving !== null || (!offered && !view.enabled)}
              onChange={(e) => void patch({ enabled: e.target.checked }, "switch")} hint={S.switchHint}>
              {S.switch(name)}
            </Switch>
            <form noValidate onSubmit={(e) => { e.preventDefault(); if (!locked) saveTimes(); }} className="divide-y divide-border">
              <SettingsRow label={S.time} htmlFor={`${id}-time`} error={errors.time}>
                <Input id={`${id}-time`} type="time" step={300} value={time} disabled={locked} className="sm:max-w-40" onChange={(e) => setTime(e.target.value)} />
              </SettingsRow>
              <SettingsRow label={S.cutoff} htmlFor={`${id}-cutoff`} hint={S.cutoffHint} error={errors.cutoff}>
                <Input id={`${id}-cutoff`} type="time" step={300} value={cutoff} disabled={locked} className="sm:max-w-40" onChange={(e) => setCutoff(e.target.value)} />
              </SettingsRow>
              <div className="px-5 py-4">
                <fieldset disabled={locked} aria-describedby={errors.days ? `${id}-days-error` : undefined}>
                  <legend className="text-sm font-medium text-foreground">{S.days}</legend>
                  <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2.5">
                    {WEEK_ORDER.map((d) => (
                      <Checkbox key={d} checked={days.includes(d)} disabled={locked} aria-label={DAY_NAMES[d]}
                        onChange={(e) => setDays((cur) => (e.target.checked ? [...cur.filter((x) => x !== d), d] : cur.filter((x) => x !== d)))}>
                        <span aria-hidden>{DAY_SHORT[d]}</span>
                      </Checkbox>
                    ))}
                  </div>
                  {errors.days ? <p id={`${id}-days-error`} role="alert" className="mt-1.5 text-meta font-medium text-danger">{errors.days}</p> : null}
                </fieldset>
                <p className="mt-4 text-meta font-normal text-secondary">{S.note(view.timeZone)}</p>
              </div>
              <SettingsFooter status={status ?? undefined} busy={saving ? "Saving…" : undefined}>
                <Button type="submit" size="sm" variant="secondary" disabled={locked || !dirty} loading={saving === "times"}>{S.save}</Button>
              </SettingsFooter>
            </form>
          </>
        ) : (
          <SettingsRow label="Standup" align="text">
            <p>{ready ? standupSummary(view) : SET.readOff}</p>
            <p className="mt-1 text-meta font-normal text-secondary">{SET.footnoteMember(view.timeZone)}</p>
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
