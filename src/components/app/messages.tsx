"use client";

/**
 * Messages, v4 (owner brief, 6 October 2026: an inbox in the ElevenLabs language). The client parts of the page: the
 * composer (the prompt pill, with the voice card for voice notes), the "New" menu and its sheets, the menus on a
 * message, on a conversation in the list and on the open conversation, and the details sheet for screens too narrow
 * for the details pane. Menus are the v4 Menu (popover surface, keyboard paths built in); forms open in right-side
 * sheets, short questions in centred dialogs; anything that fails after a menu has closed says so in a toast.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link, { useLinkStatus } from "next/link";
import { ArrowUp, X, MessageSquarePlus, Mic, Trash2, MoreHorizontal, Copy, Pencil, Flag, Plus, Users, Archive, ArchiveRestore, Hash, Reply, Bell, BellOff, Mail, MailOpen, Loader2, Search, PanelRight, SquareCheckBig } from "lucide-react";
import { VoiceCapture } from "@/components/app/voice-capture";
import { MAX_SECONDS, useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Button } from "@/components/ui/button";
import { Textarea, InputAdorned, Field } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Sheet, Dialog } from "@/components/ui/sheet";
import { PromptAction } from "@/components/ui/ai-prompt-box";
import { notify } from "@/components/ui/toast";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import type { Presence as PresenceStatus } from "@/lib/presence";

type TaskRef = { id: string; title: string } | null;

const OFFLINE = "Cannot reach the server. Check your connection and try again.";
const reason = (err: unknown) => (isApiFailure(err) ? err.error.message : OFFLINE);

/**
 * A menu action that did not work says so in a toast (the Toaster is mounted by the message toasts), with what failed
 * and why: menus close as soon as an item is picked, so there is nowhere inline to say it.
 */
function failed(what: string, err?: unknown) {
  notify(what, { description: err !== undefined ? reason(err) : undefined, tone: "danger", duration: 6000 });
}
/** The same toast for a quiet confirmation (a copy, a report sent). */
function notice(text: string, duration = 3000) {
  notify(text, { tone: "success", duration });
}

// ---- Replying (owner decision, 26 September 2026): pick a message anywhere in the thread, the composer quotes it -------

export type ReplyRef = { id: string; name: string; body: string } | null;
const ReplyContext = createContext<{ reply: ReplyRef; setReply: (r: ReplyRef) => void }>({ reply: null, setReply: () => {} });

/** Holds the message being replied to between the bubbles and the composer. Keyed by conversation on the page, so it resets on switch. */
export function ReplyProvider({ children }: { children: ReactNode }) {
  const [reply, setReply] = useState<ReplyRef>(null);
  return <ReplyContext.Provider value={{ reply, setReply }}>{children}</ReplyContext.Provider>;
}
export const useReply = () => useContext(ReplyContext);

const noSubscribe = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

/** The small remove button on the composer's reply and task strips. */
const STRIP_X = "grid size-7 shrink-0 place-items-center rounded-lg text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:size-10";

/**
 * The composer: the prompt pill (r26, fill-1 laid solid over the canvas, a hairline ring; owner rule: messages never
 * show through it), 16/24 text, a round ghost microphone and the round white Send. Enter sends, Shift+Enter starts a
 * new line. State lives here, so the live refresh that brings in new messages never touches what is being typed (the
 * form is marked data-refresh-safe). While a voice note records, the voice card takes the text's place inside the pill.
 */
export function Composer({ orgSlug, conversationId, task, prefill, placeholder, canVoice = true }: { canVoice?: boolean; orgSlug: string; conversationId: string; task: TaskRef; prefill?: string; placeholder: string }) {
  const router = useRouter();
  const [body, setBody] = useState(prefill ?? "");
  const [attached, setAttached] = useState<TaskRef>(task);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  // At the ten-minute limit the note is sent as it is, rather than lost.
  const voice = useVoiceRecorder({ onLimit: () => void sendVoice() });
  // Whether this browser can record is only known in the browser; the server renders without the microphone and it
  // appears once hydrated, so the two renders match.
  const hydrated = useSyncExternalStore(noSubscribe, inBrowser, onServer);
  const canRecord = canVoice && hydrated && voice.supported;
  const [sendingVoice, setSendingVoice] = useState(false);
  const { reply, setReply } = useReply();
  useEffect(() => { ref.current?.focus(); }, [conversationId]);
  useEffect(() => { if (reply) ref.current?.focus(); }, [reply]);
  // The voice card takes the place of the box and the microphone while a note is recorded and sent, so the focus would
  // be lost with the button that was pressed: it moves to the card's Send (which ends the note and sends it), and back
  // to the box once the card is gone (sent or cancelled), unless it has been put somewhere else meanwhile.
  const sendNote = useRef<HTMLButtonElement>(null);
  const card = voice.recording || sendingVoice;
  useEffect(() => { if (voice.recording) sendNote.current?.focus(); }, [voice.recording]);
  const hadCard = useRef(false);
  useEffect(() => {
    if (!card && hadCard.current && (!document.activeElement || document.activeElement === document.body)) ref.current?.focus();
    hadCard.current = card;
  }, [card]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const voiceSending = useRef(false); // a second press before the first has re-rendered sends nothing
  const sendVoice = async () => {
    if (voiceSending.current) return;
    voiceSending.current = true;
    // Set before the recording stops, so the voice card stays up (now "Sending…") until the note has gone.
    setSendingVoice(true); setError(null);
    try {
      const note = await voice.stop();
      if (!note) { setError("Nothing was recorded."); return; }
      const fd = new FormData(); fd.append("file", note.blob, `voice.${note.type.split("/")[1]}`); fd.append("conversationId", conversationId); fd.append("seconds", String(note.seconds));
      const res = await fetch(`/api/orgs/${orgSlug}/messages/voice`, { method: "POST", body: fd, credentials: "same-origin" }).catch(() => null);
      if (!res) throw new Error(`${OFFLINE} The voice note was not sent.`);
      if (!res.ok) { const data = await res.json().catch(() => null); throw new Error(data?.message ?? "The voice note was not sent. Try recording it again."); }
      router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { voiceSending.current = false; setSendingVoice(false); }
  };
  const grow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; };
  const send = async () => {
    const text = body.trim();
    if (!text || pending) return;
    setPending(true); setError(null);
    try {
      await api(`/api/orgs/${orgSlug}/messages`, { method: "POST", body: { conversationId, body: text, taskId: attached?.id ?? null, replyToId: reply?.id ?? null } });
      setBody(""); setAttached(null); setReply(null);
      if (ref.current) { ref.current.style.height = "auto"; ref.current.focus(); }
      if (attached) router.replace(`/app/${orgSlug}/messages?c=${conversationId}`);
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server, so the message was not sent. It is still in the box; check your connection and press Send again."); }
    finally { setPending(false); }
  };
  const shownError = error ?? voice.error;
  const ready = !!body.trim() && !pending;
  return (
    <form data-refresh-safe className="shrink-0 bg-background px-4 pb-4 pt-2 md:px-6" onSubmit={(e) => { e.preventDefault(); void send(); }} onKeyDown={(e) => { if (e.key === "Escape" && reply) { e.preventDefault(); setReply(null); } }}>
      <div className="mx-auto w-full max-w-3xl">
        <Presence show={!!reply}>
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-fill-0 py-1.5 pl-3 pr-1.5">
            <Reply className="size-4 shrink-0 text-secondary" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate text-meta font-medium text-foreground">Replying to {reply?.name}</span><span className="block truncate text-meta font-normal text-secondary">{reply?.body}</span></span>
            <button type="button" aria-label="Stop replying" className={STRIP_X} onClick={() => setReply(null)}><X className="size-4" aria-hidden /></button>
          </div>
        </Presence>
        <Presence show={!!attached}>
          <div className="mb-2 flex min-w-0 items-center gap-2 pl-1 text-sm">
            <span className="shrink-0 font-normal text-secondary">About</span>
            <Link href={`/app/${orgSlug}/tasks/${attached?.id}`} className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-border-input bg-background px-2 text-meta font-medium text-foreground transition-colors duration-75 hover:border-border-input-hover hover:bg-fill-0">
              <SquareCheckBig className="size-3.5 shrink-0 text-secondary" aria-hidden /><span className="truncate">{attached?.title}</span>
            </Link>
            <button type="button" aria-label="Remove the task from this message" className={STRIP_X} onClick={() => setAttached(null)}><X className="size-4" aria-hidden /></button>
          </div>
        </Presence>
        <Presence show={!!shownError}><p id={errId} role="alert" className="mb-2 pl-1 text-meta font-medium text-danger">{shownError}</p></Presence>
        <div className={cn("rounded-[26px] bg-surface transition-shadow duration-150",
          // Accent rules (6 October 2026), as on Brenda's prompt pill: an orange ring while it has focus or records.
          card ? "shadow-[0_0_0_1px_var(--accent-ring),var(--elev-natural-xs)]" : "shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)] focus-within:shadow-[0_0_0_1px_var(--accent-ring),var(--elev-natural-xs)]")}>
          {/* Recording a voice note: the voice card in ElevenLabs' recording look (owner decision, 7 October 2026): the live
              time, the waveform read from the recorder's own microphone, then Cancel and Send. The last minute is counted down. */}
          {card ? (
            <div className="p-2">
              <VoiceCapture phase={voice.recording ? "listening" : "working"} title={voice.recording ? "Recording…" : "Sending your voice note…"} stream={voice.stream} seconds={voice.seconds} className="rounded-[20px]"
                hint={voice.recording && voice.seconds >= MAX_SECONDS - 60 ? <><span className="tabular-nums">{fmt(Math.max(0, MAX_SECONDS - voice.seconds))}</span> left: at {fmt(MAX_SECONDS)} the note sends itself.</> : undefined}
                actions={voice.recording ? <>
                  <IconButton variant="round" aria-label="Cancel" data-tip="Discard the voice note" onClick={() => voice.cancel()} disabled={sendingVoice}><Trash2 aria-hidden /></IconButton>
                  {/* Under a second there is nothing to send yet: it says so (aria-disabled) but keeps the focus it was given. */}
                  <Button ref={sendNote} type="button" size="md" variant="accent" onClick={() => { if (voice.seconds >= 1) void sendVoice(); }} disabled={sendingVoice} aria-disabled={voice.seconds < 1 || undefined}
                    className="aria-disabled:pointer-events-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50"><ArrowUp aria-hidden />Send</Button>
                </> : null} />
            </div>
          ) : (
            <div className="flex items-end gap-1 p-2">
              {/* Read-only, not disabled, while sending: a disabled box drops the focus, and Enter should leave you ready to type the next line. */}
              <textarea ref={ref} value={body} rows={1} placeholder={placeholder} aria-label="Message" aria-describedby={shownError ? errId : undefined} readOnly={pending} aria-busy={pending}
                className="prompt-scroll block max-h-[200px] min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 pl-3 text-base font-normal text-foreground outline-none placeholder:text-subtle read-only:text-secondary"
                onChange={(e) => { setBody(e.target.value); grow(e.target); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
              {canRecord && !body.trim() ? <PromptAction aria-label="Record a voice note" disabled={pending} onClick={() => void voice.start()}><Mic aria-hidden /></PromptAction> : null}
              <button type="submit" aria-label={pending ? "Sending" : "Send"} disabled={!ready}
                className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed",
                  ready ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-fill-150 text-subtle")}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-[18px]" strokeWidth={2.25} aria-hidden />}
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 px-3 text-xs font-medium text-subtle">{voice.recording ? "Speak, then press Send. Up to ten minutes." : pending || sendingVoice ? "Sending…" : `Enter sends, Shift+Enter starts a new line.${canRecord ? " The microphone records a voice note." : ""}`}</p>
      </div>
    </form>
  );
}

/**
 * The one "New" button on Messages (owner decision, 26 September 2026): it asks which kind of new, a channel or a
 * direct thread with someone, instead of two buttons side by side. Each opening of a sheet starts blank (it is keyed).
 */
export function NewConversation({ orgSlug, people }: { orgSlug: string; people: Person[] }) {
  const [sheet, setSheet] = useState<"channel" | "person" | null>(null);
  const [opened, setOpened] = useState(0);
  const open = (s: "channel" | "person") => { setOpened((n) => n + 1); setSheet(s); };
  const ITEM_2 = "h-auto items-start py-2 [&>svg]:mt-0.5";
  return (
    <>
      <Menu align="end" label="New" className="w-72" trigger={<Button size="md"><Plus aria-hidden />New</Button>}>
        <MenuItem icon={<Hash aria-hidden />} className={ITEM_2} onSelect={() => open("channel")}><span className="block">New channel</span><span className="block text-meta font-normal text-secondary">A room for a topic or a group</span></MenuItem>
        <MenuItem icon={<MessageSquarePlus aria-hidden />} className={ITEM_2} onSelect={() => open("person")}><span className="block">Message someone</span><span className="block text-meta font-normal text-secondary">A direct thread with a teammate</span></MenuItem>
      </Menu>
      <NewChannel key={`channel-${opened}`} orgSlug={orgSlug} people={people} open={sheet === "channel"} onClose={() => setSheet(null)} />
      <NewMessage key={`person-${opened}`} orgSlug={orgSlug} people={people} open={sheet === "person"} onClose={() => setSheet(null)} />
    </>
  );
}

const ROLE: Record<string, string> = { owner: "Organisation owner", hr: "HR", manager: "Team lead", employee: "Staff" };

/** "Message someone": a side sheet with a search box (focused on open) and the people; picking one opens the thread. */
export function NewMessage({ orgSlug, people, open, onClose }: { orgSlug: string; people: Person[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = people.filter((p) => !q.trim() || `${p.display_name} ${p.teams ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const start = async (membershipId: string) => {
    setPending(membershipId); setError(null);
    try { const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/messages/direct`, { method: "POST", body: { membershipId } }); onClose(); router.push(`/app/${orgSlug}/messages?c=${r.id}`); router.refresh(); }
    catch (err) { setError(reason(err)); }
    finally { setPending(null); }
  };
  return (
    <Sheet open={open} onClose={onClose} size="sm" title="Message someone" description="Anyone in the organisation, in your team or not.">
      <div className="grid gap-3">
        <InputAdorned type="search" prefix={<Search aria-hidden />} aria-label="Search people" placeholder="Search by name or team…" value={q} onChange={(e) => setQ(e.target.value)} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ul aria-busy={pending !== null} className="-mx-2 space-y-0.5">
          {shown.length === 0 ? <li className="px-2 py-8 text-center text-sm font-normal text-secondary">{people.length === 0 ? "Nobody else has joined yet." : "No one matches that. Try a first name or a team."}</li> : shown.map((p) => (
            <li key={p.membership_id}>
              <button type="button" disabled={pending !== null} onClick={() => start(p.membership_id)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-75 hover:bg-fill-1 focus-visible:bg-fill-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50">
                <Avatar profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} presence={p.presence} size={36} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.display_name}</span><span className="block truncate text-meta font-normal text-secondary">{[ROLE[p.role] ?? p.role, p.teams].filter(Boolean).join(", ")}</span></span>
                <span className="shrink-0 text-xs font-medium text-subtle">{pending === p.membership_id ? "Opening…" : "Message"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/**
 * Inside a conversation's link in the list: a thin line along the row's foot while that thread loads, so the press is
 * answered at once. Always rendered at the same size; only its opacity changes, so nothing shifts.
 */
export function RowPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 bottom-0 h-px rounded-full bg-secondary transition-opacity duration-150", pending ? "animate-pulse opacity-100" : "opacity-0")} />;
}

/** Keeps the thread scrolled to the newest message as new ones arrive. */
export function ScrollToLatest({ count, conversationId }: { count: number; conversationId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "end" }); }, [count, conversationId]);
  return <div ref={ref} aria-hidden />;
}

export function WithdrawMessage({ orgSlug, id, className }: { orgSlug: string; id: string; className?: string }) {
  const router = useRouter();
  return (
    <ConfirmButton size="xs" variant="ghost" className={className} title="Withdraw this message?" description="It is removed for everyone in the conversation. The line stays so the thread keeps its shape." confirmLabel="Withdraw"
      onConfirm={async () => { try { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "DELETE" }); router.refresh(); } catch (err) { failed("The message was not withdrawn.", err); } }}>
      Withdraw
    </ConfirmButton>
  );
}

// ---- Dialogs (owner decision, 25 September 2026): one menu per message and per conversation --------------------------

/** A centred dialog with one text box: edit a message, report one, rename a channel. */
function TextDialog({ open, onClose, title, description, label, initial = "", submitLabel, pendingLabel, maxLength = 4000, danger = false, onSubmit }: { open: boolean; onClose: () => void; title: string; description?: string; label: string; initial?: string; submitLabel: string; pendingLabel: string; maxLength?: number; danger?: boolean; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const fieldId = useId();
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} variant={danger ? "danger" : "primary"} loading={pending} disabled={!text.trim()}>{pending ? pendingLabel : submitLabel}</Button></>}>
      <form id={formId} className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); setPending(true); setError(null); try { await onSubmit(text); onClose(); } catch (err) { setError(reason(err)); } finally { setPending(false); } }}>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={label} htmlFor={fieldId}><Textarea id={fieldId} value={text} onChange={(e) => setText(e.target.value)} rows={maxLength > 200 ? 4 : 2} className={maxLength > 200 ? "py-2" : "min-h-0 py-2"} maxLength={maxLength} required /></Field>
      </form>
    </Dialog>
  );
}

/**
 * The reply arrow and the "…" beside a bubble: 28px ghost buttons (40px on touch). `canReport` is false for your own
 * assistant's own message, which is neither yours to edit nor someone else's to report (personal assistants, phase 3,
 * owner decision, 8 October 2026); `senderName` is then the assistant's name, so a reply says "Replying to Max".
 */
export function MessageMenu({ orgSlug, id, mine, body, isVoice, senderName, canReply = true, canReport = !mine }: { orgSlug: string; id: string; mine: boolean; body: string; isVoice: boolean; senderName: string; canReply?: boolean; canReport?: boolean }) {
  const router = useRouter();
  const { setReply } = useReply();
  const [sheet, setSheet] = useState<"edit" | "report" | "withdraw" | null>(null);
  // Dialogs mount the first time they are asked for and stay (closed) after, so closing hands the focus back to "…";
  // each opening is keyed, so it starts from the message as it is now.
  const [opened, setOpened] = useState<{ edit: number; report: number; withdraw: number }>({ edit: 0, report: 0, withdraw: 0 });
  const open = (s: "edit" | "report" | "withdraw") => { setOpened((o) => ({ ...o, [s]: o[s] + 1 })); setSheet(s); };
  // The menu closes on the press, so the confirmation is a short toast rather than a changed label nobody sees.
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); notice("Text copied.", 1600); }
    catch { failed("The text was not copied. Select it in the message and copy it from there."); }
  };
  const startReply = () => setReply({ id, name: mine ? "yourself" : senderName, body: isVoice ? "Voice note" : body });
  return (
    <div className={cn("flex items-center gap-0.5", mine && "flex-row-reverse")}>
      {canReply ? <IconButton size="xs" aria-label="Reply" onClick={startReply}><Reply aria-hidden /></IconButton> : null}
      <Menu align={mine ? "end" : "start"} label="Message actions" trigger={<IconButton size="xs" aria-label="Message actions"><MoreHorizontal aria-hidden /></IconButton>}>
        {canReply ? <MenuItem icon={<Reply aria-hidden />} onSelect={startReply}>Reply</MenuItem> : null}
        {!isVoice ? <MenuItem icon={<Copy aria-hidden />} onSelect={() => void copy()}>Copy text</MenuItem> : null}
        {mine && !isVoice ? <MenuItem icon={<Pencil aria-hidden />} onSelect={() => open("edit")}>Edit</MenuItem> : null}
        {!mine && canReport ? <MenuItem icon={<Flag aria-hidden />} onSelect={() => open("report")}>Report</MenuItem> : null}
        {mine ? <><MenuSeparator /><MenuItem tone="danger" icon={<Trash2 aria-hidden />} onSelect={() => open("withdraw")}>Withdraw</MenuItem></> : null}
      </Menu>
      {opened.edit ? <TextDialog key={`edit-${opened.edit}`} open={sheet === "edit"} onClose={() => setSheet(null)} title="Edit message" label="Message" initial={body} submitLabel="Save" pendingLabel="Saving…" onSubmit={async (text) => { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "PATCH", body: { body: text }, retries: 0 }); router.refresh(); }} /> : null}
      {opened.report ? <TextDialog key={`report-${opened.report}`} open={sheet === "report"} onClose={() => setSheet(null)} title="Report this message" description="The organisation owner and HR are told, with your reason. The sender is not." label="What is wrong with it" submitLabel="Send report" pendingLabel="Sending report…" danger onSubmit={async (text) => { await api(`/api/orgs/${orgSlug}/messages/${id}/report`, { method: "POST", body: { reason: text }, retries: 0 }); notice("Report sent. The owner and HR have been told.", 4000); }} /> : null}
      {opened.withdraw ? <ConfirmDialog open={sheet === "withdraw"} onClose={() => setSheet(null)} title="Withdraw this message?" description="It is removed for everyone in the conversation. The line stays so the thread keeps its shape." confirmLabel="Withdraw" pendingLabel="Withdrawing…" onConfirm={async () => { try { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "DELETE", retries: 0 }); router.refresh(); } catch (err) { failed("The message was not withdrawn.", err); } }} /> : null}
    </div>
  );
}

type Person = { membership_id: string; display_name: string; role: string; teams: string | null; profile_id: string; avatar_key: string | null; presence: PresenceStatus };

/** A checklist of people for a channel: a search box, then rows that toggle (the whole row is the checkbox's label). */
function PeoplePicker({ people, chosen, onChange }: { people: Person[]; chosen: Set<string>; onChange: (next: Set<string>) => void }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => p.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="grid gap-2">
      <InputAdorned type="search" prefix={<Search aria-hidden />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" />
      <ul className="-mx-2 space-y-0.5">
        {list.map((p) => (
          <li key={p.membership_id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-75 hover:bg-fill-1">
              <input type="checkbox" checked={chosen.has(p.membership_id)} onChange={(e) => { const next = new Set(chosen); if (e.target.checked) next.add(p.membership_id); else next.delete(p.membership_id); onChange(next); }} />
              <Avatar profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.display_name}</span><span className="block truncate text-meta font-normal text-secondary">{p.teams ?? ROLE[p.role] ?? p.role}</span></span>
            </label>
          </li>
        ))}
        {list.length === 0 ? <li className="px-2 py-6 text-center text-sm font-normal text-secondary">{people.length === 0 ? "Nobody else has joined yet." : "No one matches that."}</li> : null}
      </ul>
      <p aria-live="polite" className="text-xs font-medium text-secondary"><span className="tabular-nums">{chosen.size}</span> chosen. You are always in.</p>
    </div>
  );
}

/** Start a channel: a name and the people in it, in a side sheet. */
export function NewChannel({ orgSlug, people, open, onClose }: { orgSlug: string; people: Person[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const formId = useId();
  const nameId = useId();
  return (
    <Sheet open={open} onClose={onClose} title="New channel" description="A named room for a topic or a group. You can add or remove people later."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={pending} disabled={!title.trim()}>{pending ? "Creating…" : "Create channel"}</Button></>}>
      <form id={formId} className="grid gap-5" onSubmit={async (e) => { e.preventDefault(); setPending(true); setError(null); setFieldErrors({}); try { const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/messages/channels`, { method: "POST", body: { title, memberIds: [...chosen] }, retries: 0 }); onClose(); router.push(`/app/${orgSlug}/messages?c=${r.id}`); router.refresh(); } catch (err) { setError(reason(err)); if (isApiFailure(err)) setFieldErrors(err.error.fieldErrors ?? {}); } finally { setPending(false); } }}>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Channel name" htmlFor={nameId} error={fieldErrors.title}><InputAdorned id={nameId} prefix="#" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required placeholder="launch-week" /></Field>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium text-foreground">People</legend>
          <PeoplePicker people={people} chosen={chosen} onChange={setChosen} />
          {fieldErrors.memberIds ? <p role="alert" className="mt-1.5 text-meta font-medium text-danger">{fieldErrors.memberIds[0]}</p> : null}
        </fieldset>
      </form>
    </Sheet>
  );
}

/**
 * The "…" that appears when a conversation in the list is hovered or focused (owner decision, 26 September 2026): mark
 * it unread or read, mute or unmute, archive or restore a channel you run, delete a chat or channel.
 */
export function ConversationRowMenu({ orgSlug, conversation, active }: { orgSlug: string; conversation: { id: string; kind: string; title: string; unread: number; muted: boolean; archived_at: string | null; can_manage: boolean }; active: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const c = conversation;
  const isChannel = c.kind === "channel";
  // `what` names the change for the toast if it does not go through ("The chat with Ada was not muted.").
  const patch = async (body: Record<string, unknown>, what: string) => { setPending(true); try { await api(`/api/orgs/${orgSlug}/messages/conversations/${c.id}`, { method: "PATCH", body, retries: 0 }); router.refresh(); } catch (err) { failed(`${isChannel ? `#${c.title}` : c.kind === "direct" ? `The chat with ${c.title}` : c.title} was not ${what}.`, err); } finally { setPending(false); } };
  const canDelete = c.kind === "direct" || (isChannel && c.can_manage);
  return (
    <div className={cn("absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-75 focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100", pending && "opacity-100")}>
      <Menu align="end" label={`Actions for ${c.title}`} trigger={
        <IconButton size="xs" aria-label={`Actions for ${c.title}`} aria-busy={pending} disabled={pending} className="border border-border-input bg-background hover:bg-surface">{pending ? <Loader2 className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}</IconButton>
      }>
        {!active ? (c.unread > 0
          ? <MenuItem icon={<MailOpen aria-hidden />} onSelect={() => void patch({ unread: false }, "marked as read")}>Mark as read</MenuItem>
          : <MenuItem icon={<Mail aria-hidden />} onSelect={() => void patch({ unread: true }, "marked as unread")}>Mark as unread</MenuItem>) : null}
        {c.muted
          ? <MenuItem icon={<Bell aria-hidden />} onSelect={() => void patch({ muted: false }, "unmuted")}>Unmute</MenuItem>
          : <MenuItem icon={<BellOff aria-hidden />} onSelect={() => void patch({ muted: true }, "muted")}>Mute</MenuItem>}
        {isChannel && c.can_manage ? (c.archived_at
          ? <MenuItem icon={<ArchiveRestore aria-hidden />} onSelect={() => void patch({ archived: false }, "restored")}>Restore</MenuItem>
          : <MenuItem icon={<Archive aria-hidden />} onSelect={() => void patch({ archived: true }, "archived")}>Archive</MenuItem>) : null}
        {canDelete ? <><MenuSeparator /><MenuItem tone="danger" icon={<Trash2 aria-hidden />} onSelect={() => setConfirm(true)}>{isChannel ? "Delete channel" : "Delete chat"}</MenuItem></> : null}
      </Menu>
      {canDelete ? (
        <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={isChannel ? `Delete #${c.title}?` : `Delete the chat with ${c.title}?`}
          description={isChannel ? "Every message in it is removed for everyone. Archive it instead if you might want it back." : "It disappears from your list. The other person keeps their copy, and it comes back here if they write to you again."}
          confirmLabel={isChannel ? "Delete channel" : "Delete chat"} pendingLabel="Deleting…"
          onConfirm={async () => { try { await api(`/api/orgs/${orgSlug}/messages/conversations/${c.id}`, { method: "DELETE", retries: 0 }); if (active) router.push(`/app/${orgSlug}/messages`); router.refresh(); } catch (err) { failed(isChannel ? `#${c.title} was not deleted.` : "The chat was not deleted.", err); } }} />
      ) : null}
    </div>
  );
}

/** The "…" on the open conversation's header: people, rename, archive or restore, delete a channel; delete a direct chat. */
export function ConversationMenu({ orgSlug, conversation, people, memberIds }: { orgSlug: string; conversation: { id: string; kind: string; title: string; archived_at: string | null; can_manage: boolean; other_membership_id?: string | null }; people: Person[]; memberIds: string[] }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"people" | "rename" | "delete" | "hide" | null>(null);
  const [renames, setRenames] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set(memberIds));
  const [pending, setPending] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const formId = useId();
  // Throws on failure, so each caller says what did not happen where the person is looking.
  const patch = async (body: Record<string, unknown>) => { setPending(true); try { await api(`/api/orgs/${orgSlug}/messages/conversations/${conversation.id}`, { method: "PATCH", body, retries: 0 }); router.refresh(); } finally { setPending(false); } };
  const remove = async (what: string) => { try { await api(`/api/orgs/${orgSlug}/messages/conversations/${conversation.id}`, { method: "DELETE", retries: 0 }); router.push(`/app/${orgSlug}/messages`); router.refresh(); } catch (err) { failed(what, err); } };
  const isChannel = conversation.kind === "channel";
  if (!isChannel && conversation.kind !== "direct") return null;
  return (
    <>
      <Menu align="end" label="Conversation actions" trigger={<IconButton aria-label="Conversation actions" aria-busy={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}</IconButton>}>
        {isChannel && conversation.can_manage ? <>
          <MenuItem icon={<Users aria-hidden />} onSelect={() => { setChosen(new Set(memberIds)); setPeopleError(null); setSheet("people"); }}>People</MenuItem>
          <MenuItem icon={<Pencil aria-hidden />} onSelect={() => { setRenames((n) => n + 1); setSheet("rename"); }}>Rename</MenuItem>
          <MenuItem icon={conversation.archived_at ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} disabled={pending} onSelect={() => { patch({ archived: !conversation.archived_at }).catch((err) => failed(`#${conversation.title} was not ${conversation.archived_at ? "restored" : "archived"}.`, err)); }}>{conversation.archived_at ? "Restore" : "Archive"}</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger" icon={<Trash2 aria-hidden />} onSelect={() => setSheet("delete")}>Delete channel</MenuItem>
        </> : null}
        {isChannel && !conversation.can_manage ? <MenuLabel>Only the person who made this channel, the owner or HR can change it.</MenuLabel> : null}
        {conversation.kind === "direct" ? <MenuItem tone="danger" icon={<Trash2 aria-hidden />} onSelect={() => setSheet("hide")}>Delete chat</MenuItem> : null}
      </Menu>
      {isChannel && conversation.can_manage ? <>
        <Sheet open={sheet === "people"} onClose={() => setSheet(null)} title={`People in #${conversation.title}`} description="Tick who belongs in this channel. Everyone in it can read the whole history."
          footer={<><Button variant="secondary" onClick={() => setSheet(null)}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Saving…" : "Save people"}</Button></>}>
          <form id={formId} className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); setPeopleError(null); try { await patch({ memberIds: [...chosen] }); setSheet(null); } catch (err) { setPeopleError(reason(err)); } }}>
            {peopleError ? <Alert tone="danger">{peopleError}</Alert> : null}
            <PeoplePicker people={people} chosen={chosen} onChange={setChosen} />
          </form>
        </Sheet>
        {renames ? <TextDialog key={`rename-${renames}`} open={sheet === "rename"} onClose={() => setSheet(null)} title="Rename channel" label="Channel name" initial={conversation.title} maxLength={80} submitLabel="Rename" pendingLabel="Renaming…" onSubmit={async (text) => { await patch({ title: text.trim().slice(0, 80) }); }} /> : null}
        <ConfirmDialog open={sheet === "delete"} onClose={() => setSheet(null)} title={`Delete #${conversation.title}?`} description="Every message in it is removed for everyone. Archive it instead if you might want it back." confirmLabel="Delete channel" pendingLabel="Deleting…" onConfirm={() => remove(`#${conversation.title} was not deleted.`)} />
      </> : null}
      {conversation.kind === "direct" ? <ConfirmDialog open={sheet === "hide"} onClose={() => setSheet(null)} title="Delete this chat?" description="It disappears from your list. The other person keeps their copy, and it comes back here if they write to you again." confirmLabel="Delete chat" pendingLabel="Deleting…" onConfirm={() => remove("The chat was not deleted.")} /> : null}
    </>
  );
}

/**
 * The details pane's contents in a side sheet, for screens narrower than the three-pane layout (below 1280px): a
 * ghost icon button on the conversation's header opens it.
 */
export function ConversationDetails({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton aria-label="Details" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="xl:hidden"><PanelRight aria-hidden /></IconButton>
      <Sheet open={open} onClose={() => setOpen(false)} size="sm" title={title}>{children}</Sheet>
    </>
  );
}
