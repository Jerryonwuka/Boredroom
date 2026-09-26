"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Play, Plus, X, CheckCircle2, MessageSquareText, Trash2, UserRoundCheck, ExternalLink, CalendarClock, Hourglass, Timer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton, ICON_BUTTON } from "@/components/ui/icon-button";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { Person } from "@/components/ui/person";
import { Avatar } from "@/components/ui/avatar";
import { Presence } from "@/components/ui/motion";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationPicker, durationLabel } from "@/components/ui/duration-picker";
import { api, isApiFailure } from "@/lib/api-client";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import type { TaskListRow } from "@/server/services/views";

type Person = { id: string; display_name: string; team_name: string | null; group: "team" | "organisation" };

/** The green line that confirms something (owner decision, 26 September 2026): a toast, gone after five seconds. */
export function successToast(title: string, body?: string) {
  toast.custom(() => (
    <div className="tile flex w-[340px] items-start gap-3 p-4">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p>{body ? <p className="text-sm text-fg-muted">{body}</p> : null}</div>
    </div>
  ), { duration: 5000 });
}

const statusLabel = (s: string) => (s === "in_review" ? "Sent for check" : label(s));

/** A team lead or organisation account creates a task and hands it to someone. Opens as a pop-up; the assignee is notified. */
export function NewAssignedTask({ orgSlug, people, self, selfName, canKeep = true }: { orgSlug: string; people: Person[]; self: string; selfName: string; canKeep?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog"><Plus className="size-4" aria-hidden />Add new task</Button>
      {open ? <NewTaskSheet orgSlug={orgSlug} people={people} self={self} selfName={selfName} canKeep={canKeep} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewTaskSheet({ orgSlug, people, self, selfName, canKeep, onClose }: { orgSlug: string; people: Person[]; self: string; selfName: string; canKeep: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const others = people.filter((p) => p.id !== self);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className="grid gap-4 p-5 md:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true); setError(null); setFieldErrors({});
        try {
          const assignee = String(f.get("assigneeMembershipId") || self);
          await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: {
            title: f.get("title"), description: String(f.get("description") ?? "").trim() || null, assigneeMembershipId: assignee,
            dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null,
            estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null, priority: f.get("priority") ?? "normal" } });
          const who = assignee === self ? "you" : (people.find((p) => p.id === assignee)?.display_name ?? "them");
          successToast(`Task assigned to ${who}`, assignee === self ? undefined : "They have been notified.");
          onClose(); router.refresh();
        } catch (err) {
          if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server.");
        } finally { setPending(false); }
      }}>
        <div className="flex items-start justify-between gap-3 md:col-span-2">
          <div><h2 id={titleId} className="font-display text-xl">New task</h2><p className="mt-1 text-sm text-fg-muted">Say what needs doing and who should do it. They are notified and see it under their tasks.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {error ? <Alert tone="danger" className="md:col-span-2">{error}</Alert> : null}
        <div className="md:col-span-2"><Field label="What needs doing" htmlFor="nt-title" error={fieldErrors.title}><Input id="nt-title" name="title" required maxLength={200} placeholder="e.g. Redo the homepage banner" autoFocus /></Field></div>
        <div className="md:col-span-2"><Field label="Details" htmlFor="nt-desc" hint="optional: what a finished result looks like" error={fieldErrors.description}><Textarea id="nt-desc" name="description" maxLength={4000} className="min-h-20" /></Field></div>
        <Field label="Assign to" htmlFor="nt-who" error={fieldErrors.assigneeMembershipId}>
          <Select id="nt-who" name="assigneeMembershipId" defaultValue={others.find((p) => p.group === "team")?.id ?? (canKeep ? self : others[0]?.id)}>
            <optgroup label={canKeep ? "Your team" : "Staff and team leads"}>
              {others.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}
              {canKeep ? <option value={self}>{selfName} (me)</option> : null}
            </optgroup>
            {others.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{others.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="nt-pri"><Select id="nt-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        <Field label="Due" htmlFor="nt-due" hint="optional" error={fieldErrors.dueAt}><DatePicker mode="datetime" id="nt-due" name="dueAt" /></Field>
        <Field label="Estimated time" htmlFor="nt-est" hint="optional" error={fieldErrors.estimateMinutes}><DurationPicker id="nt-est" name="estimateMinutes" /></Field>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create and assign"}</Button></div>
      </form>
    </dialog>
  );
}

// ---- The list (owner decision, 26 September 2026): face, task, person, date, status, one icon; a pop-up for the rest ----

export type TaskViewer = { membershipId: string; displayName: string; role: string; timezone: string };

export function TaskTable({ orgSlug, rows, viewer, mine, runningTaskId, people, canBulk }: { orgSlug: string; rows: TaskListRow[]; viewer: TaskViewer; mine: boolean; runningTaskId: string | null; people: { id: string; display_name: string }[]; canBulk: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [peek, setPeek] = useState<TaskListRow | null>(null);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [reassign, setReassign] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const head = useRef<HTMLInputElement>(null);
  const ids = rows.map((r) => r.id);
  const chosen = ids.filter((id) => selected.has(id));
  const all = chosen.length > 0 && chosen.length === ids.length;
  useEffect(() => { if (head.current) head.current.indeterminate = chosen.length > 0 && !all; }, [chosen.length, all]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (body: { action: "archive" | "reassign"; assigneeMembershipId?: string }) => {
    setPending(true); setError(null);
    try {
      const r = await api<{ done: number; failed: { title: string; reason: string }[] }>(`/api/orgs/${orgSlug}/tasks/bulk`, { method: "POST", body: { ids: chosen, ...body }, retries: 0 });
      if (r.done) successToast(body.action === "archive" ? `${r.done} task${r.done === 1 ? "" : "s"} deleted` : `${r.done} task${r.done === 1 ? "" : "s"} reassigned`, r.failed.length ? `${r.failed.length} could not be changed.` : undefined);
      if (r.failed.length) setError(r.failed.map((f) => `${f.title}: ${f.reason}`).join(" "));
      setSelected(new Set()); router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(false); }
  };
  return (
    <>
      <Presence show={chosen.length > 0}>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm">
          <span className="mr-1 font-semibold tabular-nums">{chosen.length} selected</span>
          <IconButton aria-label={`Delete ${chosen.length} task${chosen.length === 1 ? "" : "s"}`} disabled={pending} onClick={() => setConfirm("delete")} className="size-9 text-danger hover:text-danger"><Trash2 className="size-4" aria-hidden /></IconButton>
          {people.length ? <IconButton aria-label={`Reassign ${chosen.length} task${chosen.length === 1 ? "" : "s"}`} disabled={pending} onClick={() => setReassign(true)} className="size-9"><UserRoundCheck className="size-4" aria-hidden /></IconButton> : null}
          <IconButton aria-label="Clear selection" className="ml-auto size-9" onClick={() => setSelected(new Set())}><X className="size-4" aria-hidden /></IconButton>
          {error ? <p role="alert" className="basis-full text-xs text-danger">{error}</p> : null}
        </div>
      </Presence>
      {reassign ? <ReassignSheet people={people} count={chosen.length} pending={pending} onClose={() => setReassign(false)} onConfirm={async (id) => { await bulk({ action: "reassign", assigneeMembershipId: id }); setReassign(false); }} /> : null}
      <DataTable caption="Tasks" className="data-fit">
        <thead><tr>
          {canBulk ? <th className="w-9 !pr-0"><input ref={head} type="checkbox" aria-label="Select every task" checked={all} onChange={() => setSelected(all ? new Set() : new Set(ids))} /></th> : null}
          <th>Task</th><th className="hidden w-[168px] md:table-cell">Date</th><th className="w-[96px] md:w-[150px]">Status</th><th className="w-[52px]"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody>{rows.map((t) => {
          const running = runningTaskId === t.id;
          const isMe = t.assignee_membership_id === viewer.membershipId;
          const faceId = mine ? t.created_by : t.assignee_membership_id;
          const faceName = mine ? t.created_by_name : t.assignee_name;
          const personName = mine ? (t.created_by === viewer.membershipId ? "You" : t.created_by_name) : (isMe ? "You" : t.assignee_name);
          return (
            <tr key={t.id} className={cn(running && "bg-accent-soft/30", selected.has(t.id) && "bg-wash")}>
              {canBulk ? <td className="!pr-0"><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td> : null}
              <td>
                <div className="flex items-center gap-2.5 md:gap-3">
                  <div className="hidden shrink-0 sm:block"><Person orgSlug={orgSlug} membershipId={faceId} name={faceName} showName={false} size={36} /></div>
                  <div className="min-w-0">
                    <button type="button" onClick={() => setPeek(t)} className="block max-w-full truncate text-left font-semibold hover:underline">{t.title}</button>
                    <p className={cn("truncate text-xs", t.overdue ? "text-danger" : "text-fg-subtle")}>{personName}{t.overdue ? " · overdue" : ""}</p>
                  </div>
                </div>
              </td>
              <td className="hidden whitespace-nowrap md:table-cell">{t.due_at ? <><span className="eyebrow block">{t.overdue ? "Overdue" : "Due"}</span><span className={cn("text-sm tabular-nums", t.overdue ? "text-danger" : "text-fg-muted")}>{formatDateTime(t.due_at, viewer.timezone)}</span></> : <span className="text-fg-subtle">—</span>}</td>
              <td>{running ? <Badge tone="success" dot>Working now</Badge> : <Badge tone={TASK_STATUS_TONE[t.status]}>{statusLabel(t.status)}</Badge>}</td>
              <td className="whitespace-nowrap text-right">
                {mine && t.status !== "completed" && t.status !== "in_review" ? <PickUpTask orgSlug={orgSlug} taskId={t.id} running={running} anyRunning={!!runningTaskId} /> : null}
                {!mine && isMe && ["todo", "in_progress", "blocked"].includes(t.status) ? <MarkDone orgSlug={orgSlug} taskId={t.id} /> : null}
                {!mine && !isMe && t.status !== "completed" ? <Link href={`/app/${orgSlug}/messages?to=${t.assignee_membership_id}&task=${t.id}`} aria-label="Ask for an update" className={cn(ICON_BUTTON, "size-9")}><MessageSquareText className="size-4" aria-hidden /></Link> : null}
              </td>
            </tr>
          );
        })}</tbody>
      </DataTable>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title={`Delete ${chosen.length} task${chosen.length === 1 ? "" : "s"}?`} description="They leave every list. Their history is kept, and nothing can be started on them again." confirmLabel="Delete" onConfirm={() => bulk({ action: "archive" })} />
      {peek ? <TaskSheet orgSlug={orgSlug} row={peek} viewer={viewer} mine={mine} running={runningTaskId === peek.id} anyRunning={!!runningTaskId} onClose={() => setPeek(null)} /> : null}
    </>
  );
}

/** Who gets the ticked tasks: a searchable list of people, one chosen, then one confirming press. */
function ReassignSheet({ people, count, pending, onClose, onConfirm }: { people: { id: string; display_name: string }[]; count: number; pending: boolean; onClose: () => void; onConfirm: (id: string) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const list = people.filter((p) => p.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  const name = people.find((p) => p.id === chosen)?.display_name;
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className="grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); if (chosen) void onConfirm(chosen); }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id={titleId} className="font-display text-xl">Reassign {count} task{count === 1 ? "" : "s"}</h2><p className="mt-1 text-sm text-fg-muted">Pick who should hold them. They are notified.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" autoFocus />
        <ul className="prompt-scroll max-h-64 divide-y divide-border-soft overflow-y-auto rounded-[var(--radius-sm)] border border-border-soft">
          {list.length === 0 ? <li className="p-3 text-sm text-fg-muted">Nobody matches.</li> : list.map((p) => (
            <li key={p.id}>
              <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-wash", chosen === p.id && "bg-accent-soft/60")}>
                <input type="radio" name="assignee" value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} />
                <Avatar profileId={p.id} name={p.display_name} size={28} />
                <span className="truncate text-sm">{p.display_name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !chosen}>{pending ? "Reassigning…" : name ? `Reassign to ${name.split(" ")[0]}` : "Reassign"}</Button></div>
      </form>
    </dialog>
  );
}

type Detail = { task: TaskListRow & { expected_output: string }; comments: { id: string; body: string; created_at: string; author_name: string }[]; history: { from_status: string | null; to_status: string; reason: string | null; occurred_at: string; actor_name: string | null }[]; canManage: boolean; submissions: number; sessions: number };

/** The pop-up for a task: everything the row leaves out, and the actions on it. Loads the details on open. */
function TaskSheet({ orgSlug, row, viewer, mine, running, anyRunning, onClose }: { orgSlug: string; row: TaskListRow; viewer: TaskViewer; mine: boolean; running: boolean; anyRunning: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let alive = true;
    api<Detail>(`/api/orgs/${orgSlug}/tasks/${row.id}`).then((d) => { if (alive) setDetail(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [orgSlug, row.id]);
  const t = detail?.task ?? row;
  const isMe = t.assignee_membership_id === viewer.membershipId;
  const tz = viewer.timezone;
  const fact = (icon: React.ReactNode, name: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-border-soft bg-wash px-3 py-2"><span className="mt-0.5 text-fg-subtle">{icon}</span><span className="min-w-0"><span className="eyebrow block">{name}</span><span className="block truncate text-sm">{value}</span></span></div>
  );
  return (
    <dialog ref={ref} className="sheet !max-w-[min(92vw,38rem)]" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{t.project_name}</p>
            <h2 id={titleId} className="mt-1 font-display text-xl leading-tight">{t.title}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={running ? "success" : TASK_STATUS_TONE[t.status]} dot={running}>{running ? "Working now" : statusLabel(t.status)}</Badge>{t.priority !== "normal" ? <Badge tone={t.priority === "urgent" ? "danger" : t.priority === "high" ? "warning" : "neutral"}>{label(t.priority)} priority</Badge> : null}{t.overdue ? <Badge tone="danger">Overdue</Badge> : null}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Person orgSlug={orgSlug} membershipId={t.assignee_membership_id} name={t.assignee_name} size={32} meta={isMe ? "Holds this task (you)" : "Holds this task"} you={isMe} />
          {t.created_by !== t.assignee_membership_id ? <Person orgSlug={orgSlug} membershipId={t.created_by} name={t.created_by_name} size={32} meta="Handed it out" you={t.created_by === viewer.membershipId} /> : null}
        </div>
        <div>
          <p className="eyebrow mb-1">What a finished result looks like</p>
          {detail ? <p className="whitespace-pre-wrap text-sm text-fg-muted">{detail.task.expected_output}</p> : failed ? <p className="text-sm text-danger">Could not load the details. Open the full task instead.</p> : <p className="text-sm text-fg-subtle">Loading…</p>}
          {t.blocked_reason ? <p className="mt-2 rounded-[var(--radius-sm)] border border-danger/40 bg-danger/10 px-3 py-2 text-sm"><strong>Blocked:</strong> {t.blocked_reason}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {fact(<CalendarClock className="size-4" aria-hidden />, t.overdue ? "Overdue" : "Due", t.due_at ? <span className={cn("tabular-nums", t.overdue && "text-danger")}>{formatDateTime(t.due_at, tz)}</span> : "No date")}
          {fact(<Hourglass className="size-4" aria-hidden />, "Estimated", durationLabel(t.estimate_minutes) || "Not set")}
          {fact(<Timer className="size-4" aria-hidden />, "Tracked", t.tracked_seconds ? formatDuration(t.tracked_seconds) : "Nothing yet")}
          {fact(<Users className="size-4" aria-hidden />, "Team", t.team_name ?? "No team")}
        </div>
        {detail?.comments.length ? (
          <div>
            <p className="eyebrow mb-1">Latest in the discussion</p>
            <ul className="space-y-2">{detail.comments.map((c) => <li key={c.id} className="text-sm"><span className="text-fg-subtle">{c.author_name}, {formatDateTime(c.created_at, tz)}</span><p className="whitespace-pre-wrap text-fg-muted">{c.body}</p></li>)}</ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="link-action mr-auto"><ExternalLink className="size-3.5" aria-hidden />Open the full task{detail ? ` (${detail.submissions} revision${detail.submissions === 1 ? "" : "s"}, ${detail.sessions} session${detail.sessions === 1 ? "" : "s"})` : ""}</Link>
          {mine && t.status !== "completed" && t.status !== "in_review" ? <PickUpTask orgSlug={orgSlug} taskId={t.id} running={running} anyRunning={anyRunning} /> : null}
          {!mine && isMe && ["todo", "in_progress", "blocked"].includes(t.status) ? <MarkDone orgSlug={orgSlug} taskId={t.id} /> : null}
          {!mine && !isMe && t.status !== "completed" ? <Link href={`/app/${orgSlug}/messages?to=${t.assignee_membership_id}&task=${t.id}`}><Button size="sm" variant="outline"><MessageSquareText className="size-4" aria-hidden />Ask for an update</Button></Link> : null}
          {detail?.canManage && t.status !== "in_progress" ? <IconButton aria-label="Delete task" className="size-9 text-danger hover:text-danger" onClick={() => setConfirm("delete")}><Trash2 className="size-4" aria-hidden /></IconButton> : null}
        </div>
      </div>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete this task?" description="It leaves every list. Its history is kept, and nothing can be started on it again." confirmLabel="Delete" onConfirm={async () => { await api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: t.version, archive: true }, retries: 0 }); successToast("Task deleted"); onClose(); router.refresh(); }} />
    </dialog>
  );
}

/** Organisation accounts do not run timers; they finish a task handed to them with one press. */
export function MarkDone({ orgSlug, taskId }: { orgSlug: string; taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={async () => { setPending(true); setError(null); try { await api(`/api/orgs/${orgSlug}/tasks/${taskId}/complete`, { method: "POST", body: { note: "" } }); successToast("Marked done"); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>{pending ? "Saving…" : "Mark done"}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/** Staff pick a task up: the timer starts on it and My Day opens with the clock running. */
export function PickUpTask({ orgSlug, taskId, running, anyRunning }: { orgSlug: string; taskId: string; running: boolean; anyRunning: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (running) return <Link href={`/app/${orgSlug}/my-day`} className="link-action">Open the clock</Link>;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={pending} data-tip={anyRunning ? "Your timer is on another task; this switches it here" : undefined} onClick={async () => {
        setPending(true); setError(null);
        try {
          if (anyRunning) {
            const cur = await api<{ session: { id: string; version: number } | null }>(`/api/orgs/${orgSlug}/sessions/current`);
            if (cur.session) await api(`/api/orgs/${orgSlug}/sessions/${cur.session.id}/switch`, { method: "POST", body: { expectedVersion: cur.session.version, nextTaskId: taskId, captureMode: "none" } });
            else await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId, captureMode: "none" } });
          } else {
            await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId, captureMode: "none" } });
          }
          router.push(`/app/${orgSlug}/my-day`);
        } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); setPending(false); }
      }}><Play className="size-3.5" aria-hidden />{pending ? "Starting…" : anyRunning ? "Switch to this" : "Start"}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}
