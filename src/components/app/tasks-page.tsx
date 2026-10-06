"use client";

/**
 * Tasks, v4: the list as a calm table (no lines, 48px rows, title 14/20 semibold with a 13px meta line, status as a
 * small badge, a quiet progress arc), a search box and filter controls in a toolbar row, and a quiet bar for the ticked
 * rows. Every task opens in a right-hand sheet (owner decision, 26 September 2026: a pop-up for the rest); creating,
 * reassigning and the task's details are sheets too.
 *
 * Accent rules (owner decision, 6 October 2026): the running task is orange (its "Working now" badge and its arc); the
 * other arcs stay quiet. On your own list only the next to-do's Start is the orange standout; every other row has a
 * quiet ghost Start (polish: a white Start on every row was too loud). An overdue date is a small red dot beside the
 * word, never red text.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, Plus, X, ArrowLeftRight, MessageSquareText, Trash2, UserRoundCheck, ArrowUpRight, Search, Video } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton, ICON_BUTTON } from "@/components/ui/icon-button";
import { Input, InputAdorned, Select, Textarea, Field } from "@/components/ui/input";
import { Alert, Skeleton } from "@/components/ui/states";
import { Badge, CountPill, TASK_STATUS_TONE, label, taskStatusLabel } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { Person } from "@/components/ui/person";
import { Avatar } from "@/components/ui/avatar";
import { Presence } from "@/components/ui/motion";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationPicker, durationLabel } from "@/components/ui/duration-picker";
import { ProgressArc } from "@/components/ui/progress-arc";
import { successToast } from "@/components/ui/toast";
import { ProgressSlider } from "@/components/app/progress-slider";
import { DetailList, DetailRow } from "@/components/app/detail-list";
import { DueDate, OverdueDot } from "@/components/app/due";
import { api, isApiFailure } from "@/lib/api-client";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import type { TaskListRow } from "@/server/services/views";

type Person = { id: string; display_name: string; team_name: string | null; group: "team" | "organisation" };

/** The confirming toast lives in components/ui/toast; re-exported for older imports. */
export { successToast };

const statusLabel = taskStatusLabel;
/** Statuses the person holding a task can still finish from a list. */
const OPEN = ["todo", "in_progress", "blocked"];
/** A 40px target around a 16px checkbox; the negative margin keeps the row's layout as it is. */
const HIT = "-m-3 inline-grid size-10 cursor-pointer place-items-center align-middle";
/** A row's title as a button that opens the task: the whole row is its target, the focus ring drawn round the row. */
const ROW_TARGET = "outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]";

/** A team lead or organisation account creates a task and hands it to someone. Opens as a sheet; the assignee is notified. */
type ProjectOption = { id: string; name: string };

export function NewAssignedTask({ orgSlug, people, self, selfName, canKeep = true, projects = [] }: { orgSlug: string; people: Person[]; self: string; selfName: string; canKeep?: boolean; projects?: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The Tasks page's one standout action for whoever hands out work (accent rules, 6 October 2026). */}
      <Button size="sm" variant="accent" onClick={() => setOpen(true)} aria-haspopup="dialog"><Plus aria-hidden />New task</Button>
      {open ? <NewTaskSheet orgSlug={orgSlug} people={people} self={self} selfName={selfName} canKeep={canKeep} projects={projects} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewTaskSheet({ orgSlug, people, self, selfName, canKeep, projects, onClose }: { orgSlug: string; people: Person[]; self: string; selfName: string; canKeep: boolean; projects: ProjectOption[]; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const others = people.filter((p) => p.id !== self);
  return (
    <Sheet open onClose={onClose} dismissible={false} title="New task" description="Say what needs doing and who should do it. They are notified and see it under their tasks."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Creating…" : "Create and assign"}</Button></>}>
      <form id={formId} className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true); setError(null); setFieldErrors({});
        try {
          const assignee = String(f.get("assigneeMembershipId") || self);
          await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: {
            title: f.get("title"), description: String(f.get("description") ?? "").trim() || null, assigneeMembershipId: assignee,
            dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null,
            estimateMinutes: f.get("estimateMinutes") ? Number(f.get("estimateMinutes")) : null, priority: f.get("priority") ?? "normal", projectId: f.get("projectId") || null } });
          const who = assignee === self ? "you" : (people.find((p) => p.id === assignee)?.display_name ?? "them");
          successToast(`Task assigned to ${who}`, assignee === self ? undefined : "They have been notified.");
          onClose(); router.refresh();
        } catch (err) {
          if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server. Check your connection and try again.");
        } finally { setPending(false); }
      }}>
        {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
        <Field className="sm:col-span-2" label="What needs doing" htmlFor="nt-title" error={fieldErrors.title}><Input id="nt-title" name="title" required maxLength={200} placeholder="e.g. Redo the homepage banner" autoFocus /></Field>
        <Field className="sm:col-span-2" label="Details" htmlFor="nt-desc" hint="Optional: what a finished result looks like" error={fieldErrors.description}><Textarea id="nt-desc" name="description" maxLength={4000} className="min-h-20" /></Field>
        <Field className="sm:col-span-2" label="Assign to" htmlFor="nt-who" error={fieldErrors.assigneeMembershipId}>
          <Select id="nt-who" name="assigneeMembershipId" defaultValue={others.find((p) => p.group === "team")?.id ?? (canKeep ? self : others[0]?.id)}>
            <optgroup label={canKeep ? "Your team" : "Staff and team leads"}>
              {others.filter((p) => p.group === "team").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}
              {canKeep ? <option value={self}>{selfName} (me)</option> : null}
            </optgroup>
            {others.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{others.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
          </Select>
        </Field>
        {projects.length ? <Field className="sm:col-span-2" label="Project" htmlFor="nt-project" hint="Where the task is filed" error={fieldErrors.projectId}><Select id="nt-project" name="projectId" defaultValue=""><option value="">The person&apos;s team project (automatic)</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field> : null}
        <Field label="Priority" htmlFor="nt-pri"><Select id="nt-pri" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        <Field label="Estimated time" htmlFor="nt-est" hint="Optional" error={fieldErrors.estimateMinutes}><DurationPicker id="nt-est" name="estimateMinutes" /></Field>
        <Field className="sm:col-span-2" label="Due" htmlFor="nt-due" hint="Optional" error={fieldErrors.dueAt}><DatePicker mode="datetime" id="nt-due" name="dueAt" /></Field>
      </form>
    </Sheet>
  );
}

// ---- The list (owner decision, 26 September 2026): face, task, person, date, status, one icon; a sheet for the rest ----

export type TaskViewer = { membershipId: string; displayName: string; role: string; timezone: string };

/** The bar that appears while rows are ticked: how many, what can be done with them, and Clear. */
function SelectionBar({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border bg-fill-0 py-1.5 pl-3 pr-1.5 text-sm">
      <span className="mr-1 font-medium tabular-nums">{count} selected</span>
      {children}
    </div>
  );
}

export function TaskTable({ orgSlug, rows, viewer, mine, runningTaskId, people, canBulk, toolbar }: { orgSlug: string; rows: TaskListRow[]; viewer: TaskViewer; mine: boolean; runningTaskId: string | null; people: { id: string; display_name: string }[]; canBulk: boolean;
  /** Filter controls shown after the search box (the page's Person filter). */ toolbar?: React.ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [peek, setPeek] = useState<TaskListRow | null>(null);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [reassign, setReassign] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const head = useRef<HTMLInputElement>(null);
  // The search narrows what is on this page as you type: the task, the person, the project or the team.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.title, r.assignee_name, r.created_by_name, r.project_name, r.team_name].some((v) => v?.toLowerCase().includes(q)));
  }, [rows, query]);
  const ids = visible.map((r) => r.id);
  const chosen = ids.filter((id) => selected.has(id));
  const all = chosen.length > 0 && chosen.length === ids.length;
  useEffect(() => { if (head.current) head.current.indeterminate = chosen.length > 0 && !all; }, [chosen.length, all]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // The action column is wide enough for a worded button (Start, Mark done, Open the clock) only when a row has one.
  const wideAction = mine || rows.some((r) => r.assignee_membership_id === viewer.membershipId && OPEN.includes(r.status));
  // Your next to-do (nothing running): the first one already started, else the first waiting to start. Its Start is
  // the screen's one orange button; the rest are quiet.
  const nextId = mine && !runningTaskId ? (visible.find((r) => r.status === "in_progress") ?? visible.find((r) => r.status === "todo"))?.id ?? null : null;
  const bulk = async (body: { action: "archive" | "reassign"; assigneeMembershipId?: string }) => {
    setPending(true); setError(null);
    try {
      const r = await api<{ done: number; failed: { title: string; reason: string }[] }>(`/api/orgs/${orgSlug}/tasks/bulk`, { method: "POST", body: { ids: chosen, ...body }, retries: 0 });
      if (r.done) successToast(body.action === "archive" ? `${r.done} task${r.done === 1 ? "" : "s"} deleted` : `${r.done} task${r.done === 1 ? "" : "s"} reassigned`, r.failed.length ? `${r.failed.length} could not be changed.` : undefined);
      if (r.failed.length) setError(r.failed.map((f) => `${f.title}: ${f.reason}`).join(" "));
      setSelected(new Set()); router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again."); }
    finally { setPending(false); }
  };
  const plural = chosen.length === 1 ? "" : "s";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form role="search" className="w-full sm:w-72" onSubmit={(e) => e.preventDefault()}>
          <InputAdorned fieldSize="lg" type="search" aria-label="Search tasks" placeholder="Search tasks" autoComplete="off" value={query}
            prefix={<Search aria-hidden />} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }} />
        </form>
        {toolbar}
        <p className="ml-auto text-meta font-normal tabular-nums text-secondary" aria-live="polite">{query.trim() ? `${visible.length} of ${rows.length}` : `${rows.length} task${rows.length === 1 ? "" : "s"}`}</p>
      </div>
      <Presence show={chosen.length > 0}>
        <SelectionBar count={chosen.length}>
          <Button size="xs" variant="danger" aria-label={`Delete ${chosen.length} task${plural}`} disabled={pending} onClick={() => setConfirm("delete")}><Trash2 aria-hidden />Delete</Button>
          {people.length ? <Button size="xs" variant="secondary" aria-label={`Reassign ${chosen.length} task${plural}`} disabled={pending} onClick={() => setReassign(true)}><UserRoundCheck aria-hidden />Reassign</Button> : null}
          {pending ? <span role="status" className="text-meta text-secondary">Working…</span> : null}
          <IconButton aria-label="Clear selection" className="ml-auto" onClick={() => setSelected(new Set())}><X aria-hidden /></IconButton>
          {error ? <p role="alert" className="basis-full pb-1 text-meta font-medium text-danger">{error}</p> : null}
        </SelectionBar>
      </Presence>
      {reassign ? <ReassignSheet people={people} count={chosen.length} pending={pending} onClose={() => setReassign(false)} onConfirm={async (id) => { await bulk({ action: "reassign", assigneeMembershipId: id }); setReassign(false); }} /> : null}
      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm font-normal text-secondary">No task matches “{query.trim()}”. <button type="button" className="link-inline" onClick={() => setQuery("")}>Clear the search</button></p>
      ) : (
        // The columns follow the room the table has (it sits beside the sidebar from md up): below lg the status moves
        // under the title, below xl the date joins the line under it, so the task's name keeps its width.
        <DataTable caption="Tasks" fit>
          <thead><tr>
            {canBulk ? <th className="w-10"><label className={HIT}><input ref={head} type="checkbox" aria-label="Select every task" checked={all} onChange={() => setSelected(all ? new Set() : new Set(ids))} /></label></th> : null}
            <th>Task</th><th className="hidden w-[180px] xl:table-cell">Due</th><th className="hidden w-[200px] lg:table-cell">Status</th><th className={cn("text-right", wideAction ? "w-[136px]" : "w-[64px]")}><span className="sr-only">Action</span></th>
          </tr></thead>
          <tbody>{visible.map((t) => {
            const running = runningTaskId === t.id;
            const isMe = t.assignee_membership_id === viewer.membershipId;
            const faceId = mine ? t.created_by : t.assignee_membership_id;
            const faceName = mine ? t.created_by_name : t.assignee_name;
            const personName = mine ? (t.created_by === viewer.membershipId ? "You" : t.created_by_name) : (isMe ? "You" : t.assignee_name);
            const badge = running ? <Badge tone="accent" dot>Working now</Badge> : <Badge tone={TASK_STATUS_TONE[t.status]}>{statusLabel(t.status)}</Badge>;
            return (
              <tr key={t.id} className={cn(selected.has(t.id) && "bg-fill-1")}>
                {canBulk ? <td><label className={HIT}><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></label></td> : null}
                <td>
                  <div className="flex items-center gap-3">
                    <div className="hidden shrink-0 sm:block"><Person orgSlug={orgSlug} membershipId={faceId} name={faceName} showName={false} size={28} /></div>
                    <div className="min-w-0">
                      <button type="button" onClick={() => setPeek(t)} aria-haspopup="dialog" className="block max-w-full truncate text-left text-sm font-semibold text-foreground underline-offset-4 hover:underline">{t.title}</button>
                      <p className="truncate text-meta font-normal text-secondary">
                        {personName}
                        {t.due_at ? <span className="xl:hidden">, {t.overdue ? <><OverdueDot className="mr-1" />overdue since</> : "due"} <span className="tabular-nums">{formatDateTime(t.due_at, viewer.timezone)}</span></span> : null}
                        {t.overdue ? <span className="hidden xl:inline">, overdue</span> : null}
                      </p>
                      <div className="mt-1.5 lg:hidden">{badge}</div>
                    </div>
                  </div>
                </td>
                <td className="hidden xl:table-cell">{t.due_at ? <DueDate iso={t.due_at} timeZone={viewer.timezone} overdue={t.overdue} className="text-secondary" /> : <span className="text-subtle">No date</span>}</td>
                <td className="hidden lg:table-cell"><span className="flex items-center gap-2.5">{badge}{t.progress_percent > 0 || t.status === "in_progress" ? <ProgressArc percent={t.progress_percent} size={32} tone={running ? "accent" : "neutral"} /> : null}</span></td>
                <td className="text-right">
                  {mine && t.status !== "completed" && t.status !== "in_review" ? <PickUpTask orgSlug={orgSlug} taskId={t.id} running={running} anyRunning={!!runningTaskId} standout={t.id === nextId} /> : null}
                  {!mine && isMe && OPEN.includes(t.status) ? <MarkDone orgSlug={orgSlug} taskId={t.id} /> : null}
                  {!mine && !isMe && t.status !== "completed" ? <Link href={`/app/${orgSlug}/messages?to=${t.assignee_membership_id}&task=${t.id}`} aria-label="Ask for an update" className={ICON_BUTTON}><MessageSquareText aria-hidden /></Link> : null}
                </td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      )}
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title={`Delete ${chosen.length} task${plural}?`} description="They leave every list. Their history is kept, and nothing can be started on them again." confirmLabel={`Delete ${chosen.length === 1 ? "task" : "tasks"}`} onConfirm={() => bulk({ action: "archive" })} />
      {peek ? <TaskSheet orgSlug={orgSlug} row={peek} viewer={viewer} mine={mine} running={runningTaskId === peek.id} anyRunning={!!runningTaskId} onClose={() => setPeek(null)} /> : null}
    </>
  );
}

/** Who gets the ticked tasks: a searchable list of people, one chosen, then one confirming press. */
function ReassignSheet({ people, count, pending, onClose, onConfirm }: { people: { id: string; display_name: string }[]; count: number; pending: boolean; onClose: () => void; onConfirm: (id: string) => Promise<void> }) {
  const formId = useId();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const list = people.filter((p) => p.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  const name = people.find((p) => p.id === chosen)?.display_name;
  return (
    <Sheet open size="sm" onClose={onClose} title={`Reassign ${count} task${count === 1 ? "" : "s"}`} description="Pick who should hold them. They are notified."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} disabled={!chosen} loading={pending}>{pending ? "Reassigning…" : name ? `Reassign to ${name.split(" ")[0]}` : "Reassign"}</Button></>}>
      <form id={formId} className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (chosen) void onConfirm(chosen); }}>
        <InputAdorned value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" prefix={<Search aria-hidden />} autoFocus />
        <ul role="radiogroup" aria-label="People" className="space-y-0.5">
          {list.length === 0 ? <li className="px-2 py-6 text-center text-sm font-normal text-secondary">Nobody matches.</li> : list.map((p) => (
            <li key={p.id}>
              <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 transition-colors duration-75 hover:bg-fill-1", chosen === p.id && "bg-fill-1")}>
                <input type="radio" name="assignee" value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} />
                <Avatar profileId={p.id} name={p.display_name} size={28} />
                <span className="truncate text-sm font-medium">{p.display_name}</span>
              </label>
            </li>
          ))}
        </ul>
      </form>
    </Sheet>
  );
}

/** What a page must know to open the sheet: the id and title; anything else it has shows straight away, the rest loads. */
export type TaskPeek = { id: string; title: string } & Partial<TaskListRow>;

type Detail = { task: TaskListRow & { expected_output: string }; comments: { id: string; body: string; created_at: string; author_name: string }[]; history: { from_status: string | null; to_status: string; reason: string | null; occurred_at: string; actor_name: string | null }[]; canManage: boolean; submissions: number; sessions: number };

/** The sheet for a task: everything the row leaves out, and the actions on it. Loads the details on open. */
export function TaskSheet({ orgSlug, row, viewer, mine = false, running = false, anyRunning = false, onClose }: { orgSlug: string; row: TaskPeek; viewer: TaskViewer; mine?: boolean; running?: boolean; anyRunning?: boolean; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<Detail>(`/api/orgs/${orgSlug}/tasks/${row.id}`).then((d) => { if (alive) setDetail(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [orgSlug, row.id]);
  const t: TaskPeek = detail?.task ?? row;
  const isMe = t.assignee_membership_id === viewer.membershipId;
  const tz = viewer.timezone;
  const overdue = t.overdue ?? (!!t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed");
  const status = t.status ?? "todo";
  const priority = t.priority ?? "normal";
  const shownProgress = progress ?? t.progress_percent ?? 0;
  const canSetProgress = isMe && !["completed", "in_review"].includes(status) && !!detail;
  const saveProgress = async (value: number) => {
    if (!detail) return;
    setSavingProgress(true); setActionError(null);
    try { const r = await api<{ version: number }>(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: detail.task.version, progressPercent: value }, retries: 0 }); setDetail({ ...detail, task: { ...detail.task, version: r.version, progress_percent: value } }); router.refresh(); }
    catch (err) { setProgress(null); setActionError(isApiFailure(err) ? `Progress not saved. ${err.error.message}` : "Progress not saved: cannot reach the server. Try again."); }
    finally { setSavingProgress(false); }
  };
  const remove = async () => {
    setActionError(null);
    try { await api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: detail?.task.version ?? t.version, archive: true }, retries: 0 }); successToast("Task deleted"); onClose(); router.refresh(); }
    catch (err) { setActionError(isApiFailure(err) ? err.error.message : "Cannot reach the server. The task was not deleted; try again."); }
  };
  const footer = (
    <>
      <Link href={`/app/${orgSlug}/tasks/${t.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mr-auto h-auto min-h-8 whitespace-normal py-1.5 text-left")}>
        Open the full task{detail ? ` (${detail.submissions} revision${detail.submissions === 1 ? "" : "s"}, ${detail.sessions} session${detail.sessions === 1 ? "" : "s"})` : ""}<ArrowUpRight aria-hidden />
      </Link>
      {detail?.canManage && status !== "in_progress" ? <IconButton aria-label="Delete task" className="hover:text-danger" onClick={() => setConfirm("delete")}><Trash2 aria-hidden /></IconButton> : null}
      {!mine && !isMe && t.assignee_membership_id && status !== "completed" ? <Link href={`/app/${orgSlug}/messages?to=${t.assignee_membership_id}&task=${t.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><MessageSquareText aria-hidden />Ask for an update</Link> : null}
      {mine && status !== "completed" && status !== "in_review" ? <PickUpTask orgSlug={orgSlug} taskId={t.id} running={running} anyRunning={anyRunning} standout /> : null}
      {!mine && isMe && OPEN.includes(status) ? <MarkDone orgSlug={orgSlug} taskId={t.id} /> : null}
    </>
  );
  // The confirm sits beside the sheet, not inside it: React passes a dialog's close and cancel events up its tree, so a
  // confirm nested in the sheet would close the sheet too when it is dismissed.
  return (
    <>
    <Sheet open onClose={onClose} title={t.title} description={t.project_name ?? "Task"} footer={footer}>
      <div className="grid gap-6">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={running ? "accent" : TASK_STATUS_TONE[status]} dot={running}>{running ? "Working now" : statusLabel(status)}</Badge>
          {priority !== "normal" ? <Badge tone={priority === "urgent" ? "danger" : priority === "high" ? "warning" : "neutral"}>{label(priority)} priority</Badge> : null}
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </p>
        {(t.assignee_membership_id && t.assignee_name) || (t.created_by && t.created_by_name && t.created_by !== t.assignee_membership_id) ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {t.assignee_membership_id && t.assignee_name ? <Person orgSlug={orgSlug} membershipId={t.assignee_membership_id} name={t.assignee_name} size={32} meta={isMe ? "Holds this task (you)" : "Holds this task"} you={isMe} /> : null}
            {t.created_by && t.created_by_name && t.created_by !== t.assignee_membership_id ? <Person orgSlug={orgSlug} membershipId={t.created_by} name={t.created_by_name} size={32} meta="Handed it out" you={t.created_by === viewer.membershipId} /> : null}
          </div>
        ) : null}
        <section aria-label="What a finished result looks like">
          <h3 className="mb-1.5 text-sm font-semibold text-foreground">What a finished result looks like</h3>
          {detail ? <p className="whitespace-pre-wrap text-sm font-normal text-secondary">{detail.task.expected_output}</p> : failed ? <p role="alert" className="text-sm font-normal text-danger">Could not load the details. Open the full task instead.</p> : <div role="status" aria-label="Loading the details" className="space-y-2 pt-1"><Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-3/4" /></div>}
          {t.blocked_reason ? <Alert tone="danger" title="Blocked" className="mt-3">{t.blocked_reason}</Alert> : null}
        </section>
        {shownProgress > 0 || canSetProgress || status === "in_progress" ? (
          <div className="flex items-center gap-4 rounded-xl bg-fill-0 p-4">
            <ProgressArc percent={shownProgress} size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">How far along</p>
              {canSetProgress ? <ProgressSlider className="mt-1" value={shownProgress} disabled={savingProgress} onChange={setProgress} onCommit={(v) => void saveProgress(v)} />
                : <p className="text-meta font-normal text-secondary">{shownProgress >= 100 ? "Finished" : `${shownProgress}% done, by the person holding it`}</p>}
            </div>
          </div>
        ) : null}
        <DetailList>
          <DetailRow label={overdue ? "Overdue" : "Due"}>{t.due_at ? <DueDate iso={t.due_at} timeZone={tz} overdue={overdue} srLabel={false} /> : <span className="text-secondary">No date</span>}</DetailRow>
          <DetailRow label="Estimated">{durationLabel(t.estimate_minutes) || <span className="text-secondary">Not set</span>}</DetailRow>
          <DetailRow label="Tracked">{t.tracked_seconds ? <span className="tabular-nums">{formatDuration(t.tracked_seconds)}</span> : <span className="text-secondary">Nothing yet</span>}</DetailRow>
          <DetailRow label="Team">{t.team_name ?? <span className="text-secondary">No team</span>}</DetailRow>
        </DetailList>
        {detail?.comments.length ? (
          <section aria-labelledby={`${t.id}-latest`}>
            {/* Replying happens on the full task, whose discussion opens straight away from this link. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3"><h3 id={`${t.id}-latest`} className="text-sm font-semibold text-foreground">Latest in the discussion</h3><Link href={`/app/${orgSlug}/tasks/${t.id}?panel=comments`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Reply</Link></div>
            <ul className="space-y-3">{detail.comments.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-meta font-normal text-secondary"><span className="font-medium text-foreground">{c.author_name}</span>, <time dateTime={c.created_at} className="tabular-nums">{formatDateTime(c.created_at, tz)}</time></p>
                <p className="mt-0.5 whitespace-pre-wrap font-normal text-secondary">{c.body}</p>
              </li>
            ))}</ul>
          </section>
        ) : null}
        {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      </div>
    </Sheet>
    <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete this task?" description="It leaves every list. Its history is kept, and nothing can be started on it again." confirmLabel="Delete task" onConfirm={remove} />
    </>
  );
}

/** Organisation accounts do not run timers; they finish a task handed to them with one press. */
export function MarkDone({ orgSlug, taskId }: { orgSlug: string; taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={async () => { setPending(true); setError(null); try { await api(`/api/orgs/${orgSlug}/tasks/${taskId}/complete`, { method: "POST", body: { note: "" } }); successToast("Marked done"); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again."); } finally { setPending(false); } }}>{pending ? "Saving…" : "Mark done"}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-meta font-medium text-danger">{error}</p> : null}
    </div>
  );
}

/**
 * Staff pick a task up: the timer starts on it and My Day opens with the clock running. `standout`: the screen's one
 * orange Start (the next to-do on a list, the task open in a sheet); otherwise a quiet ghost Start, so a list of them
 * stays calm. While another task runs it is a switch icon button.
 */
export function PickUpTask({ orgSlug, taskId, running, anyRunning, standout = false }: { orgSlug: string; taskId: string; running: boolean; anyRunning: boolean; standout?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (running) return <Link href={`/app/${orgSlug}/my-day`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open the clock</Link>;
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button size={anyRunning ? "icon-sm" : "sm"} variant={anyRunning ? "ghost" : standout ? "accent" : "ghost"} disabled={pending} data-tip={anyRunning ? "Your timer is on another task; this switches it here" : undefined} onClick={async () => {
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
        } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again."); setPending(false); }
      }} aria-label={anyRunning ? "Switch the timer to this task" : undefined}>{anyRunning ? <ArrowLeftRight aria-hidden /> : <><Play aria-hidden />{pending ? "Starting…" : "Start"}</>}</Button>
      {error ? <p role="alert" className="max-w-xs text-right text-meta font-medium text-danger">{error}</p> : null}
    </div>
  );
}

// ---- Task rows, cards and links for other pages (owner decision, 26 September 2026): every task opens as a sheet ----

/** A row in a list (see components/ui/rows.tsx) whose task opens the sheet instead of a page. Put it in a <ul>. */
export function TaskRow({ orgSlug, task, viewer, leading, meta, trailing, mine, running, anyRunning, className }: { orgSlug: string; task: TaskPeek; viewer: TaskViewer; leading?: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode; mine?: boolean; running?: boolean; anyRunning?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-none">
      <div className={cn("relative flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-75 hover:bg-fill-1", className)}>
        {leading ? <div className="relative z-[1] shrink-0">{leading}</div> : null}
        <button type="button" onClick={() => setOpen(true)} className={cn("min-w-0 flex-1 text-left", ROW_TARGET)} aria-haspopup="dialog">
          <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
          {meta ? <p className="truncate text-meta font-normal text-secondary">{meta}</p> : null}
        </button>
        {trailing ? <div className="shrink-0 text-right text-meta font-normal tabular-nums text-secondary">{trailing}</div> : null}
      </div>
      {open ? <TaskSheet orgSlug={orgSlug} row={task} viewer={viewer} mine={mine} running={running} anyRunning={anyRunning} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

/**
 * A task as a card on a board (projects, teams): r12, the canvas colour, a hairline that firms up on hover. The title
 * (two lines at most) opens the sheet; `meta` is a 13px line under it; `footer` a row at the bottom (a face, a date).
 * Put it in a <ul>.
 */
export function TaskCard({ orgSlug, task, viewer, meta, footer, mine, running, anyRunning, className }: { orgSlug: string; task: TaskPeek; viewer: TaskViewer; meta?: React.ReactNode; footer?: React.ReactNode; mine?: boolean; running?: boolean; anyRunning?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-none">
      <div className={cn("relative rounded-xl border border-border bg-background p-3 shadow-natural-xs transition-colors duration-75 hover:border-border-input-hover", className)}>
        <button type="button" onClick={() => setOpen(true)} className={cn("line-clamp-2 w-full break-words text-left text-sm font-semibold text-foreground", ROW_TARGET)} aria-haspopup="dialog">{task.title}</button>
        {meta ? <div className="mt-1 text-meta font-normal text-secondary">{meta}</div> : null}
        {footer ? <div className="mt-3 flex min-w-0 items-center gap-2 text-meta font-normal text-secondary">{footer}</div> : null}
      </div>
      {open ? <TaskSheet orgSlug={orgSlug} row={task} viewer={viewer} mine={mine} running={running} anyRunning={anyRunning} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

/** The board's columns, in the order work moves through them; each with a small dot (orange while in progress). */
const COLUMNS: { status: string; dot: string }[] = [
  { status: "todo", dot: "bg-subtle" }, { status: "in_progress", dot: "bg-accent" }, { status: "blocked", dot: "bg-danger" },
  { status: "in_review", dot: "bg-warning" }, { status: "completed", dot: "bg-success" },
];

/** Time on a task's card: "1h 10m of 4h 00m tracked", "1h 10m tracked" or "4h 00m estimated"; nothing when neither. */
const timeNote = (tracked: number | undefined, estimateMinutes: number | null | undefined) => {
  const est = estimateMinutes ? formatDuration(estimateMinutes * 60) : null;
  if (tracked) return `${formatDuration(tracked)}${est ? ` of ${est}` : ""} tracked`;
  return est ? `${est} estimated` : "";
};

/**
 * A board of tasks (projects and teams, v4): calm columns, one per status, each a fill-0 r16 lane with its name and a
 * count, the tasks as cards in it. The lanes stack on a phone and sit side by side from md (scrolling sideways inside
 * the board when there is not room for all five). `overdue` comes from the server, so the page and the browser agree.
 * `showProject` adds the project to each card (a team's tasks come from several); `recordings` counts screen
 * recordings per task.
 */
export function TaskBoard({ orgSlug, tasks, viewer, showProject = false, recordings = {}, label: boardLabel = "Tasks by status" }: {
  orgSlug: string; tasks: (TaskPeek & { status: string; assignee_membership_id: string; assignee_name: string; overdue: boolean })[]; viewer: TaskViewer;
  showProject?: boolean; recordings?: Record<string, number>; label?: string;
}) {
  return (
    <div role="group" aria-label={boardLabel} className="grid gap-3 md:auto-cols-[minmax(13.5rem,1fr)] md:grid-flow-col md:overflow-x-auto md:pb-1">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.status);
        const headingId = `board-${col.status}`;
        return (
          <section key={col.status} aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-2xl bg-fill-0 p-2">
            <h3 id={headingId} className="flex h-8 items-center gap-2 px-2 text-sm font-medium text-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", col.dot)} aria-hidden />{statusLabel(col.status)}<CountPill count={items.length} showZero className="ml-auto" />
            </h3>
            {items.length === 0 ? <p className="px-2 pb-4 pt-3 text-center text-meta font-normal text-subtle">Nothing here</p> : (
              <ul className="mt-1 space-y-2">
                {items.map((t) => {
                  const note = timeNote(t.tracked_seconds, t.estimate_minutes);
                  const recs = recordings[t.id] ?? 0;
                  const meta = [showProject ? t.project_name : null, note || null, t.archived_at ? "Deleted" : null].filter(Boolean).join(", ");
                  return (
                    <TaskCard key={t.id} orgSlug={orgSlug} viewer={viewer} task={t} className={t.archived_at ? "opacity-60" : undefined}
                      meta={t.blocked_reason || meta || recs ? <>
                        {t.blocked_reason ? <span className="block text-danger">Blocked: {t.blocked_reason}</span> : null}
                        {meta ? <span className="block">{meta}</span> : null}
                        {recs ? <span className="flex items-center gap-1"><Video className="size-3.5" aria-hidden />{recs} recording{recs === 1 ? "" : "s"}</span> : null}
                      </> : undefined}
                      footer={<>
                        <Avatar profileId={t.assignee_membership_id} name={t.assignee_name} size={20} />
                        <span className="min-w-0 flex-1 truncate">{t.assignee_membership_id === viewer.membershipId ? "You" : t.assignee_name}</span>
                        {t.due_at ? t.overdue ? <DueDate iso={t.due_at} timeZone={viewer.timezone} overdue className="shrink-0" /> : <span className="shrink-0 tabular-nums"><span className="sr-only">Due </span>{formatDateTime(t.due_at, viewer.timezone)}</span> : null}
                      </>} />
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A task's name anywhere else (a table cell, a card): looks like a link, opens the sheet. */
export function TaskPeekLink({ orgSlug, task, viewer, className, children, mine, running, anyRunning }: { orgSlug: string; task: TaskPeek; viewer: TaskViewer; className?: string; children?: React.ReactNode; mine?: boolean; running?: boolean; anyRunning?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("text-left font-semibold underline-offset-4 hover:underline", className)} aria-haspopup="dialog">{children ?? task.title}</button>
      {open ? <TaskSheet orgSlug={orgSlug} row={task} viewer={viewer} mine={mine} running={running} anyRunning={anyRunning} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
