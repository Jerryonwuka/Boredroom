"use client";

/**
 * The staff page: "Your to-dos for today". Add a to-do (the "+" opens a row to type or dictate in), press Start (with
 * or without screen recording), press Mark done when finished. That sends the work to the person who checks it; it
 * shows as "Sent for check" and then "Completed". A finished to-do never offers Start again.
 *
 * No clock-in card and no idle clock here (owner decision, 5 October 2026): clocking in has its own page and Brenda's
 * page shows your clock. The timer card appears only while something is on the clock.
 *
 * v4: the timer as a stat card, the to-dos under underline tabs with counts, rows of 56px (title 14/20 semibold, meta
 * 13px secondary, a small status badge, a quiet progress arc), no lines between them. A to-do opens in a right-hand
 * sheet.
 *
 * Accent rules (owner decision, 6 October 2026): orange marks what is live and the one thing to do. The running to-do
 * (its "Working now" badge and its arc), the timer (dot, digits, progress), the tabs' underline, and in a to-do's sheet
 * its Start, the standout action. Every other arc on the list is quiet (`tone="neutral"`); an overdue date is a small red
 * dot beside the word, never red text.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Check, ChevronRight, X, Trash2, ArrowUpRight, Play, Mic, CircleCheck, ListTodo } from "lucide-react";
import { EditButton } from "@/components/ui/edit-button";
import { Avatar } from "@/components/ui/avatar";
import { SessionTimer, type CurrentSessionPayload, type StartableTask } from "@/components/app/session-timer";
import { CaptureProvider, useCaptureGate, useCaptureContext, useCaptureSupported } from "@/components/app/capture";
import { VoiceCapture } from "@/components/app/voice-capture";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { ProgressSlider } from "@/components/app/progress-slider";
import { DetailList, DetailRow } from "@/components/app/detail-list";
import { DueDate, OverdueDot } from "@/components/app/due";
import { useDictation } from "@/hooks/use-dictation";
import { Presence } from "@/components/ui/motion";
import { Tabs } from "@/components/ui/tabs";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ProgressArc } from "@/components/ui/progress-arc";
import { DurationPicker } from "@/components/ui/duration-picker";
import { successToast } from "@/components/ui/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, CountPill } from "@/components/ui/badge";
import { Card, CardHeader, SectionTitle } from "@/components/ui/card";
import { Input, Select, Field } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Alert, EmptyState } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { cn, formatDuration, formatDateTime } from "@/lib/utils";
import type { TaskRow } from "@/server/services/views";
import type { SessionView } from "@/server/services/sessions";
import type { PlanResult, ProposedTodo } from "@/server/services/assistant";
import { DatePicker } from "@/components/ui/date-picker";

type PastTask = { id: string; title: string; status: string; completed_at: string | null; archived_at: string | null; tracked_seconds: number; created_by_name: string; self_made: boolean };
type Person = { id: string; display_name: string; team_name?: string; group?: "team" | "organisation" };
type Row = TaskRow & { created_by_name?: string };

type Props = {
  orgSlug: string; today: string; initialSession: CurrentSessionPayload;
  planned: TaskRow[]; ownTodos: TaskRow[]; fromLeads: (TaskRow & { created_by_name: string })[]; doneToday: { id: string; title: string; completed_at: string }[]; pastTasks: PastTask[];
  projects: { id: string; name: string }[]; members: Person[];
  /** People this member may hand to-dos to (team leads only; empty for staff). */
  assignable: Person[];
  membershipId: string; recordingMode: string;
  /** Whether Brenda's AI is connected; without it a simple built-in reader drafts dictated to-dos. */
  assistantConfigured: boolean;
  /** The organisation's zone: dates on the list read the same on the server and in the browser, and match other pages. */
  timeZone: string;
  /** The server's clock when the page was read; "overdue" is judged by it until the browser's own clock takes over. */
  serverNow: string;
};

// "Overdue" needs the time now. Read during render it differed between the server and the browser, so the browser's
// clock (to the minute) only takes over after hydration; until then both sides use the server's reading.
const subscribeMinute = (tick: () => void) => { const t = window.setInterval(tick, 60_000); return () => window.clearInterval(t); };
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
function useNow(serverNow: string) {
  return useSyncExternalStore(subscribeMinute, minuteNow, () => Date.parse(serverNow));
}
const isOverdue = (t: { due_at: string | null; status: string }, nowMs: number) => !!t.due_at && Date.parse(t.due_at) < nowMs && t.status !== "completed";

/** The day an instant falls on in the organisation's zone, as yyyy-mm-dd: the calendar the server's "today" is read on. */
function localDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A 40px target around a 16px checkbox; the negative margin keeps the row's layout as it is. */
const HIT = "relative z-[1] -m-3 inline-grid size-10 shrink-0 cursor-pointer place-items-center";

/** A to-do's status as a small badge (none while it simply waits to start). */
function StatusBadge({ t, running }: { t: Row; running: boolean }) {
  if (running) return <Badge tone="accent" dot>Working now</Badge>;
  if (t.status === "in_review") return <Badge tone="warning">Sent for check</Badge>;
  if (t.status === "blocked") return <Badge tone="danger">Blocked</Badge>;
  if (t.status === "in_progress") return <Badge>Started</Badge>;
  return null;
}

export function MyDayBoard(props: Props) {
  return (
    <CaptureProvider orgSlug={props.orgSlug} recordingMode={props.recordingMode} rules={props.initialSession.recording}>
      <Board {...props} />
    </CaptureProvider>
  );
}

const ORDER: Record<string, number> = { in_progress: 0, todo: 1, blocked: 2, in_review: 3, completed: 4 };

function Board({ orgSlug, today, initialSession, planned, ownTodos, fromLeads, doneToday, pastTasks, assignable, membershipId, recordingMode, assistantConfigured, timeZone, serverNow }: Props) {
  const router = useRouter();
  const capture = useCaptureContext();
  const nowMs = useNow(serverNow);
  const captureSupported = useCaptureSupported();
  const [session, setSession] = useState<SessionView | null>(initialSession.session);
  // The new-to-do row: open or not, and a nudge that puts the cursor back in it when "+" is pressed while it is open.
  const [adding, setAdding] = useState(false);
  const [addNudge, setAddNudge] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { captureGate, onSession, dialogEl, recordingControls } = useCaptureGate();
  const recordAfterStart = useRef(false);
  const [tab, setTab] = useState<"todo" | "in_progress" | "upcoming" | "done">("todo");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // One list: everything assigned to me that is not finished, running task first.
  const rows: Row[] = useMemo(() => {
    const seen = new Set<string>();
    const all: Row[] = [];
    for (const t of [...planned, ...fromLeads, ...ownTodos]) { if (!seen.has(t.id)) { seen.add(t.id); all.push(t); } }
    return all.sort((a, b) => (session?.taskId === a.id ? -1 : session?.taskId === b.id ? 1 : (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)));
  }, [planned, fromLeads, ownTodos, session?.taskId]);
  const startable: StartableTask[] = useMemo(() => rows.filter((t) => t.status !== "completed" && t.status !== "in_review" && !t.archived_at).map((t) => ({ id: t.id, title: t.title, project_name: t.project_name, status: t.status, capture_requirement: t.capture_requirement, estimate_minutes: t.estimate_minutes, progress_percent: t.progress_percent, version: t.version })), [rows]);
  // Consent to screen recording is asked once, when a recorded session starts (owner decision, 5 October 2026), so
  // the only conditions here are the organisation's setting and the browser.
  const canRecord = recordingMode !== "disabled" && captureSupported === true;
  // The tabs (owner decision, 28 September 2026): to do, in progress, upcoming (a future date, not started), done.
  // "Future" is the due date's day in the organisation's zone after today there: the UTC date of due_at is a day out
  // for a deadline near midnight away from UTC.
  const groups = useMemo(() => {
    const g = { todo: [] as Row[], in_progress: [] as Row[], upcoming: [] as Row[], done: [] as Row[] };
    for (const t of rows) {
      const future = !!t.due_at && localDay(t.due_at, timeZone) > today;
      if (t.status === "in_review" || t.status === "completed") g.done.push(t);
      else if (t.status === "in_progress" || t.status === "blocked" || session?.taskId === t.id) g.in_progress.push(t);
      else if (future) g.upcoming.push(t);
      else g.todo.push(t);
    }
    return g;
  }, [rows, today, timeZone, session?.taskId]);
  const shown = groups[tab];
  const hasList = rows.length > 0 || doneToday.length > 0;
  const chosen = shown.filter((t) => selected.has(t.id)).map((t) => t.id);
  const openRow = open ? rows.find((t) => t.id === open) ?? null : null;
  const openCount = rows.filter((r) => r.status !== "in_review").length;

  function onSessionChange(s: SessionView | null) {
    setSession(s);
    onSession(s);
    if (s && s.state === "running" && recordAfterStart.current) {
      recordAfterStart.current = false;
      if (s.captureMode !== "none" && capture) void capture.startCapture(s.id);
    }
  }
  async function start(t: Row, record: boolean) {
    setError(null); setNotice(null);
    // "Start and record" asks for consent first, once (owner decision, 5 October 2026); without it the server starts the
    // session unrecorded. Cancel starts nothing. Agreeing opens the screen picker in the same press.
    if (record && capture && !(await capture.ensureConsent())) return;
    recordAfterStart.current = record;
    window.dispatchEvent(new CustomEvent("boredroom:start-task", { detail: { taskId: t.id } }));
  }
  async function done(t: Row) {
    setError(null); setNotice(null);
    try {
      let completed: boolean;
      if (session && session.taskId === t.id) {
        // Running on this task: stop the timer and hand the work over in one step.
        await api(`/api/orgs/${orgSlug}/sessions/${session.id}/stop`, { method: "POST", body: { expectedVersion: session.version, note: "", outcome: "completed" } });
        onSessionChange(null);
        completed = false;
      } else {
        const r = await api<{ completed: boolean }>(`/api/orgs/${orgSlug}/tasks/${t.id}/complete`, { method: "POST", body: {} });
        completed = r.completed;
      }
      setNotice(completed ? `“${t.title}” is completed.` : `“${t.title}” was sent for a check. It shows as Completed once it is approved.`);
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  }
  // "+" opens the row on the To do tab, where a new to-do lands; pressed again, it puts the cursor back in the row.
  function openAdd() {
    if (tab !== "todo") { setTab("todo"); setSelected(new Set()); }
    setAdding(true); setAddNudge((n) => n + 1);
  }
  const toggle = (id: string) => setSelected((sel) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const newRow = adding ? (
    <NewTodoRow orgSlug={orgSlug} assignable={assignable} aiConnected={assistantConfigured} timeZone={timeZone} nudge={addNudge}
      onAdded={(msg) => { setError(null); setNotice(msg); router.refresh(); }}
      onClose={(refocus) => { setAdding(false); if (refocus) requestAnimationFrame(() => addButton.current?.focus()); }} />
  ) : null;
  const emptyLine = tab === "todo" ? "Nothing waiting to start." : tab === "in_progress" ? "Nothing started yet. Press a to-do and Start." : tab === "upcoming" ? "Nothing scheduled. Add a to-do with a future date and it waits here." : "Nothing finished yet today.";

  return (
    <div className="grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <SessionTimer orgSlug={orgSlug} initial={initialSession} tasks={startable} captureDialog={dialogEl} onSessionChange={onSessionChange}
          {...(recordingMode === "disabled" ? {} : { captureGate, recordingControls })} />
        {recordingMode === "disabled" ? <Alert tone="info">Screen recording is switched off for this organisation. An owner can turn it on under Settings, Screen recording.</Alert> : null}
        <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
        <Presence show={!!notice}><Alert tone="success">{notice}</Alert></Presence>

        <section aria-labelledby="todo-heading">
          <SectionTitle id="todo-heading" title="Your to-dos for today" className="mb-3"
            action={<>
              <span className="text-meta font-normal tabular-nums text-secondary">{openCount} open, {doneToday.length} done</span>
              <Button ref={addButton} size="icon-sm" aria-label="Add a to-do" aria-expanded={adding} aria-controls="new-todo" onClick={openAdd}><Plus aria-hidden /></Button>
            </>} />

          {/* The new-to-do row keeps one place in the tree whether or not the list is empty, so the refresh after the
              first to-do is added never remounts it (and never drops drafts still waiting in it). */}
          <div>
            {hasList ? (
              <>
                <Tabs label="To-do status" value={tab} onChange={(v) => { setTab(v as typeof tab); setSelected(new Set()); }} tabs={[
                  { value: "todo", label: "To do", count: groups.todo.length },
                  { value: "in_progress", label: "In progress", count: groups.in_progress.length },
                  { value: "upcoming", label: "Upcoming", count: groups.upcoming.length },
                  { value: "done", label: "Done", count: groups.done.length + doneToday.length },
                ]} />
                <Presence show={chosen.length > 0}>
                  <div className="mt-3 flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border bg-fill-0 py-1.5 pl-3 pr-1.5 text-sm">
                    <span className="mr-1 font-medium tabular-nums">{chosen.length} selected</span>
                    <Button size="xs" variant="danger" aria-label={`Delete ${chosen.length} to-do${chosen.length === 1 ? "" : "s"}`} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden />Delete</Button>
                    <IconButton aria-label="Clear selection" className="ml-auto" onClick={() => setSelected(new Set())}><X aria-hidden /></IconButton>
                  </div>
                </Presence>
              </>
            ) : null}
            {newRow ? <div className={hasList ? "mt-3" : undefined}>{newRow}</div> : null}
            {!hasList ? (newRow ? null : (
              <EmptyState icon={ListTodo} title="Nothing on your list yet"
                description="Write down what you are doing today, or say it and Brenda writes it down, then press Start when you begin."
                action={<Button size="sm" variant="accent" onClick={openAdd}><Plus aria-hidden />Add your first to-do</Button>} />
            )) : (
              <ul className={cn("space-y-0.5", newRow ? "mt-1" : "mt-3")} aria-label="To-dos">
                {shown.length === 0 && !(tab === "done" && doneToday.length) && !(tab === "todo" && adding) ? <li className="px-2 py-10 text-center text-sm font-normal text-secondary">{emptyLine}</li> : null}
                {shown.map((t) => {
                  const running = session?.taskId === t.id;
                  const overdue = isOverdue(t, nowMs);
                  const waiting = t.status === "in_review";
                  return (
                    <li key={t.id} className={cn("relative flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-75 hover:bg-fill-1", selected.has(t.id) && "bg-fill-1")}>
                      {!waiting ? <label className={HIT}><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></label> : <span className="size-4 shrink-0" aria-hidden />}
                      <button type="button" onClick={() => setOpen(t.id)} aria-haspopup="dialog"
                        className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]">
                        <span className="flex min-w-0 items-center gap-2"><span className={cn("truncate text-sm font-semibold", waiting ? "text-secondary" : "text-foreground")}>{t.title}</span><StatusBadge t={t} running={running} /></span>
                        <span className="block truncate text-meta font-normal text-secondary">
                          {t.created_by !== membershipId ? `From ${t.created_by_name ?? "your team lead"}` : "Your own to-do"}
                          {t.due_at ? <>, {overdue ? <><OverdueDot className="mr-1" />overdue since</> : "due"} <span className="tabular-nums">{formatDateTime(t.due_at, timeZone)}</span></> : null}
                        </span>
                      </button>
                      <ProgressArc percent={t.progress_percent} size={36} tone={running ? "accent" : "neutral"} className="relative z-[1]" />
                    </li>
                  );
                })}
                {tab === "done" ? doneToday.map((t) => (
                  <li key={t.id} className="relative flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-75 hover:bg-fill-1">
                    <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                    <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-secondary line-through decoration-faint outline-none after:absolute after:inset-0 after:rounded-xl hover:text-foreground focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]">{t.title}</Link>
                    <span className="shrink-0 text-meta font-normal tabular-nums text-secondary">{formatDateTime(t.completed_at, timeZone)}</span>
                    <Badge tone="success" className="hidden sm:inline-flex">Completed</Badge>
                  </li>
                )) : null}
              </ul>
            )}
          </div>
          <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${chosen.length} to-do${chosen.length === 1 ? "" : "s"}?`} description="They leave your list. Their history is kept." confirmLabel="Delete"
            onConfirm={async () => {
              setError(null); setNotice(null);
              try {
                const r = await api<{ done: number; failed: { title: string; reason: string }[] }>(`/api/orgs/${orgSlug}/tasks/bulk`, { method: "POST", body: { ids: chosen, action: "archive" }, retries: 0 });
                if (r.done) successToast(`${r.done} to-do${r.done === 1 ? "" : "s"} deleted`);
                if (r.failed.length) setError(r.failed.map((f) => `${f.title}: ${f.reason}`).join(" "));
                setSelected(new Set()); router.refresh();
              } catch (err) { setError(isApiFailure(err) ? `Nothing was deleted. ${err.error.message}` : "Nothing was deleted: cannot reach the server. Check your connection and try again."); }
            }} />
          {openRow ? <TodoSheet t={openRow} orgSlug={orgSlug} self={membershipId} running={session?.taskId === openRow.id} anyRunning={!!session} canRecord={canRecord} timeZone={timeZone} nowMs={nowMs}
            onStart={(record) => { setOpen(null); void start(openRow, record); }} onDone={() => { setOpen(null); void done(openRow); }} onSaved={(msg) => { setNotice(msg); router.refresh(); }} onClose={() => setOpen(null)} /> : null}
        </section>

        <PastTasks orgSlug={orgSlug} items={pastTasks} timeZone={timeZone} onCleared={(n) => { setNotice(`${n} past task${n === 1 ? "" : "s"} cleared from your list.`); router.refresh(); }} />
      </div>

      <aside aria-labelledby="how-heading">
        <Card>
          <CardHeader as="h2" size="sm" title={<span id="how-heading">How it works</span>} className="mb-3" />
          <ol className="list-decimal space-y-2 pl-4 text-sm font-normal text-secondary marker:text-subtle">
            <li>Press <strong className="font-medium text-foreground">+</strong> and write your to-dos for today, or dictate them and Brenda writes them down. Your team lead may add some too.</li>
            <li>Press <strong className="font-medium text-foreground">Start</strong> on the one you are working on{canRecord ? ", with or without screen recording" : ""}.</li>
            <li>Press <strong className="font-medium text-foreground">Mark done</strong> when you finish. It goes to your lead for a quick check, then shows as Completed.</li>
            {assignable.length ? <li>As a team lead, use “For” on a new to-do to hand it to someone on your team, or to anyone else in the organisation, or say who it is for when you dictate.</li> : null}
          </ol>
          {/* No daily report to write any more (owner decision, 6 October 2026); say so, since people were used to one. */}
          <p className="mt-4 text-meta font-normal text-secondary">There is no daily report to write: your to-dos and timer are the record your team lead sees.</p>
        </Card>
      </aside>
    </div>
  );
}

/** The to-do in a right-hand sheet: what it is, how far along, and every action on it: start, edit, mark done. */
function TodoSheet({ t, orgSlug, self, running, anyRunning, canRecord, timeZone, nowMs, onStart, onDone, onSaved, onClose }: { t: Row; orgSlug: string; self: string; running: boolean; anyRunning: boolean; canRecord: boolean; timeZone: string; nowMs: number; onStart: (record: boolean) => void; onDone: () => void; onSaved: (msg: string) => void; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [version, setVersion] = useState(t.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overdue = isOverdue(t, nowMs);
  const waiting = t.status === "in_review";
  const shownProgress = progress ?? t.progress_percent;
  const saveProgress = async (value: number) => {
    setSaving(true); setError(null);
    try { const r = await api<{ version: number }>(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: version, progressPercent: value }, retries: 0 }); setVersion(r.version); router.refresh(); }
    catch (err) { setProgress(null); setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setSaving(false); }
  };
  const footer = (
    <>
      <Link href={`/app/${orgSlug}/tasks/${t.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mr-auto")}>Full task and evidence<ArrowUpRight aria-hidden /></Link>
      {waiting ? null : (
        <>
          {!running && !editing ? <EditButton iconOnly label="Edit to-do" onClick={() => setEditing(true)} /> : null}
          {!running && canRecord ? <Button size="sm" variant="secondary" disabled={anyRunning} onClick={() => onStart(true)}><span className="size-2 rounded-full bg-current" aria-hidden />Start and record</Button> : null}
          {/* The sheet's one standout (accent rules): Start on this to-do. */}
          {!running ? <Button size="sm" variant="accent" disabled={anyRunning} onClick={() => onStart(false)}><Play aria-hidden />Start</Button> : null}
          {running || t.status === "in_progress" || t.status === "blocked" ? (confirmDone
            ? <><Button size="sm" variant="ghost" onClick={() => setConfirmDone(false)}>Not yet</Button><Button size="sm" onClick={() => { setConfirmDone(false); onDone(); }}><Check aria-hidden />Yes, mark done</Button></>
            : <Button size="sm" variant={running ? "primary" : "secondary"} onClick={() => setConfirmDone(true)}><Check aria-hidden />Mark done</Button>) : null}
        </>
      )}
      {/* A disabled button cannot show its tooltip, so the reason is said in words. */}
      {!waiting && !running && anyRunning ? <p className="w-full text-right text-meta font-normal text-secondary">Another to-do is on the clock. Stop it, or use Switch task on the timer, to start this one.</p> : null}
    </>
  );
  return (
    <Sheet open onClose={onClose} title={t.title} description={t.created_by !== self ? `From ${t.created_by_name ?? "your team lead"}` : "Your own to-do"} footer={footer}>
      <div className="grid gap-5">
        <p className="flex flex-wrap items-center gap-2">
          {running ? <Badge tone="accent" dot>Working now</Badge> : waiting ? <Badge tone="warning">Sent for check</Badge> : t.status === "blocked" ? <Badge tone="danger">Blocked</Badge> : t.status === "in_progress" ? <Badge>Started</Badge> : <Badge tone="info">To do</Badge>}
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
          {t.capture_requirement === "required" ? <Badge tone="warning">Recording required</Badge> : null}
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {t.blocked_reason ? <Alert tone="danger" title="Blocked">{t.blocked_reason}</Alert> : null}
        <div className="flex items-center gap-4 rounded-xl bg-fill-0 p-4">
          <ProgressArc percent={shownProgress} size={56} tone={running || t.status === "in_progress" ? "accent" : "default"} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">How far along</p>
            {!waiting ? <ProgressSlider className="mt-1" value={shownProgress} disabled={saving} onChange={setProgress} onCommit={(v) => void saveProgress(v)} />
              : <p className="text-meta font-normal text-secondary">Waiting for the check.</p>}
          </div>
        </div>
        <DetailList>
          <DetailRow label={overdue ? "Overdue" : "Due"}>{t.due_at ? <DueDate iso={t.due_at} timeZone={timeZone} overdue={overdue} srLabel={false} /> : <span className="text-secondary">No date</span>}</DetailRow>
          <DetailRow label="Estimated">{t.estimate_minutes ? formatDuration(t.estimate_minutes * 60) : <span className="text-secondary">Not set</span>}</DetailRow>
          <DetailRow label="Tracked">{t.tracked_seconds ? <span className="tabular-nums">{formatDuration(t.tracked_seconds)}</span> : <span className="text-secondary">Nothing yet</span>}</DetailRow>
          <DetailRow label="Project">{t.project_name}</DetailRow>
        </DetailList>
        {editing ? <EditTodo orgSlug={orgSlug} t={{ ...t, version }} onClose={() => setEditing(false)} onSaved={(m) => { setEditing(false); onSaved(m); onClose(); }} /> : null}
      </div>
    </Sheet>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inline edit of a to-do: title, deadline (date and time), estimate. */
function EditTodo({ orgSlug, t, onClose, onSaved }: { orgSlug: string; t: Row; onClose: () => void; onSaved: (msg: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <form className="grid gap-4 rounded-2xl border border-border p-4" aria-label="Edit to-do" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const title = String(f.get("title") ?? "").trim();
      if (!title) { setFieldErrors({ title: ["Give the to-do a name."] }); return; }
      setPending(true); setError(null); setFieldErrors({});
      try {
        await api(`/api/orgs/${orgSlug}/tasks/${t.id}`, { method: "PATCH", body: { expectedVersion: t.version, title, dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))).toISOString() : null, estimateMinutes: f.get("estimate") ? Number(f.get("estimate")) : null } });
        onSaved("To-do updated.");
      } catch (err) {
        if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); }
        else setError("Cannot reach the server. Your changes are still here; try Save again.");
      } finally { setPending(false); }
    }}>
      <p className="text-sm font-semibold text-foreground">Edit to-do</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="To-do" htmlFor={`title-${t.id}`} error={fieldErrors.title}><Input id={`title-${t.id}`} name="title" defaultValue={t.title} required maxLength={200} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Due date and time" htmlFor={`due-${t.id}`} hint="A future date schedules it" error={fieldErrors.dueAt}><DatePicker mode="datetime" id={`due-${t.id}`} name="dueAt" defaultValue={toLocalInput(t.due_at)} /></Field>
        <Field label="Estimated time" htmlFor={`est-${t.id}`} hint="Optional" error={fieldErrors.estimateMinutes}><DurationPicker id={`est-${t.id}`} name="estimate" defaultValue={t.estimate_minutes} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" loading={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

/** Past tasks (owner decision, 28 September 2026): the faces list, five at a time with View all, and one icon to clear. */
function PastTasks({ orgSlug, items, timeZone, onCleared }: { orgSlug: string; items: PastTask[]; timeZone: string; onCleared: (n: number) => void }) {
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 5);
  // The confirm sits beside the <details>, not in it: inside a closed one it would open unseen.
  return (
    <>
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ChevronRight className="size-4 text-secondary transition-transform duration-150 group-open:rotate-90" aria-hidden />
          <span className="type-section-title">Past tasks</span>
          <CountPill count={items.length} />
        </span>
        <span className="flex items-center gap-2">
          <span className="hidden text-meta font-normal text-secondary sm:inline">Completed or removed earlier</span>
          <IconButton aria-label="Clear past tasks" disabled={pending} onClick={(e) => { e.preventDefault(); setConfirm(true); }} className="hover:text-danger"><Trash2 aria-hidden /></IconButton>
        </span>
      </summary>
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      <ul className="mt-2 space-y-0.5">{shown.map((t) => (
        <li key={t.id} className="relative flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-75 hover:bg-fill-1">
          <Avatar profileId={t.id} name={t.self_made ? "You" : t.created_by_name} size={32} />
          <span className="min-w-0 flex-1">
            <Link href={`/app/${orgSlug}/tasks/${t.id}`} className="block truncate text-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]">{t.title}</Link>
            <span className="block truncate text-meta font-normal text-secondary">{t.self_made ? "Your own to-do" : `From ${t.created_by_name}`}{t.tracked_seconds ? `, ${formatDuration(t.tracked_seconds)} tracked` : ""}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="hidden text-meta font-normal tabular-nums text-secondary sm:block">{t.completed_at ? formatDateTime(t.completed_at, timeZone) : t.archived_at ? formatDateTime(t.archived_at, timeZone) : ""}</span>
            {t.status === "completed" ? <Badge tone="success">Completed</Badge> : <Badge tone="info">Removed</Badge>}
          </span>
        </li>
      ))}</ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-meta font-normal text-secondary">Clearing only tidies your list. Records, reports and your team lead&apos;s views keep everything.</p>
        {items.length > 5 ? <Button size="xs" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `View all ${items.length}`}</Button> : null}
      </div>
    </details>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Clear your past tasks?" description="They leave this list. Records, reports and your team lead's views keep everything." confirmLabel="Clear"
        onConfirm={async () => { setPending(true); setError(null); try { const r = await api<{ cleared: number }>(`/api/orgs/${orgSlug}/todos/clear`, { method: "POST", body: {} }); onCleared(r.cleared); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Nothing was cleared: cannot reach the server. Check your connection and try again."); } finally { setPending(false); } }} />
    </>
  );
}

/** "Ada", "Ada and Ben", "Ada, Ben and Chloe". */
const andList = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "For" on a to-do (team leads): the team first, then the rest of the organisation. */
function ForOptions({ people, me = "me" }: { people: Person[]; me?: string }) {
  return (
    <>
      <option value="">For: {me}</option>
      {people.some((p) => p.group !== "organisation") ? <optgroup label="Your team">{people.filter((p) => p.group !== "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}</option>)}</optgroup> : null}
      {people.some((p) => p.group === "organisation") ? <optgroup label="Others in the organisation">{people.filter((p) => p.group === "organisation").map((p) => <option key={p.id} value={p.id}>For: {p.display_name}{p.team_name ? ` (${p.team_name})` : ""}</option>)}</optgroup> : null}
    </>
  );
}

type Draft = ProposedTodo & { keep: boolean };

/**
 * Adding to-dos (owner decision, 5 October 2026). The "+" beside the list's title opens this row at the top of the
 * list, drawn like the rows under it. Type and press Enter: the to-do is added and the row stays open for the next one;
 * Escape or Cancel closes it, and so does leaving it empty. Dictate opens the voice card in the row (the notch's look,
 * components/app/voice-capture); when you stop, Brenda's to-do planner turns your words into to-dos, shown as rows to
 * untick or edit. Nothing is created until Add, and each one goes through the normal to-do endpoint, so assignees are
 * notified the usual way. Dictation runs in the browser or on this computer (hooks/use-dictation); Boredroom uploads
 * no audio. Team leads keep "For", to hand a to-do to someone, and can say who each one is for when dictating.
 */
function NewTodoRow({ orgSlug, assignable, aiConnected, timeZone, nudge, onAdded, onClose }: { orgSlug: string; assignable: Person[]; aiConnected: boolean; timeZone: string; nudge: number; onAdded: (message: string | null) => void;
  /** `refocus`: closed from inside the row (Escape, Cancel), so the focus goes back to "+"; not when the focus left it. */
  onClose: (refocus?: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addAllRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  // type: the box. stopping: the words are being written out after Stop. planning: Brenda is drafting. review: her drafts.
  const [step, setStep] = useState<"type" | "stopping" | "planning" | "review">("type");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  // What was in the box when dictation began: Cancel puts it back.
  const [before, setBefore] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const dictation = useDictation(title, setTitle);
  // Bumped by every Dictate and Cancel, so a stop or a plan that has been overtaken does nothing when it lands.
  const run = useRef(0);
  const planning = useRef<AbortController | null>(null);
  // A press inside the row moves focus out of the box (Safari does not focus buttons); that is not leaving the row.
  const pointerInside = useRef(false);
  const person = assignable.find((p) => p.id === assignee);
  const voice: "listening" | "working" | null = step === "stopping" || step === "planning" || dictation.busy ? "working" : dictation.listening ? "listening" : null;
  const kept = drafts.filter((d) => d.keep && d.title.trim());
  const shownError = error ?? (voice ? null : dictation.error);

  // The cursor goes into the box when the row opens, when "+" is pressed again, and when the row is back to typing.
  useEffect(() => { if (step === "type") inputRef.current?.focus(); }, [step, nudge]);
  useEffect(() => { if (step === "review") addAllRef.current?.focus(); }, [step]);
  useEffect(() => () => planning.current?.abort(), []);
  const refocus = () => requestAnimationFrame(() => inputRef.current?.focus());

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || pending) return;
    setPending(true); setError(null);
    try {
      await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: t, assigneeMembershipId: assignee || null } });
      setTitle("");
      setAnnounce(`Added “${t}”. Type the next one, or press Escape to close.`);
      onAdded(person ? `“${t}” was handed to ${person.display_name}; they have been notified.` : null);
    } catch (err) {
      setError(isApiFailure(err) ? err.error.fieldErrors?.title?.[0] ?? err.error.message : "Cannot reach the server. Your to-do is still here; press Enter to try again.");
    } finally { setPending(false); inputRef.current?.focus(); }
  }

  async function startVoice() {
    run.current++;
    setError(null); setPlan(null); setDrafts([]);
    setBefore(title);
    await dictation.toggle();
  }

  /** Stop: the words are written out, then go to Brenda's planner, which drafts the to-dos. */
  async function stopVoice() {
    const token = ++run.current;
    setStep("stopping");
    const said = await dictation.stop();
    if (token !== run.current) return;
    if (said === null) { setStep("type"); refocus(); return; } // the dictation failed or was cancelled; it says why
    const words = said.trim();
    if (!words || words === before.trim()) { setStep("type"); setError("Nothing was heard. Check the microphone is not muted, then press Dictate again."); refocus(); return; }
    setStep("planning");
    const ctrl = new AbortController();
    planning.current = ctrl;
    try {
      const r = await api<PlanResult>(`/api/orgs/${orgSlug}/assistant/plan`, { method: "POST", body: { text: words }, signal: ctrl.signal });
      if (token !== run.current) return;
      if (!r.items.length) {
        setStep("type");
        setError("Brenda found no to-dos in that. Say one task per sentence, like “Send the Acme invoice by Friday.” Your words are in the box to edit and add as they are.");
        refocus();
        return;
      }
      setPlan(r);
      setDrafts(r.items.map((it) => ({ ...it, keep: true })));
      setStep("review");
      setAnnounce(`Brenda drafted ${r.items.length} to-do${r.items.length === 1 ? "" : "s"}. Untick or edit them, then add.`);
    } catch (err) {
      if (token !== run.current) return;
      setStep("type");
      setError(`${isApiFailure(err) ? err.error.message : "Cannot reach the server."} Your words are in the box: edit them and press Enter, or dictate again.`);
      refocus();
    } finally { if (planning.current === ctrl) planning.current = null; }
  }

  /** Cancel while listening, writing out, drafting or reviewing: nothing is added and the box is as it was. */
  function cancelVoice() {
    const token = ++run.current;
    const restore = before;
    planning.current?.abort();
    // The browser's engine can still deliver its last words for a moment after it stops: put the box back after that.
    if (dictation.listening && dictation.engine === "browser") void dictation.stop().then(() => { if (token === run.current) setTitle(restore); });
    else if (dictation.listening || dictation.busy) dictation.cancel();
    setTitle(restore);
    setPlan(null); setDrafts([]); setStep("type");
    refocus();
  }

  async function addAll() {
    if (!kept.length || pending) return;
    setPending(true); setError(null);
    let n = 0;
    const handed = new Set<string>();
    try {
      for (const d of kept) {
        await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: d.title.trim().slice(0, 200), description: d.description || null, dueAt: d.dueAt, assigneeMembershipId: d.assigneeMembershipId, estimateMinutes: d.estimateMinutes } });
        n++;
        const p = d.assigneeMembershipId ? assignable.find((x) => x.id === d.assigneeMembershipId) : null;
        if (p) handed.add(p.display_name);
      }
      run.current++;
      setTitle(""); setBefore(""); setPlan(null); setDrafts([]); setStep("type");
      onAdded(`${n} to-do${n === 1 ? "" : "s"} added.${handed.size ? ` ${andList([...handed])} ${handed.size === 1 ? "has" : "have"} been notified.` : ""}`);
    } catch (err) {
      // The ones already added leave the review; the rest stay for another try.
      const added = new Set(kept.slice(0, n));
      setDrafts((cur) => cur.filter((d) => !added.has(d)));
      setError(`${n ? `${n} added. ` : ""}${isApiFailure(err) ? err.error.message : "Cannot reach the server."} The rest are still here; press Add to try again.`);
      if (n) onAdded(`${n} to-do${n === 1 ? "" : "s"} added.`);
    } finally { setPending(false); }
  }

  const update = (i: number, patch: Partial<Draft>) => setDrafts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const pct = dictation.progress !== null ? Math.round(dictation.progress * 100) : null;
  const listeningHint = dictation.engine === "whisper"
    ? `${pct !== null ? `Getting dictation ready (${pct}%). Keep talking.` : "Say your to-dos, one per sentence. Press Stop and they are written out on this computer."}${dictation.englishOnly ? " On-device dictation understands English only." : ""}`
    : `Say your to-dos, one per sentence${assignable.length ? ", and who each one is for" : ""}. Press Stop when you are done.`;

  return (
    <div id="new-todo" className={cn("rounded-xl", voice ? "py-0.5" : step === "review" ? "border border-border p-3" : "bg-fill-1 px-3 py-1.5")}
      onPointerDown={() => { pointerInside.current = true; window.addEventListener("pointerup", () => window.setTimeout(() => { pointerInside.current = false; }, 0), { once: true }); }}
      onBlur={(e) => {
        if (pointerInside.current || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (step === "type" && !voice && !pending && !title.trim()) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (voice || step === "review") cancelVoice(); else onClose(true);
      }}>
      {/* Always mounted, so what happened in the row is announced (the voice card announces its own steps). */}
      <p role="status" className="sr-only">{announce}</p>
      {voice ? (
        <VoiceCapture compact phase={voice}
          title={step === "planning" ? "Brenda is writing your to-dos…" : undefined}
          heard={step === "planning" ? title : dictation.heard || null}
          hint={voice === "listening" ? listeningHint : step === "planning" ? "You check them before anything is added." : pct !== null ? `Getting dictation ready… ${pct}%` : undefined}
          onStop={voice === "listening" ? () => void stopVoice() : undefined} onCancel={cancelVoice} />
      ) : step === "review" && plan ? (
        <div className="grid gap-2">
          <p className="flex items-start gap-2.5 text-sm font-normal text-secondary">
            <BrendaGlyph className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
            <span>{plan.reply ?? `Here ${drafts.length === 1 ? "is the to-do" : `are the ${drafts.length} to-dos`} I heard. Untick any you don't want, or edit them, then add.`}</span>
          </p>
          <ul className="space-y-0.5" aria-label="Brenda's drafts">
            {drafts.map((d, i) => {
              const meta = [d.dueAt ? `due ${formatDateTime(d.dueAt, timeZone)}` : null, d.estimateMinutes ? `about ${formatDuration(d.estimateMinutes * 60)}` : null].filter(Boolean).join(", ");
              return (
                <li key={i} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl px-2 py-2 transition-colors duration-75", d.keep && "bg-fill-0")}>
                  <input type="checkbox" checked={d.keep} onChange={(e) => update(i, { keep: e.target.checked })} aria-label={`Add “${d.title.trim() || `to-do ${i + 1}`}”`} className="mt-2" />
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <input value={d.title} onChange={(e) => update(i, { title: e.target.value })} aria-label={`To-do ${i + 1}`} maxLength={200} autoComplete="off"
                      className={cn("w-full border-b border-transparent bg-transparent py-1 text-sm font-semibold text-foreground outline-none transition-colors duration-75 hover:border-border-input focus:border-foreground", !d.keep && "text-subtle line-through")} />
                    {meta ? <p className="text-meta font-normal tabular-nums text-secondary">{meta}</p> : null}
                    {d.unmatchedAssignee ? <p className="text-meta font-normal text-warning">“{d.unmatchedAssignee}” is not someone you can hand to-dos to; choose who this one is for.</p> : null}
                  </div>
                  {assignable.length ? (
                    <Select aria-label={`Who to-do ${i + 1} is for`} fieldSize="sm" className="w-40" value={d.assigneeMembershipId ?? ""} onChange={(e) => update(i, { assigneeMembershipId: e.target.value || null, unmatchedAssignee: null })}><ForOptions people={assignable} /></Select>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {plan.engine === "builtin" && (plan.note || !aiConnected) ? <p className="text-meta font-normal text-secondary">{plan.note ?? "Brenda's AI is not connected yet, so a simple built-in reader drafted these. An owner connects it under Settings."}</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={cancelVoice}>Cancel</Button>
            <Button ref={addAllRef} size="sm" disabled={pending || !kept.length} loading={pending} onClick={() => void addAll()}>{pending ? "Adding…" : kept.length ? `Add ${kept.length} to-do${kept.length === 1 ? "" : "s"}` : "Nothing ticked"}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={add} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
          {/* Where the row's checkbox will be, so the new to-do lines up with the ones under it. */}
          <span aria-hidden className="size-4 shrink-0 rounded-[4px] border border-dashed border-border-input-hover" />
          <input ref={inputRef} value={title} onChange={(e) => { setTitle(e.target.value); if (error) setError(null); if (dictation.error) dictation.clearError(); }} placeholder="What do you need to do?" aria-label="New to-do" maxLength={200} autoComplete="off"
            aria-invalid={shownError ? true : undefined} aria-describedby={shownError ? errorId : undefined}
            className="min-w-0 flex-[1_1_12rem] bg-transparent py-1.5 text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-subtle" />
          {/* Free to shrink and wrap on its own line: with "For" beside the buttons it is wider than a phone's row. */}
          <span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
            {assignable.length ? <Select aria-label="For" fieldSize="sm" className="w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)}><ForOptions people={assignable} /></Select> : null}
            {dictation.supported ? <IconButton variant="round" aria-label="Dictate" data-tip="Dictate, and Brenda writes your to-dos" onClick={() => void startVoice()}><Mic aria-hidden /></IconButton> : null}
            <Button size="sm" variant="ghost" onClick={() => onClose(true)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={pending || !title.trim()}>{pending ? "Adding…" : person ? "Hand out" : "Add"}</Button>
          </span>
        </form>
      )}
      {shownError ? <p id={errorId} role="alert" className="pb-1 pt-1.5 text-meta font-medium text-danger">{shownError}</p> : null}
      {dictation.notice && !voice ? <p className="pb-1 text-meta font-normal text-secondary">{dictation.notice}</p> : null}
    </div>
  );
}
