"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import type { ReportSnapshotEntry } from "@/server/services/reports";

function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, okMsg: string) {
    setPending(true); setError(null); setOk(null); setFieldErrors({});
    try { const r = await fn(); setOk(okMsg); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, ok, fieldErrors, submit };
}

export function MemberDatePicker({ orgSlug, members, membershipId, date, prev, next }: { orgSlug: string; members: { id: string; display_name: string }[]; membershipId: string; date: string; prev: string; next: string }) {
  const router = useRouter();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); router.push(`/app/${orgSlug}/timesheets?member=${f.get("member") ?? membershipId}&date=${f.get("date")}`); }}>
      {members.length ? <Field label="Member" htmlFor="ts-member"><Select id="ts-member" name="member" defaultValue={membershipId}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field> : null}
      <Field label="Date" htmlFor="ts-date"><Input id="ts-date" name="date" type="date" defaultValue={date} /></Field>
      <Button type="submit" variant="outline">Show</Button>
      <Button variant="ghost" onClick={() => router.push(`/app/${orgSlug}/timesheets?member=${membershipId}&date=${prev}`)}>← {prev}</Button>
      <Button variant="ghost" onClick={() => router.push(`/app/${orgSlug}/timesheets?member=${membershipId}&date=${next}`)}>{next} →</Button>
    </form>
  );
}

export function SubmitReportForm({ orgSlug, localDate, blockers, nextPriorities, disabled }: { orgSlug: string; localDate: string; blockers: string; nextPriorities: string; disabled: boolean }) {
  const { pending, error, ok, submit } = useForm();
  return (
    <form className="tile grid gap-3 p-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/reports/submit`, { method: "POST", body: { localDate, blockers: f.get("blockers"), nextPriorities: f.get("nextPriorities") } }), "Report submitted for review."); }}>
      <h2 className="font-display text-lg">Submit report for {localDate}</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}{ok ? <Alert tone="success">{ok}</Alert> : null}
      <Field label="Blockers" htmlFor="rp-block" hint="optional"><Textarea id="rp-block" name="blockers" defaultValue={blockers} maxLength={4000} /></Field>
      <Field label="Next priorities" htmlFor="rp-next" hint="optional"><Textarea id="rp-next" name="nextPriorities" defaultValue={nextPriorities} maxLength={4000} /></Field>
      <p className="text-xs text-fg-subtle">Submitting freezes a snapshot of today&apos;s intervals. Missing or uncertain time can be claimed with a correction below, before or after submission.</p>
      <div><Button type="submit" disabled={pending || disabled}>{pending ? "Submitting…" : "Submit report"}</Button></div>
    </form>
  );
}

export function AdjustmentForm({ orgSlug, localDate, entries }: { orgSlug: string; localDate: string; entries: ReportSnapshotEntry[] }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<{ startedAt: string; endedAt: string }[]>([{ startedAt: "", endedAt: "" }]);
  const tasks = Array.from(new Map(entries.map((e) => [e.taskId, e.taskTitle])).entries());
  if (!open) return <Button variant="subtle" onClick={() => setOpen(true)}>Request a time correction</Button>;
  const uniqueIntervals = entries.filter((e) => !e.intervalId.startsWith("proposed:"));
  return (
    <form className="tile grid gap-3 p-4" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const proposed = rows.filter((r) => r.startedAt && r.endedAt).map((r) => ({ startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(r.endedAt).toISOString() }));
      submit(() => api(`/api/orgs/${orgSlug}/time-adjustments`, { method: "POST", body: { taskId: f.get("taskId"), localDate, originalIntervalIds: selected, proposedIntervals: proposed, reason: f.get("reason"), evidenceNote: f.get("evidenceNote") || undefined } }), "Correction requested. A manager will review it.").then((r) => { if (r) setOpen(false); });
    }}>
      <h2 className="font-display text-lg">Time correction for {localDate}</h2>
      <p className="text-sm text-fg-muted">Select intervals to replace (optional), then propose the corrected times. Corrections never overwrite history: the original intervals stay in the ledger marked superseded.</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}{ok ? <Alert tone="success">{ok}</Alert> : null}
      <Field label="Task" htmlFor="adj-task" error={fieldErrors.taskId}>
        {tasks.length ? <Select id="adj-task" name="taskId">{tasks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select> : <Input id="adj-task" name="taskId" placeholder="Task id (no tracked tasks on this day)" required />}
      </Field>
      {uniqueIntervals.length ? <fieldset><legend className="mb-1 text-sm font-semibold text-fg-muted">Replace these intervals</legend><div className="space-y-1 text-sm">{uniqueIntervals.map((e) => <label key={e.intervalId} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(e.intervalId)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, e.intervalId] : selected.filter((x) => x !== e.intervalId))} /> {e.taskTitle}: {new Date(e.startedAt).toLocaleTimeString()} → {new Date(e.endedAt).toLocaleTimeString()} ({e.status})</label>)}</div></fieldset> : null}
      <div>
        <p className="mb-1 text-sm font-semibold text-fg-muted">Proposed intervals (local time)</p>
        {rows.map((r, i) => (
          <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
            <Input aria-label="Start" type="datetime-local" value={r.startedAt} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, startedAt: e.target.value } : x)))} className="w-56" />
            <span className="text-fg-subtle">→</span>
            <Input aria-label="End" type="datetime-local" value={r.endedAt} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, endedAt: e.target.value } : x)))} className="w-56" />
            <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setRows([...rows, { startedAt: "", endedAt: "" }])}>Add interval</Button>
        {fieldErrors.proposedIntervals ? <p className="mt-1 text-sm text-danger">{fieldErrors.proposedIntervals[0]}</p> : null}
      </div>
      <Field label="Reason" htmlFor="adj-reason" error={fieldErrors.reason}><Textarea id="adj-reason" name="reason" required maxLength={2000} /></Field>
      <Field label="Evidence" htmlFor="adj-ev" hint="optional, e.g. calendar entry or commit"><Input id="adj-ev" name="evidenceNote" maxLength={2000} /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Sending…" : "Request correction"}</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function ExportForm({ orgSlug, members }: { orgSlug: string; members: { id: string; display_name: string }[] }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Export CSV</Button>;
  return (
    <form className="tile flex flex-wrap items-end gap-2 p-3" method="get" action={`/api/orgs/${orgSlug}/exports/timesheets`}>
      <Field label="From" htmlFor="x-from"><Input id="x-from" name="from" type="date" defaultValue={monthStart} required /></Field>
      <Field label="To" htmlFor="x-to"><Input id="x-to" name="to" type="date" defaultValue={today} required /></Field>
      <Field label="Member" htmlFor="x-member"><Select id="x-member" name="membershipId" defaultValue=""><option value="">Everyone in scope</option>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
      <Button type="submit">Download approved records</Button>
      <p className="w-full text-xs text-fg-subtle">Approved report versions only; totals reconcile with the approved snapshots. Text is formula-safe.</p>
    </form>
  );
}
