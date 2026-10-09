"use client";

/**
 * What the person can do with one loose end (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed",
 * the personal loop closer; contract D.1 and H.1). The kind's actions, in the order lib/commitments gives them
 * (`LooseEndView.actions`, already only what is allowed now):
 *
 * - **Make it a to-do** opens a sheet ("Add this to your to-dos?", "It comes from words in a conversation, so you confirm
 *   it first.", the title and an optional due date, **Add to-do**): never a one-press add, in any mode (owner decision:
 *   a private to-do from someone else's words always asks first).
 * - **Remind me**: a small sheet with When (and what to remind them of, optional), **Set reminder**.
 * - **Hand it to {first}'s assistant**: a sheet with the person (the one they asked, for an ask they made), the to-do's
 *   title, due date and a short note, "{first} gets a request to add it to their to-dos. Nothing changes until they
 *   accept.", **Send request**: an ordinary request between assistants, which the other person accepts first.
 * - **Follow up later**: a sheet with When (the date mentioned, else tomorrow at 09:00), "On {when}, your assistant asks
 *   {first}'s assistant about it. Nothing is asked before then.", **Schedule**.
 * - **Not a commitment**: a `ConfirmButton`-style dialog; remembered, so the message is never suggested again.
 *
 * `layout`: "buttons" (a row of small buttons), "menu" (one `Menu` "Actions for “{title}”"), or "auto" (the buttons on
 * wide screens and the menu at ~400px). Each press goes to `/api/orgs/{org}/loose-ends/{id}/{todo|remind|hand-over|
 * follow-up|dismiss}`; the server's words show in the sheet when it refuses (a time in the past, a person who muted the
 * assistant, the owner and HR holding no to-dos), and `onDone` hears the loose end as it is now with what was done, in
 * words. No orange: nothing here is the screen's one thing to do.
 *
 * Dates are picked in this browser's time zone (as the task editor); the words that echo them use the organisation's.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Alert } from "@/components/ui/states";
import { fromLocalInput, toLocalInput } from "@/components/app/commitment-card";
import { api, isApiFailure } from "@/lib/api-client";
import { dateTimeLabel } from "@/lib/assistant-items";
import { clip, firstName } from "@/lib/follow-ups";
import { LOOP_LIMITS, LOOP_WORDS, type LooseEndAction, type LooseEndView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const L = LOOP_WORDS.looseEnds;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

export type Person = { membershipId: string; name: string };

/** The words on an action's button or menu item. */
export function actionLabel(a: LooseEndAction, item: Pick<LooseEndView, "kind" | "counterpart">): string {
  if (a === "hand_over") return item.kind === "i_asked" && item.counterpart ? L.actions.hand_over(item.counterpart.firstName) : L.actions.handOverSomeone;
  return L.actions[a];
}

/** Tomorrow at 09:00 in this browser, as the picker's local value. Only runs on a press (a sheet opening). */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/** The due date when it is still at least 5 minutes away, else tomorrow at 09:00. */
function dueOrTomorrow(dueAt: string | null): string {
  if (dueAt && Date.parse(dueAt) > Date.now() + 5 * 60_000) return toLocalInput(dueAt);
  return tomorrowNine();
}

/**
 * When "Remind me" suggests (review, 9 October 2026): before the work is due, not at it. 09:00 on the due day when that
 * is before the due time and still ahead; else two hours before it; else the due time itself while it is ahead; else
 * tomorrow at 09:00. In the browser's own clock, as the date picker shows it.
 */
function remindBefore(dueAt: string | null): string {
  const soon = Date.now() + 5 * 60_000;
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due)) return tomorrowNine();
  const nine = new Date(due);
  nine.setHours(9, 0, 0, 0);
  const pick = nine.getTime() < due && nine.getTime() > soon ? nine.getTime() : due - 2 * 3_600_000 > soon ? due - 2 * 3_600_000 : due > soon ? due : null;
  return pick === null ? tomorrowNine() : toLocalInput(new Date(pick).toISOString());
}

/** A refusal in the server's words (and the field it is about), or how to recover. */
function refusal(err: unknown): { message: string; fields: Record<string, string[]> } {
  if (isApiFailure(err)) {
    const told = err.error.status < 500 || err.error.code === "NOT_READY";
    return { message: told ? err.error.message : "Something went wrong. Nothing was changed; try again.", fields: err.error.fieldErrors ?? {} };
  }
  return { message: OFFLINE, fields: {} };
}

export function LooseEndActions({ orgSlug, item, people, timeZone, layout = "auto", onDone, className }: {
  orgSlug: string; item: LooseEndView;
  /** Who a loose end can be handed to (active members but the person). */ people: Person[];
  timeZone: string; layout?: "buttons" | "menu" | "auto";
  /** After an action went through: the loose end as it is now, and what was done in words. */
  onDone?: (view: LooseEndView, words: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<LooseEndAction | null>(null);
  const actions = item.actions;
  if (!actions.length) return null;

  const done = (view: LooseEndView, words: string) => { setSheet(null); onDone?.(view, words); router.refresh(); };
  const primary: LooseEndAction = actions[0];

  const buttons = (
    <div className={cn("flex flex-wrap items-center gap-2", layout === "auto" && "max-sm:hidden")}>
      {actions.map((a) => (
        <Button key={a} size="sm" variant={a === primary ? "secondary" : "ghost"} aria-haspopup="dialog" onClick={() => setSheet(a)}>{actionLabel(a, item)}</Button>
      ))}
    </div>
  );
  const menu = (
    <div className={cn(layout === "auto" && "sm:hidden")}>
      <Menu align="end" label={L.actionsFor(clip(item.title, 80))}
        trigger={<IconButton aria-label={L.actionsFor(clip(item.title, 80))}><EllipsisVertical aria-hidden /></IconButton>}>
        {actions.map((a) => <MenuItem key={a} onSelect={() => setSheet(a)}>{actionLabel(a, item)}</MenuItem>)}
      </Menu>
    </div>
  );

  return (
    <div className={cn("min-w-0", className)}>
      {layout !== "menu" ? buttons : null}
      {layout !== "buttons" ? menu : null}
      {sheet === "todo" ? <TodoSheet orgSlug={orgSlug} item={item} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === "remind" ? <RemindSheet orgSlug={orgSlug} item={item} timeZone={timeZone} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === "hand_over" ? <HandOverSheet orgSlug={orgSlug} item={item} people={people} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === "follow_up" ? <FollowUpSheet orgSlug={orgSlug} item={item} timeZone={timeZone} onClose={() => setSheet(null)} onDone={done} /> : null}
      <ConfirmDialog open={sheet === "dismiss"} onClose={() => setSheet((s) => (s === "dismiss" ? null : s))} tone="primary"
        title="Not a commitment?" description={<>“{clip(item.title, 120)}” won&apos;t be suggested again. Nothing is sent to anyone.</>}
        confirmLabel={L.actions.dismiss} pendingLabel="Saving…"
        onConfirm={async () => {
          const r = await api<{ looseEnd: LooseEndView }>(`/api/orgs/${orgSlug}/loose-ends/${item.id}/dismiss`, { method: "POST", retries: 1 });
          done(r.looseEnd, L.done.dismissed);
        }} />
    </div>
  );
}

type SheetProps = { orgSlug: string; item: LooseEndView; onClose: () => void; onDone: (view: LooseEndView, words: string) => void };

/** The form state every sheet shares: busy, the refusal at the top and on its field. */
function useSend() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string[]> } | null>(null);
  async function send<T>(fn: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (err) { setError(refusal(err)); return null; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, send };
}

/** The refusal not tied to a field shown, at the top of the form. */
function FormError({ error, fields }: { error: { message: string; fields: Record<string, string[]> } | null; fields: string[] }) {
  if (!error || fields.some((f) => error.fields[f]?.length)) return null;
  return <Alert tone="danger">{error.message}</Alert>;
}

function TodoSheet({ orgSlug, item, onClose, onDone }: SheetProps) {
  const id = useId();
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(() => toLocalInput(item.dueAt));
  const { busy, error, setError, send } = useSend();
  const submit = async () => {
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) { setError({ message: "Give the to-do a title.", fields: { title: ["Give the to-do a title."] } }); return; }
    const r = await send(() => api<{ looseEnd: LooseEndView }>(`/api/orgs/${orgSlug}/loose-ends/${item.id}/todo`, { method: "POST", body: { title: t, dueAt: fromLocalInput(due) } }));
    if (r) onDone(r.looseEnd, L.done.todo);
  };
  return (
    <Sheet open onClose={onClose} dismissible={!busy} title={L.confirmTodo.title} description={L.confirmTodo.body}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={id} loading={busy}>{busy ? "Adding…" : L.confirmTodo.save}</Button></>}>
      <form id={id} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormError error={error} fields={["title", "dueAt"]} />
        <Quote item={item} />
        <Field label="Title" htmlFor={`${id}-title`} error={error?.fields.title}>
          <Input id={`${id}-title`} value={title} maxLength={LOOP_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Due" htmlFor={`${id}-due`} hint="Optional" error={error?.fields.dueAt}>
          <DatePicker mode="datetime" id={`${id}-due`} value={due} onChange={setDue} />
        </Field>
      </form>
    </Sheet>
  );
}

function RemindSheet({ orgSlug, item, timeZone, onClose, onDone }: SheetProps & { timeZone: string }) {
  const id = useId();
  const [at, setAt] = useState(() => remindBefore(item.dueAt));
  const [text, setText] = useState("");
  const { busy, error, setError, send } = useSend();
  const submit = async () => {
    const iso = fromLocalInput(at);
    if (!iso) { setError({ message: "Pick when.", fields: { at: ["Pick when."] } }); return; }
    const words = text.replace(/\s+/g, " ").trim();
    const r = await send(() => api<{ looseEnd: LooseEndView }>(`/api/orgs/${orgSlug}/loose-ends/${item.id}/remind`, { method: "POST", body: { at: iso, ...(words ? { text: words } : {}) } }));
    if (r) onDone(r.looseEnd, L.done.reminder(dateTimeLabel(iso, timeZone)));
  };
  return (
    <Sheet open size="sm" onClose={onClose} dismissible={!busy} title={L.remind.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={id} loading={busy}>{busy ? "Saving…" : L.remind.save}</Button></>}>
      <form id={id} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormError error={error} fields={["at", "text"]} />
        <Field label={L.remind.at} htmlFor={`${id}-at`} error={error?.fields.at}>
          <DatePicker mode="datetime" id={`${id}-at`} value={at} onChange={setAt} required />
        </Field>
        <Field label="What to remind you of" htmlFor={`${id}-text`} hint="Optional" error={error?.fields.text}>
          <Input id={`${id}-text`} value={text} maxLength={500} placeholder={item.headline} onChange={(e) => setText(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}

function HandOverSheet({ orgSlug, item, people, onClose, onDone }: SheetProps & { people: Person[] }) {
  const id = useId();
  const counterpart = item.kind === "i_asked" && item.counterpart && people.some((p) => p.membershipId === item.counterpart?.membershipId) ? item.counterpart.membershipId : "";
  const [to, setTo] = useState(counterpart);
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(() => toLocalInput(item.dueAt));
  const [note, setNote] = useState("");
  const { busy, error, setError, send } = useSend();
  const chosen = people.find((p) => p.membershipId === to);
  const first = chosen ? firstName(chosen.name) : null;
  const submit = async () => {
    if (!to) { setError({ message: "Choose who to hand it to.", fields: { to: ["Choose who to hand it to."] } }); return; }
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) { setError({ message: "Give the to-do a title.", fields: { title: ["Give the to-do a title."] } }); return; }
    const words = note.trim();
    const r = await send(() => api<{ looseEnd: LooseEndView }>(`/api/orgs/${orgSlug}/loose-ends/${item.id}/hand-over`, { method: "POST", body: { to, title: t, dueAt: fromLocalInput(due), ...(words ? { note: words } : {}) } }));
    if (r) onDone(r.looseEnd, L.done.handed(first ?? ""));
  };
  return (
    <Sheet open onClose={onClose} dismissible={!busy} title={L.confirmHandOver.title}
      description={first ? L.confirmHandOver.body(first) : "They get a request to add it to their to-dos. Nothing changes until they accept."}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={id} loading={busy}>{busy ? "Sending…" : L.confirmHandOver.save}</Button></>}>
      <form id={id} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormError error={error} fields={["to", "title", "dueAt", "note"]} />
        <Quote item={item} />
        <Field label="Hand it to" htmlFor={`${id}-to`} error={error?.fields.to}>
          <Select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose someone</option>
            {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="To-do for them" htmlFor={`${id}-title`} error={error?.fields.title}>
          <Input id={`${id}-title`} value={title} maxLength={LOOP_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Due" htmlFor={`${id}-due`} hint="Optional" error={error?.fields.dueAt}>
          <DatePicker mode="datetime" id={`${id}-due`} value={due} onChange={setDue} />
        </Field>
        <Field label="A note for them" htmlFor={`${id}-note`} hint="Optional" error={error?.fields.note}>
          <Textarea id={`${id}-note`} className="min-h-16" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}

function FollowUpSheet({ orgSlug, item, timeZone, onClose, onDone }: SheetProps & { timeZone: string }) {
  const id = useId();
  const [at, setAt] = useState(() => dueOrTomorrow(item.dueAt));
  const { busy, error, setError, send } = useSend();
  const first = item.counterpart?.firstName ?? "them";
  const iso = fromLocalInput(at);
  const when = iso ? dateTimeLabel(iso, timeZone) : "the day you pick";
  const submit = async () => {
    if (!iso) { setError({ message: "Pick when.", fields: { at: ["Pick when."] } }); return; }
    const r = await send(() => api<{ looseEnd: LooseEndView }>(`/api/orgs/${orgSlug}/loose-ends/${item.id}/follow-up`, { method: "POST", body: { at: iso } }));
    if (r) onDone(r.looseEnd, L.done.followUp(when));
  };
  return (
    <Sheet open size="sm" onClose={onClose} dismissible={!busy} title={L.confirmFollowUp.title} description={L.confirmFollowUp.body(first, when)}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={id} loading={busy}>{busy ? "Scheduling…" : L.confirmFollowUp.save}</Button></>}>
      <form id={id} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormError error={error} fields={["at", "question"]} />
        <Field label="When" htmlFor={`${id}-at`} error={error?.fields.at}>
          <DatePicker mode="datetime" id={`${id}-at`} value={at} onChange={setAt} required />
        </Field>
      </form>
    </Sheet>
  );
}

/** The message the loose end came from, quoted as typed (plain text), so the sheet says what it is about. */
function Quote({ item }: { item: LooseEndView }) {
  if (!item.message.quote) return null;
  return (
    <figure className="min-w-0">
      <blockquote className="line-clamp-4 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground">“{item.message.quote}”</blockquote>
      <figcaption className="mt-1 text-meta font-normal text-secondary">{item.message.where}</figcaption>
    </figure>
  );
}
