"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CopyBlock } from "@/components/marketing/copy-block";
import { EMPTY_INPUT, EXAMPLES, buildReport, reportFilename, type ReportFormat, type ReportInput, type ReportKind } from "@/components/marketing/tools/eod-report";

/**
 * The end-of-day report generator (owner request, 17 October 2026: SEO analysis, Content Plan page 14): above the fold,
 * no sign-up, no AI and nothing sent anywhere. A few bullet points in four boxes become a tidy end-of-day report (or a
 * standup update) as you type, in plain text or Markdown, to copy or download (CopyBlock). The template is in
 * eod-report.ts. Nothing is stored: the boxes live in this tab's memory and are gone on reload.
 *
 * Pages v2 (owner feedback, 17 October 2026): the generator sits on the canvas inside the page's ToolShell, so it has
 * no outer panel of its own: the boxes on the left, the report on the right behind a hairline (under the boxes below
 * 1024px), the report holding in view while the boxes scroll past.
 */

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const noSubscription = () => () => {};

const BOXES: { key: keyof Pick<ReportInput, "decisions" | "changed" | "blocked" | "tomorrow">; label: string; help: string; placeholder: string }[] = [
  { key: "decisions", label: "Decisions waiting on someone", help: "One a line. Say who it's waiting on.", placeholder: "Go or no-go on Friday's release: waiting on Sam" },
  { key: "changed", label: "What changed since yesterday", help: "Finished, shipped, started or moved.", placeholder: "Invoice export merged\nStarted the onboarding emails" },
  { key: "blocked", label: "Blocked, and on whom", help: "Leave it empty if nothing is.", placeholder: "Staging access: waiting on IT" },
  { key: "tomorrow", label: "Tomorrow", help: "The first thing or two.", placeholder: "Finish the onboarding emails" },
];

export function EodReportGenerator() {
  const id = useId();
  // The date box holds today's date in the reader's own time zone until they change it (empty on the server, whose date
  // could differ, so the first HTML and the browser's first render agree).
  const todayText = useSyncExternalStore(noSubscription, today, () => "");
  const [state, setInput] = useState<ReportInput & { dateTouched?: boolean }>(EMPTY_INPUT);
  const input: ReportInput = state.dateTouched ? state : { ...state, date: state.date || todayText };
  const [kind, setKind] = useState<ReportKind>("eod");
  const [format, setFormat] = useState<ReportFormat>("text");
  const set = (k: keyof ReportInput, v: string) => setInput((i) => ({ ...i, [k]: v, ...(k === "date" ? { dateTouched: true } : {}) }));

  const text = buildReport(input, kind, format);
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
      <div className="min-w-0 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented name={`${id}-kind`} aria-label="Write" value={kind} onChange={(v) => setKind(v === "standup" ? "standup" : "eod")}
            options={[{ value: "eod", label: "End-of-day report" }, { value: "standup", label: "Standup update" }]} />
          <Segmented name={`${id}-format`} aria-label="Format" value={format} onChange={(v) => setFormat(v === "markdown" ? "markdown" : "text")}
            options={[{ value: "text", label: "Plain text" }, { value: "markdown", label: "Markdown" }]} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="mr-1 text-meta font-normal text-secondary">Try an example:</span>
          {EXAMPLES.map((ex) => <Button key={ex.id} variant="ghost" size="sm" onClick={() => setInput(ex.input)}>{ex.label}</Button>)}
          <Button variant="ghost" size="sm" onClick={() => setInput(EMPTY_INPUT)}>Clear</Button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor={`${id}-name`}><Input id={`${id}-name`} autoComplete="given-name" value={input.name} onChange={(e) => set("name", e.target.value)} placeholder="Ada" /></Field>
          <Field label="Team or project" hint="Optional" htmlFor={`${id}-team`}><Input id={`${id}-team`} autoComplete="off" value={input.team} onChange={(e) => set("team", e.target.value)} placeholder="Payments" /></Field>
          <Field label="Date" htmlFor={`${id}-date`}><Input id={`${id}-date`} autoComplete="off" value={input.date} onChange={(e) => set("date", e.target.value)} placeholder="17 October 2026" /></Field>
          <Field label="Hours worked" hint="Optional" htmlFor={`${id}-hours`}><Input id={`${id}-hours`} autoComplete="off" inputMode="decimal" value={input.hours} onChange={(e) => set("hours", e.target.value)} placeholder="7.5" /></Field>
        </div>
        <div className="mt-4 space-y-4">
          {BOXES.map((b) => (
            <Field key={b.key} label={b.label} htmlFor={`${id}-${b.key}`} description={b.help}>
              <Textarea id={`${id}-${b.key}`} rows={3} className="min-h-[84px] resize-y" value={input[b.key]} onChange={(e) => set(b.key, e.target.value)} placeholder={b.placeholder} />
            </Field>
          ))}
        </div>
      </div>
      <div className="min-w-0 border-t border-border bg-fill-0 p-4 max-lg:rounded-b-[15px] sm:p-6 max-lg:sm:rounded-b-[19px] lg:rounded-r-[19px] lg:border-l lg:border-t-0">
        <div className="lg:sticky lg:top-[calc(var(--lp-sticky-top)+8px)]">
          <CopyBlock title={kind === "standup" ? "Your standup update" : "Your end-of-day report"} text={text} filename={reportFilename(input, kind, format)} />
          <p className="mt-3 px-1 text-meta font-normal text-secondary">Written in your browser as you type. Nothing is sent or saved: reload the page and it&apos;s gone.</p>
        </div>
      </div>
    </div>
  );
}
