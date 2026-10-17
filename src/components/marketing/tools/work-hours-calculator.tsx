"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, Copy, Download, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  WEEKDAYS, calculate, describeRule, formatClock, formatDecimal, formatHM, formatSpoken, pay, summaryText, timesheetCsv,
  type DayInput, type DayResult, type Entry, type EntryResult,
} from "@/components/marketing/tools/work-hours";

/**
 * The work hours calculator (owner request, 17 October 2026: SEO analysis, Content Plan page 13): above the fold, no
 * sign-up, nothing sent anywhere. One day or a full week; several shifts a day (split shifts); an end before the start is
 * an overnight shift; unpaid breaks; overtime after a daily and/or weekly limit with the rule said in words; an optional
 * hourly rate for pay before tax. The result in hours and minutes and in decimal hours, the working shown, a summary to
 * copy and the shifts as CSV. Design system v4: hairline panels, the app's fields and buttons, white buttons only; orange
 * only where the primitives put it (the chosen segment's dot, a ticked box). The arithmetic is in work-hours.ts.
 *
 * Pages v2 (owner feedback, 17 October 2026): the calculator sits on the canvas inside the page's ToolShell, so it has no
 * outer panels of its own: the inputs on the left, the result on the right behind a hairline (under the inputs, behind
 * a hairline, below 1024px), the result holding in view while a week's days scroll past.
 */

const BLANK: Entry = { start: "", end: "", breakMinutes: "" };
const SAMPLE: Entry = { start: "09:00", end: "17:30", breakMinutes: "30" };
const sampleDay = (): DayInput => ({ label: "Today", entries: [{ ...SAMPLE }] });
const sampleWeek = (): DayInput[] => WEEKDAYS.map((label, i) => ({ label, entries: [i < 5 ? { ...SAMPLE } : { ...BLANK }] }));

const num = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

const PANE = "p-4 sm:p-6";

export function WorkHoursCalculator() {
  const id = useId();
  const [mode, setMode] = useState<"day" | "week">("day");
  const [day, setDay] = useState<DayInput>(sampleDay);
  const [week, setWeek] = useState<DayInput[]>(sampleWeek);
  const [dailyOn, setDailyOn] = useState(true);
  const [dailyLimit, setDailyLimit] = useState("8");
  const [weeklyOn, setWeeklyOn] = useState(true);
  const [weeklyLimit, setWeeklyLimit] = useState("40");
  const [rate, setRate] = useState("");
  const [multiplier, setMultiplier] = useState("1.5");

  const single = mode === "day";
  const days = useMemo(() => (single ? [day] : week), [single, day, week]);
  const rule = useMemo(() => ({ daily: dailyOn ? num(dailyLimit) : null, weekly: !single && weeklyOn ? num(weeklyLimit) : null }), [dailyOn, dailyLimit, weeklyOn, weeklyLimit, single]);
  const result = useMemo(() => calculate(days, rule), [days, rule]);
  const money = pay(result, num(rate), Number(multiplier));

  const setDayAt = (i: number, next: DayInput) => (single ? setDay(next) : setWeek((w) => w.map((d, j) => (j === i ? next : d))));
  const clear = () => { setDay({ label: "Today", entries: [{ ...BLANK }] }); setWeek(WEEKDAYS.map((label) => ({ label, entries: [{ ...BLANK }] }))); };
  const example = () => { setDay(sampleDay()); setWeek(sampleWeek()); };

  // One quiet announcement after typing settles, not one per keystroke.
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setAnnounce(`Total worked ${formatSpoken(result.worked)}, ${formatDecimal(result.worked)} hours. Overtime ${formatSpoken(result.overtime)}.`), 700);
    return () => window.clearTimeout(t);
  }, [result.worked, result.overtime]);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_23rem]">
      <div className={cn(PANE, "min-w-0")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented name={`${id}-mode`} aria-label="Calculate" value={mode} onChange={(v) => setMode(v === "week" ? "week" : "day")}
            options={[{ value: "day", label: "One day" }, { value: "week", label: "A full week" }]} />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={example}>Fill in an example</Button>
            <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
          </div>
        </div>
        <p className="mt-4 text-meta font-normal text-secondary">Type times as 09:00, 9am or 17:30. An end time before the start is an overnight shift. Breaks are unpaid minutes.</p>

        <div className="mt-5 space-y-3">
          {days.map((d, i) => <DayFields key={single ? "today" : d.label} id={`${id}-${i}`} day={d} result={result.days[i]} single={single} onChange={(next) => setDayAt(i, next)} />)}
        </div>

        <fieldset className="mt-6 border-t border-border pt-5">
          <legend className="float-left w-full text-sm font-semibold text-foreground">Overtime and pay</legend>
          <div className="clear-left grid gap-4 pt-3 sm:grid-cols-2">
            <LimitField id={`${id}-daily`} on={dailyOn} setOn={setDailyOn} value={dailyLimit} setValue={setDailyLimit} label="Count daily overtime" unit="hours a day" />
            {!single ? <LimitField id={`${id}-weekly`} on={weeklyOn} setOn={setWeeklyOn} value={weeklyLimit} setValue={setWeeklyLimit} label="Count weekly overtime" unit="hours a week" /> : null}
            <div>
              <label htmlFor={`${id}-rate`} className="mb-1.5 block text-sm font-medium text-foreground">Hourly rate <span className="font-normal text-secondary">Optional</span></label>
              <Input id={`${id}-rate`} inputMode="decimal" autoComplete="off" placeholder="15.00" value={rate} onChange={(e) => setRate(e.target.value)} aria-describedby={`${id}-rate-help`} />
              <p id={`${id}-rate-help`} className="mt-1.5 text-meta font-normal text-secondary">Any currency. Gives pay before tax.</p>
            </div>
            <div>
              <label htmlFor={`${id}-mult`} className="mb-1.5 block text-sm font-medium text-foreground">Overtime rate</label>
              <Select id={`${id}-mult`} value={multiplier} onChange={(e) => setMultiplier(e.target.value)}>
                <option value="1.5">1.5× (time and a half)</option>
                <option value="2">2× (double time)</option>
                <option value="1.25">1.25×</option>
                <option value="1">1× (no extra)</option>
              </Select>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="min-w-0 border-t border-border bg-fill-0 max-lg:rounded-b-[15px] max-lg:sm:rounded-b-[19px] lg:rounded-r-[19px] lg:border-l lg:border-t-0">
        <Results result={result} single={single} rule={rule} money={money} multiplier={Number(multiplier)} />
      </div>
      <p role="status" className="sr-only">{announce}</p>
    </div>
  );
}

function LimitField({ id, on, setOn, value, setValue, label, unit }: { id: string; on: boolean; setOn: (v: boolean) => void; value: string; setValue: (v: string) => void; label: string; unit: string }) {
  return (
    <div>
      <Checkbox checked={on} onChange={(e) => setOn(e.target.checked)}>{label}</Checkbox>
      <div className="mt-2 flex items-center gap-2 pl-[26px]">
        <Input id={id} inputMode="decimal" autoComplete="off" className="w-20" value={value} disabled={!on} onChange={(e) => setValue(e.target.value)} aria-label={`Overtime starts after this many ${unit}`} />
        <span className="text-sm font-normal text-secondary" aria-hidden>{unit}</span>
      </div>
    </div>
  );
}

const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,5.5rem)_2.5rem] items-start gap-2";

function DayFields({ id, day, result, single, onChange }: { id: string; day: DayInput; result: DayResult; single: boolean; onChange: (d: DayInput) => void }) {
  const setEntry = (i: number, patch: Partial<Entry>) => onChange({ ...day, entries: day.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const remove = (i: number) => onChange({ ...day, entries: day.entries.length > 1 ? day.entries.filter((_, j) => j !== i) : [{ ...BLANK }] });
  const add = () => onChange({ ...day, entries: [...day.entries, { ...BLANK }] });
  const name = single ? "Shift" : day.label;
  return (
    <fieldset className="min-w-0 rounded-2xl border border-border bg-background p-3 sm:p-4">
      <legend className="sr-only">{single ? "Your shifts today" : day.label}</legend>
      <div className="flex items-baseline justify-between gap-3" aria-hidden>
        <span className="text-sm font-semibold text-foreground">{single ? "Your shifts" : day.label}</span>
        <span className="text-meta font-normal tabular-nums text-secondary">{result.worked ? `${formatHM(result.worked)} (${formatDecimal(result.worked)} h)` : "No hours"}</span>
      </div>
      <div className={cn(ROW, "mt-3 text-xs font-medium text-secondary")} aria-hidden>
        <span>Start</span><span>End</span><span>Break (min)</span><span />
      </div>
      <div className="mt-1.5 space-y-2">
        {day.entries.map((e, i) => {
          const r: EntryResult = result.entries[i];
          const err = r.kind === "error" ? r : null;
          const errId = `${id}-e${i}-error`;
          const label = `${name}${day.entries.length > 1 || !single ? ` ${i + 1}` : ""}`;
          const field = (f: "start" | "end" | "break") => ({
            "aria-invalid": err?.field === f || undefined,
            "aria-describedby": err?.field === f ? errId : undefined,
          });
          return (
            <div key={i}>
              <div className={ROW}>
                <Input fieldSize="sm" autoComplete="off" spellCheck={false} placeholder="09:00" value={e.start} onChange={(ev) => setEntry(i, { start: ev.target.value })} aria-label={`${label}, start time`} {...field("start")} />
                <Input fieldSize="sm" autoComplete="off" spellCheck={false} placeholder="17:30" value={e.end} onChange={(ev) => setEntry(i, { end: ev.target.value })} aria-label={`${label}, end time`} {...field("end")} />
                <Input fieldSize="sm" autoComplete="off" inputMode="numeric" placeholder="30" value={e.breakMinutes} onChange={(ev) => setEntry(i, { breakMinutes: ev.target.value })} aria-label={`${label}, unpaid break in minutes`} {...field("break")} />
                <IconButton aria-label={`Remove ${label.toLowerCase()}`} onClick={() => remove(i)}><X /></IconButton>
              </div>
              {err ? <p id={errId} className="mt-1 text-meta font-medium text-danger">{err.message}</p>
                : r.kind === "ok" && r.overnight ? <p className="mt-1 text-meta font-normal text-secondary">Ends the next day.</p> : null}
            </div>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" className="mt-2 -ml-1" onClick={add}><Plus aria-hidden />{single ? "Add a shift" : `Add a shift on ${day.label}`}</Button>
    </fieldset>
  );
}

function Results({ result, single, rule, money, multiplier }: {
  result: ReturnType<typeof calculate>; single: boolean; rule: { daily: number | null; weekly: number | null };
  money: ReturnType<typeof pay>; multiplier: number;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(summaryText(result, rule, single)); setFailed(false); setCopied(true); }
    catch { setFailed(true); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([timesheetCsv(result)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: single ? "work-hours-day.csv" : "work-hours-week.csv" });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shifts = result.days.flatMap((d) => d.entries.map((e) => ({ day: d.label, e })).filter((x): x is { day: string; e: Extract<EntryResult, { kind: "ok" }> } => x.e.kind === "ok"));

  return (
    <section aria-label="Result" className={cn(PANE, "min-w-0 lg:sticky lg:top-[calc(var(--lp-sticky-top)+8px)]")}>
      <p className="text-sm font-medium text-secondary">Total worked</p>
      <p className="mt-1 font-display text-[44px] leading-[48px] tracking-[-0.02em] tabular-nums text-foreground">{formatHM(result.worked)}</p>
      <p className="text-sm font-normal tabular-nums text-secondary">{formatDecimal(result.worked)} hours in decimal, {formatSpoken(result.worked)}</p>

      <dl className="mt-5 divide-y divide-border border-y border-border text-sm">
        <Row term="Regular" value={`${formatHM(result.regular)} (${formatDecimal(result.regular)} h)`} />
        <Row term="Overtime" value={`${formatHM(result.overtime)} (${formatDecimal(result.overtime)} h)`} />
        <Row term="Unpaid breaks" value={formatHM(result.breaks)} />
        {money ? <Row term="Pay before tax" value={fmt(money.total)} /> : null}
      </dl>
      <p className="mt-3 text-meta font-normal text-secondary">{describeRule(rule, single)}{money ? ` Overtime is paid at ${multiplier}× the rate.` : ""}</p>
      {result.errors ? <p className="mt-2 text-meta font-medium text-danger">{result.errors === 1 ? "One shift has a problem and isn't counted." : `${result.errors} shifts have a problem and aren't counted.`}</p> : null}

      <details className="group mt-4 rounded-xl border border-border px-3 py-1">
        <summary className="flex h-9 cursor-pointer list-none items-center text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">Show the working</summary>
        <div className="space-y-1.5 pb-3 text-meta font-normal tabular-nums text-secondary">
          {shifts.length ? shifts.map(({ day, e }, i) => (
            <p key={i}>{single ? "" : `${day}: `}{formatClock(e.start)} to {formatClock(e.end)}{e.overnight ? " (next day)" : ""} is {formatSpoken(e.span)}{e.breakMinutes ? `, minus ${e.breakMinutes} min break` : ""}, so {formatSpoken(e.worked)} ({formatDecimal(e.worked)} h).</p>
          )) : <p>No shifts yet.</p>}
          {result.dailyOvertime ? <p>Daily overtime: {result.days.filter((d) => d.overtime).map((d) => `${single ? "" : `${d.label} `}${formatSpoken(d.overtime)}`).join(", ")} over {rule.daily} h.</p> : null}
          {result.weeklyOvertime ? <p>Weekly overtime: {formatSpoken(result.worked - result.dailyOvertime)} not already overtime, less {rule.weekly} h, is {formatSpoken(result.weeklyOvertime)}.</p> : null}
          {money ? <p>Pay: {formatDecimal(result.regular)} h × rate, plus {formatDecimal(result.overtime)} h × rate × {multiplier}, is {fmt(money.total)}.</p> : null}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy summary"}</Button>
        <Button variant="secondary" size="sm" onClick={download}><Download aria-hidden />Download CSV</Button>
      </div>
      <p role="status" className="sr-only">{copied ? "Summary copied to the clipboard." : failed ? "Copying didn't work here. Select the result and copy it instead." : ""}</p>
    </section>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="font-normal text-secondary">{term}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
