"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Lock, Plus, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { FilterBar, FilterControl, FilterSelect } from "@/components/ui/filter-control";
import { api, isApiFailure } from "@/lib/api-client";
import type { TimesheetEntry } from "@/server/services/reports";
import { DatePicker } from "@/components/ui/date-picker";
import { successToast } from "@/components/ui/toast";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

/** "yyyy-mm-ddThh:mm" read as a wall-clock time in the organisation's zone, to an ISO instant (DST-safe, as localMidnight). */
function zonedIso(local: string, timeZone: string): string {
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offset = (instant: number) => {
    const p = f.formatToParts(new Date(instant));
    const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - Math.floor(instant / 1000) * 1000;
  };
  const wall = Date.UTC(y, m - 1, day, hh, mm);
  let at = wall - offset(wall);
  at = wall - offset(at);
  return new Date(at).toISOString();
}

/**
 * The filter bar for Timesheets, v4: a Person filter for leads and HR (applies at once), the Day with a step either
 * side, and a way back to today.
 */
export function MemberDatePicker({ orgSlug, members, membershipId, date, prev, next, today }: { orgSlug: string; members: { id: string; display_name: string }[]; membershipId: string; date: string; prev: string; next: string; today: string }) {
  const router = useRouter();
  const href = (member: string, d: string) => `/app/${orgSlug}/timesheets?member=${member}&date=${d}`;
  return (
    <form className="mb-6" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); router.push(href(String(f.get("member") ?? membershipId), String(f.get("date") || date))); }}>
      <FilterBar>
        {/* Keyed by the shown member and day, so stepping between days resets the controls to what the page shows. */}
        {members.length ? <FilterSelect key={membershipId} id="ts-member" label="Person" name="member" defaultValue={membershipId} autoSubmit options={members.map((m) => ({ value: m.id, label: m.display_name }))} /> : null}
        <FilterControl label="Day" htmlFor="ts-date">
          <IconButton aria-label="Previous day" size="xs" className="size-6" onClick={() => router.push(href(membershipId, prev))}><ChevronLeft aria-hidden /></IconButton>
          <DatePicker key={date} id="ts-date" name="date" defaultValue={date} max={today} required size="xs" submitOnChange />
          <IconButton aria-label="Next day" size="xs" className="size-6" disabled={next > today} onClick={() => router.push(href(membershipId, next))}><ChevronRight aria-hidden /></IconButton>
        </FilterControl>
        {date !== today ? <Link href={href(membershipId, today)} className={buttonVariants({ variant: "ghost", size: "xs" })}>Today</Link> : null}
      </FilterBar>
    </form>
  );
}

/**
 * A correction: replace recorded intervals with proposed ones, on one of the person's own tasks. The button opens a
 * side sheet with the form (v4: forms live in sheets); a green-dot toast confirms it was sent. What was typed into the
 * intervals survives closing the sheet by mistake, and a click outside never closes it. Its fine print sits under the
 * form as notes (owner request, 7 October 2026: such notes go small and grey at the bottom).
 */
export function AdjustmentForm({ orgSlug, localDate, dateLabel, entries, tasks, timeZone }: { orgSlug: string; localDate: string; dateLabel: string; entries: TimesheetEntry[]; tasks: { id: string; title: string }[]; timeZone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<{ startedAt: string; endedAt: string }[]>([{ startedAt: "", endedAt: "" }]);
  const formId = useId();
  const intervalsError = `${formId}-intervals-error`;
  // Tasks tracked on this day first, then the rest of the person's own tasks: time can be claimed for a day with no timer.
  const tracked = Array.from(new Map(entries.map((e) => [e.taskId, e.taskTitle])).entries());
  const options = [...tracked, ...tasks.filter((t) => !tracked.some(([id]) => id === t.id)).map((t) => [t.id, t.title] as [string, string])];
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(new Date(`${localDate}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const close = () => { if (!pending) setOpen(false); };

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const filled = rows.filter((r) => r.startedAt || r.endedAt);
    if (filled.some((r) => !r.startedAt || !r.endedAt)) { setFieldErrors({ proposedIntervals: ["Give each interval both a start and an end, or remove it."] }); return; }
    if (!filled.length && !selected.length) { setFieldErrors({ proposedIntervals: ["Propose at least one interval, or tick the intervals to remove."] }); return; }
    const proposed = filled.map((r) => ({ startedAt: zonedIso(r.startedAt, timeZone), endedAt: zonedIso(r.endedAt, timeZone) }));
    setPending(true); setError(null); setFieldErrors({});
    try {
      await api(`/api/orgs/${orgSlug}/time-adjustments`, { method: "POST", body: { taskId: f.get("taskId"), localDate, originalIntervalIds: selected, proposedIntervals: proposed, reason: f.get("reason"), evidenceNote: f.get("evidenceNote") || undefined } });
      successToast("Correction requested", "Your team lead reviews it next.");
      setSelected([]); setRows([{ startedAt: "", endedAt: "" }]); setOpen(false);
      router.refresh();
    } catch (err) {
      if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); }
      else setError("Cannot reach the server. Check your connection and try again.");
    } finally { setPending(false); }
  }

  return (
    <>
      <Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={() => { setError(null); setOpen(true); }}>Request a time correction</Button>
      <Sheet open={open} onClose={close} dismissible={false} title={`Time correction for ${dateLabel}`}
        description="Tick the intervals to replace, if any, then propose the right times."
        footer={<><Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={formId} loading={pending} disabled={!options.length}>{pending ? "Sending…" : "Request correction"}</Button></>}>
        <form id={formId} className="grid gap-5" onSubmit={send}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {options.length ? (
            <Field label="Task" htmlFor={`${formId}-task`} error={fieldErrors.taskId}><Select id={`${formId}-task`} name="taskId">{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select></Field>
          ) : <Alert tone="info">You have no tasks assigned to you, so there is nothing to claim time against. Ask your team lead to assign the work first.</Alert>}
          {entries.length ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-foreground">Replace these intervals</legend>
              <div className="-mx-2 grid gap-0.5">{entries.map((e) => (
                <label key={`${e.intervalId}-${e.startedAt}`} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm font-normal transition-colors duration-75 hover:bg-fill-1">
                  <input type="checkbox" checked={selected.includes(e.intervalId)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.intervalId] : selected.filter((x) => x !== e.intervalId))} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{e.taskTitle}</span>
                  <span className="shrink-0 tabular-nums text-secondary">{time(e.startedAt)}–{time(e.endedAt)}</span>
                  {e.status !== "confirmed" ? <span className="shrink-0 text-xs font-medium text-warning">{e.status}</span> : null}
                </label>
              ))}</div>
            </fieldset>
          ) : null}
          <fieldset aria-describedby={fieldErrors.proposedIntervals ? intervalsError : undefined}>
            <legend className="mb-1.5 text-sm font-medium text-foreground">Proposed intervals <span className="font-normal text-secondary">in {zone}</span></legend>
            <div className="grid gap-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-xs font-medium text-subtle" aria-hidden><span>Start</span><span>End</span></div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2">
                  <DatePicker mode="datetime" aria-label={`Interval ${i + 1} start`} value={r.startedAt} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, startedAt: v } : x)))} />
                  <DatePicker mode="datetime" aria-label={`Interval ${i + 1} end`} value={r.endedAt} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, endedAt: v } : x)))} />
                  {rows.length > 1 ? <IconButton aria-label={`Remove interval ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X aria-hidden /></IconButton> : <span aria-hidden />}
                </div>
              ))}
            </div>
            <Button size="xs" variant="ghost" className="mt-2 -ml-2" onClick={() => setRows([...rows, { startedAt: "", endedAt: "" }])}><Plus aria-hidden />Add interval</Button>
            {fieldErrors.proposedIntervals ? <p id={intervalsError} role="alert" className="mt-1.5 text-meta font-medium text-danger">{fieldErrors.proposedIntervals[0]}</p> : null}
          </fieldset>
          <Field label="Reason" htmlFor={`${formId}-reason`} error={fieldErrors.reason}><Textarea id={`${formId}-reason`} name="reason" required maxLength={2000} placeholder="Forgot to start the timer after lunch" /></Field>
          <Field label="Evidence" htmlFor={`${formId}-evidence`} hint="Optional" description="Such as a calendar entry or a commit." error={fieldErrors.evidenceNote}><Input id={`${formId}-evidence`} name="evidenceNote" maxLength={2000} /></Field>
        </form>
        <PageNotes>
          <PageNote>The originals stay in the ledger, marked as replaced.</PageNote>
        </PageNotes>
      </Sheet>
    </>
  );
}

/**
 * CSV of confirmed time. Fetched rather than navigated to, so a refusal shows here instead of as a raw error page. When
 * time counts and that the file is safe to open are notes at the bottom of the sheet (owner request, 7 October 2026).
 */
export function ExportForm({ orgSlug, members, today, canExport = true, upgradeTo }: { orgSlug: string; members: { id: string; display_name: string }[]; today: string; canExport?: boolean; upgradeTo?: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();
  if (!canExport) return <span className="inline-flex h-8 items-center gap-1.5 text-meta font-medium text-secondary"><Lock className="size-3.5" aria-hidden />{upgradeTo ? `CSV export is part of ${upgradeTo}` : "CSV export is not on this plan"}</span>;
  const close = () => { if (!pending) setOpen(false); };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog"><Download aria-hidden />Export CSV</Button>
      <Sheet open={open} onClose={close} size="sm" title="Export CSV"
        description="Confirmed time per person, day and task, the same totals as Timesheets."
        footer={<><Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Preparing…" : "Download CSV"}</Button></>}>
        <ExportFields formId={formId} orgSlug={orgSlug} members={members} today={today} setPending={setPending} onDone={() => setOpen(false)} />
        <PageNotes>
          <PageNote>A correction counts once it is approved; a running timer once it stops.</PageNote>
          <PageNote>Text in the file is safe to open in a spreadsheet.</PageNote>
        </PageNotes>
      </Sheet>
    </>
  );
}

function ExportFields({ formId, orgSlug, members, today, setPending, onDone }: { formId: string; orgSlug: string; members: { id: string; display_name: string }[]; today: string; setPending: (v: boolean) => void; onDone: () => void }) {
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ from?: string; to?: string }>({});
  async function download(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs: { from?: string; to?: string } = {};
    if (!from) errs.from = "Pick the first day.";
    if (!to) errs.to = "Pick the last day.";
    else if (from && from > to) errs.to = "The last day must be on or after the first.";
    setFieldErrors(errs);
    if (errs.from || errs.to) return;
    setPending(true); setError(null);
    try {
      const q = new URLSearchParams({ from, to });
      const member = String(new FormData(e.currentTarget).get("membershipId") ?? "");
      if (member) q.set("membershipId", member);
      const res = await fetch(`/api/orgs/${orgSlug}/exports/timesheets?${q}`, { credentials: "same-origin" });
      if (!res.ok) { const data = await res.json().catch(() => null) as { message?: string } | null; setError(data?.message ?? `The export failed (error ${res.status}). Try again in a moment.`); return; }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `timesheets-${from}-${to}.csv`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      successToast("CSV downloaded", name);
      onDone();
    } catch { setError("Cannot reach the server. Check your connection and try again."); }
    finally { setPending(false); }
  }
  return (
    <form id={formId} className="grid gap-5" onSubmit={download} noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="From" htmlFor="x-from" error={fieldErrors.from}><DatePicker id="x-from" value={from} onChange={setFrom} max={today} required /></Field>
      <Field label="To" htmlFor="x-to" error={fieldErrors.to}><DatePicker id="x-to" value={to} onChange={setTo} max={today} required /></Field>
      <Field label="Person" htmlFor="x-member"><Select id="x-member" name="membershipId" defaultValue=""><option value="">Everyone you can see</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
    </form>
  );
}
