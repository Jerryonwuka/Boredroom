"use client";

/**
 * A routine's sheet (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"; contract J.2): one Sheet
 * from the right, opened from Settings → Your assistant → Routines. Three steps, as pill tabs once the routine exists:
 *
 * - **Set up**: "What it does" (the four built-in templates as a radio list, each with its one line; "Chase stalled
 *   tasks" only for those who may chase other people, otherwise shown disabled with why; fixed once saved), "Name" (the
 *   template's own until the person types one), "How often" (Every day, Weekdays, Weekly, Monthly), the days of a weekly
 *   one (Monday first, at least one), the day of a monthly one (1st to 31st, or the last day; "In shorter months it runs
 *   on the last day."), "Time" (in the person's own time zone, which links to Quiet hours, where it is chosen), the teams
 *   a chase covers (the teams they lead chosen to start with) and "Stay quiet when there's nothing" (not for the
 *   afternoon check, which only ever speaks when something needs them). Save creates it paused, or saves the change, then
 *   opens Preview. Changing the teams of a routine that is on turns it off until it is enabled again, and says so first.
 * - **Preview**: what it would send now (nothing is sent; routine-preview), then "When it's on, Max will:" and its
 *   lines; "Not now" and **Enable** (the sheet's one orange button: the one thing to do). Enable sends the preview's hash,
 *   so it agrees to exactly what was shown; a routine changed meanwhile is refused (409) with the server's words and
 *   previewed again. A routine already on shows Close instead.
 * - **History**: its runs (routine-history).
 *
 * Read-only while someone else is signed in as the person (they may look, not change). Plain sentence-case words from
 * lib/routines (`ROUTINE_WORDS`); every field labelled, errors tied to their fields; it fits a 400px phone.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select } from "@/components/ui/input";
import { Checkbox, Radio, Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { RoutinePreviewPanel, useRoutinePreview } from "@/components/app/routine-preview";
import { RoutineHistory, routineWhen } from "@/components/app/routine-history";
import { api, isApiFailure } from "@/lib/api-client";
import {
  CADENCE_KINDS, DAY_NAMES, DAY_SHORT, ROUTINE_TEMPLATES, ROUTINE_WORDS, TIME_PATTERN, WEEK_ORDER, cadenceWords, isChasing, ordinal,
  type Cadence, type CadenceKind, type RoutineInput, type RoutineList, type RoutinePatch, type RoutineTemplate, type RoutineView,
} from "@/lib/routines";
import { cn } from "@/lib/utils";

const E = ROUTINE_WORDS.editor;
const T = ROUTINE_WORDS.templates;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

export type RoutineStep = "setup" | "preview" | "history";
/** What the sheet opens on: a new routine's set-up, or a saved routine's step. */
export type RoutineSheetMode = { step: "setup"; routine: RoutineView | null } | { step: RoutineStep; routine: RoutineView };

/** When a new routine of each template runs unless the person says otherwise (as the chat's helper phrasings). */
const DEFAULT_SCHEDULE: Record<RoutineTemplate, { kind: CadenceKind; days: number[]; time: string }> = {
  morning_brief: { kind: "weekdays", days: [1], time: "09:00" },
  still_owed: { kind: "weekly", days: [5], time: "16:00" },
  afternoon_check: { kind: "weekdays", days: [1], time: "15:00" },
  chase_stalled: { kind: "weekly", days: [5], time: "16:00" },
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const told = (err: unknown) => (isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : OFFLINE);

/**
 * The sheet. `onChange` hears every saved state of the routine (created, changed, enabled), so the list behind it
 * follows. `timeZone`: the person's own (for the time's hint); `onTimeZone`: closes the sheet and takes the person to
 * the time zone in Quiet hours.
 */
export function RoutineSheet({ orgSlug, mode, onClose, onChange, chase, assistantName, timeZone, readOnly, onTimeZone }: {
  orgSlug: string; mode: RoutineSheetMode; onClose: () => void; onChange: (v: RoutineView, how: "created" | "updated" | "enabled") => void;
  chase: RoutineList["chase"]; assistantName: string; timeZone: string; readOnly: boolean; onTimeZone: () => void;
}) {
  const formId = useId();
  const [routine, setRoutine] = useState<RoutineView | null>(mode.routine);
  const [step, setStep] = useState<RoutineStep>(mode.step);
  // A new preview each time the step opens and after each save.
  const [rev, setRev] = useState(0);
  const preview = useRoutinePreview(orgSlug, step === "preview" && routine ? routine.id : null, rev);
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const go = (s: RoutineStep) => { setEnableError(null); if (s === "preview") setRev((n) => n + 1); setStep(s); };
  const saved = (v: RoutineView, created: boolean) => { setRoutine(v); onChange(v, created ? "created" : "updated"); go("preview"); };

  const enable = async () => {
    if (!routine || preview.state.status !== "ready" || enabling) return;
    setEnabling(true); setEnableError(null);
    try {
      const v = await api<RoutineView>(`/api/orgs/${orgSlug}/brenda/routines/${routine.id}/enable`, { method: "POST", body: { consentHash: preview.state.preview.consent.hash } });
      setRoutine(v);
      onChange(v, "enabled");
      successToast(ROUTINE_WORDS.preview.enabled(v.name, routineWhen(v.nextRunAt, v.timezone) || v.scheduleWords));
      onClose();
    } catch (err) {
      setEnableError(told(err));
      // Changed since its preview (CONSENT_CHANGED): show what it does now, to enable again.
      if (isApiFailure(err) && err.error.status === 409) preview.reload();
    } finally { setEnabling(false); }
  };

  const title = routine ? routine.name : E.titleNew;
  const footer = step === "setup" ? (
    readOnly ? <Button variant="secondary" onClick={onClose}>Close</Button> : <>
      <Button variant="secondary" onClick={onClose}>{E.cancel}</Button>
      <Button type="submit" form={formId} loading={saving}>{saving ? "Saving…" : E.save}</Button>
    </>
  ) : step === "preview" ? (
    readOnly || routine?.enabled ? <Button variant="secondary" onClick={onClose}>Close</Button> : <>
      <Button variant="ghost" onClick={onClose}>{ROUTINE_WORDS.preview.notNow}</Button>
      {/* The sheet's one standout (accent rules): what the preview asks the person to do. */}
      <Button variant="accent" loading={enabling} disabled={preview.state.status !== "ready"} onClick={() => void enable()}>{enabling ? "Enabling…" : ROUTINE_WORDS.preview.enable}</Button>
    </>
  ) : undefined;

  return (
    <Sheet open onClose={onClose} title={title} description={routine ? routine.scheduleWords : undefined} footer={footer} dismissible={!saving && !enabling}>
      {routine ? (
        <Tabs variant="pills" bordered={false} label="Routine" className="mb-5" value={step} onChange={(v) => go(v as RoutineStep)}
          tabs={[{ label: E.setUp, value: "setup" }, { label: ROUTINE_WORDS.preview.heading, value: "preview" }, { label: ROUTINE_WORDS.history.heading, value: "history" }]} />
      ) : null}
      {step === "setup" ? (
        <RoutineSetupForm formId={formId} orgSlug={orgSlug} routine={routine} chase={chase} timeZone={timeZone} readOnly={readOnly}
          onSaving={setSaving} onSaved={saved} onTimeZone={onTimeZone} />
      ) : step === "preview" && routine ? (
        <>
          {routine.enabled && routine.nextRunAt ? <p className="mb-4 text-meta font-normal text-secondary">It&apos;s on. Next: {routineWhen(routine.nextRunAt, routine.timezone)}.</p> : null}
          <RoutinePreviewPanel state={preview.state} orgSlug={orgSlug} assistantName={assistantName} onRetry={preview.reload} error={enableError} enabled={routine.enabled} />
        </>
      ) : routine ? (
        <RoutineHistory orgSlug={orgSlug} routineId={routine.id} timeZone={routine.timezone} />
      ) : null}
    </Sheet>
  );
}

/** The cadence the form's fields make. */
function cadenceOf(kind: CadenceKind, days: number[], dayOfMonth: number): Cadence {
  switch (kind) {
    case "daily": return { kind: "daily" };
    case "weekdays": return { kind: "weekdays" };
    case "weekly": return { kind: "weekly", days: [...days].sort((a, b) => a - b) };
    case "monthly": return { kind: "monthly", day: dayOfMonth };
  }
}

type Errors = Partial<Record<"form" | "name" | "days" | "time" | "teams", string>>;

/**
 * The "Set up" step's form. Validated here first (a day, a 24-hour time, a team for a chase), then by the server, whose
 * words show at the top of the form and on the field they belong to.
 */
function RoutineSetupForm({ formId, orgSlug, routine, chase, timeZone, readOnly, onSaving, onSaved, onTimeZone }: {
  formId: string; orgSlug: string; routine: RoutineView | null; chase: RoutineList["chase"]; timeZone: string; readOnly: boolean;
  onSaving: (busy: boolean) => void; onSaved: (v: RoutineView, created: boolean) => void; onTimeZone: () => void;
}) {
  const id = useId();
  const editing = !!routine;
  const firstTemplate: RoutineTemplate = routine?.template ?? "morning_brief";
  const start = DEFAULT_SCHEDULE[firstTemplate];
  const [template, setTemplate] = useState<RoutineTemplate>(firstTemplate);
  const [name, setName] = useState(routine?.name ?? T[firstTemplate].defaultName);
  const [nameTouched, setNameTouched] = useState(editing);
  const [kind, setKind] = useState<CadenceKind>(routine?.cadence.kind ?? start.kind);
  const [days, setDays] = useState<number[]>(routine?.cadence.kind === "weekly" ? routine.cadence.days : start.days);
  const [dayOfMonth, setDayOfMonth] = useState(routine?.cadence.kind === "monthly" ? routine.cadence.day : 1);
  const [time, setTime] = useState(routine?.time ?? start.time);
  const [scheduleTouched, setScheduleTouched] = useState(editing);
  // The teams a chase covers: its own list, or (null: "the teams I lead") the teams the person leads now.
  const led = chase.teams.filter((t) => t.lead).map((t) => t.id);
  const firstTeams = routine?.params.teamIds ?? (routine ? routine.teams.map((t) => t.id) : led);
  const [teams, setTeams] = useState<string[]>(firstTeams);
  const [quietWhenEmpty, setQuietWhenEmpty] = useState(routine?.quietWhenEmpty ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  // The server's words sit at the top of the form: brought into view when they come (the form may be scrolled down).
  const formError = useRef<HTMLDivElement>(null);
  useEffect(() => { if (errors.form) formError.current?.scrollIntoView({ block: "nearest" }); }, [errors.form]);

  const chasing = isChasing(template);
  const teamsChanged = chasing && !sameSet(teams, firstTeams);
  const cadence = cadenceOf(kind, days, dayOfMonth);
  // A team a routine already covers stays listed even if the person no longer sees it among the teams they may chase.
  const teamChoices = [...chase.teams, ...(routine?.teams ?? []).filter((t) => !chase.teams.some((c) => c.id === t.id)).map((t) => ({ ...t, lead: false }))];

  const pickTemplate = (t: RoutineTemplate) => {
    setTemplate(t);
    if (!nameTouched) setName(T[t].defaultName);
    if (!scheduleTouched) { const d = DEFAULT_SCHEDULE[t]; setKind(d.kind); setDays(d.days); setTime(d.time); }
    setErrors({});
  };
  const touchSchedule = () => setScheduleTouched(true);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly || busy) return;
    const found: Errors = {};
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) found.name = "Give it a name.";
    if (kind === "weekly" && !days.length) found.days = E.pickDay;
    if (!TIME_PATTERN.test(time)) found.time = ROUTINE_WORDS.errors.time;
    if (chasing && !teams.length) found.teams = E.pickTeam;
    setErrors(found);
    if (Object.keys(found).length) return;
    // "The teams I lead" is kept as that (null), so a team the person comes to lead is chased too; any other choice by id.
    const teamIds = chasing ? (led.length && sameSet(teams, led) ? null : teams) : undefined;
    setBusy(true); onSaving(true);
    try {
      let v: RoutineView;
      if (routine) {
        const patch: RoutinePatch = { name: trimmed, cadence, time, ...(template === "afternoon_check" ? {} : { quietWhenEmpty }) };
        // Only a real change of teams is sent: it changes what the routine does to others (its consent).
        if (chasing && teamsChanged) patch.teamIds = teamIds;
        v = await api<RoutineView>(`/api/orgs/${orgSlug}/brenda/routines/${routine.id}`, { method: "PATCH", body: patch });
      } else {
        const input: RoutineInput = { template, name: trimmed, cadence, time, ...(template === "afternoon_check" ? {} : { quietWhenEmpty }), ...(chasing ? { teamIds } : {}) };
        v = await api<RoutineView>(`/api/orgs/${orgSlug}/brenda/routines`, { method: "POST", body: input });
      }
      onSaved(v, !routine);
    } catch (err) {
      const f = isApiFailure(err) ? err.error.fieldErrors ?? {} : {};
      setErrors({
        form: told(err),
        name: f.name?.[0], time: f.time?.[0], teams: f.teamIds?.[0],
        days: (f.cadence ?? f["cadence.days"] ?? f.days)?.[0],
      });
    } finally { setBusy(false); onSaving(false); }
  }

  // The time zone named in the time's hint links to where it is chosen (Quiet hours).
  const zoneHint = E.timeHint(timeZone);
  const [beforeZone, afterZone = ""] = zoneHint.split(timeZone);
  const label = "text-sm font-medium text-foreground";

  return (
    <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="space-y-6">
      {errors.form ? <div ref={formError}><Alert tone="danger">{errors.form}</Alert></div> : null}

      {editing ? (
        <div>
          <p className={label}>{E.whatItDoes}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{T[template].name}</p>
          <p className="text-meta font-normal text-secondary">{T[template].description}</p>
        </div>
      ) : (
        <fieldset disabled={readOnly}>
          <legend className={label}>{E.whatItDoes}</legend>
          <div className="mt-2.5 space-y-3">
            {ROUTINE_TEMPLATES.map((t) => {
              const locked = isChasing(t) && !chase.allowed;
              return (
                <Radio key={t} name={`${id}-template`} value={t} checked={template === t} disabled={locked} onChange={() => pickTemplate(t)}
                  hint={<>{T[t].description}{locked ? <span className="mt-0.5 block text-subtle">{chase.leadsOnly ? E.chaseLeadsOnly : E.pickTeam}</span> : null}</>}>
                  {T[t].name}
                </Radio>
              );
            })}
          </div>
        </fieldset>
      )}

      <Field label={E.name} htmlFor={`${id}-name`} error={errors.name}>
        <Input id={`${id}-name`} value={name} maxLength={80} disabled={readOnly} autoComplete="off"
          onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
      </Field>

      <div>
        <p id={`${id}-often`} className={cn(label, "mb-1.5")}>{E.howOften}</p>
        <Segmented name={`${id}-cadence`} aria-label={E.howOften} disabled={readOnly} value={kind}
          onChange={(v) => { setKind(v as CadenceKind); touchSchedule(); }}
          options={CADENCE_KINDS.map((k) => ({ value: k, label: E.cadence[k] }))} />
        {kind === "weekly" ? (
          <div className="mt-3">
            <p id={`${id}-days`} className="mb-1.5 text-meta font-medium text-secondary">{E.days}</p>
            <div role="group" aria-labelledby={`${id}-days`} aria-describedby={errors.days ? `${id}-days-error` : undefined} className="segmented flex-wrap">
              {WEEK_ORDER.map((d) => (
                <label key={d} className="segmented-item">
                  <input type="checkbox" checked={days.includes(d)} disabled={readOnly} aria-label={DAY_NAMES[d]}
                    onChange={(e) => { setDays((cur) => (e.target.checked ? [...cur.filter((x) => x !== d), d] : cur.filter((x) => x !== d))); touchSchedule(); }} />
                  <span aria-hidden>{DAY_SHORT[d]}</span>
                </label>
              ))}
            </div>
            {errors.days ? <p id={`${id}-days-error`} role="alert" className="mt-1.5 text-meta font-medium text-danger">{errors.days}</p> : null}
          </div>
        ) : kind === "monthly" ? (
          <Field className="mt-3" label={E.dayOfMonth} htmlFor={`${id}-dom`} description={E.monthHint}>
            <Select id={`${id}-dom`} value={String(dayOfMonth)} disabled={readOnly} className="sm:max-w-48"
              onChange={(e) => { setDayOfMonth(Number(e.target.value)); touchSchedule(); }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{ordinal(n)}</option>)}
              <option value={0}>{E.lastDay}</option>
            </Select>
          </Field>
        ) : null}
      </div>

      <div>
        <Field label={E.time} htmlFor={`${id}-time`} error={errors.time}
          description={<>{beforeZone}<a href="#quiet-hours" className="link-inline" onClick={(e) => { e.preventDefault(); onTimeZone(); }}>{timeZone}</a>{afterZone}</>}>
          <Input id={`${id}-time`} type="time" step={300} value={time} disabled={readOnly} className="sm:max-w-48"
            onChange={(e) => { setTime(e.target.value); touchSchedule(); }} />
        </Field>
        {TIME_PATTERN.test(time) && (kind !== "weekly" || days.length) ? <p className="mt-1.5 text-meta font-normal text-secondary">{cadenceWords(cadence, time)}.</p> : null}
      </div>

      {chasing ? (
        <fieldset disabled={readOnly} aria-describedby={errors.teams ? `${id}-teams-error` : undefined}>
          <legend className={label}>{E.teams}</legend>
          {teamChoices.length ? (
            <div className="mt-2.5 space-y-2.5">
              {teamChoices.map((t) => (
                <Checkbox key={t.id} checked={teams.includes(t.id)} hint={t.lead ? E.teamsYouLead : undefined}
                  onChange={(e) => setTeams((cur) => (e.target.checked ? [...cur.filter((x) => x !== t.id), t.id] : cur.filter((x) => x !== t.id)))}>
                  {t.name}
                </Checkbox>
              ))}
            </div>
          ) : <p className="mt-1 text-meta font-normal text-secondary">{E.pickTeam}</p>}
          {errors.teams ? <p id={`${id}-teams-error`} role="alert" className="mt-1.5 text-meta font-medium text-danger">{errors.teams}</p> : null}
          {routine?.enabled && teamsChanged ? <Alert tone="warning" className="mt-3">{E.teamsChangeWarning}</Alert> : null}
        </fieldset>
      ) : null}

      {template === "afternoon_check" ? (
        <p className="text-meta font-normal text-secondary">{E.afternoonQuiet}</p>
      ) : (
        <Switch checked={quietWhenEmpty} disabled={readOnly} onChange={(e) => setQuietWhenEmpty(e.target.checked)}>{E.quietWhenEmpty}</Switch>
      )}
    </form>
  );
}
