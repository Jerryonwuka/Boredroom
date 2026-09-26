"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, MessageSquarePlus, Mic, Trash2, MoreHorizontal, Copy, Pencil, Flag, Plus, Users, Archive, ArchiveRestore, Hash, Reply, Bell, BellOff, Mail, MailOpen } from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Button } from "@/components/ui/button";
import { Input, Textarea, InputAdorned } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { liftToTopLayer } from "@/components/ui/top-layer";
import { Avatar } from "@/components/ui/avatar";
import type { Presence as PresenceStatus } from "@/lib/presence";

type TaskRef = { id: string; title: string } | null;

// ---- Replying (owner decision, 26 September 2026): pick a message anywhere in the thread, the composer quotes it -------

export type ReplyRef = { id: string; name: string; body: string } | null;
const ReplyContext = createContext<{ reply: ReplyRef; setReply: (r: ReplyRef) => void }>({ reply: null, setReply: () => {} });

/** Holds the message being replied to between the bubbles and the composer. Keyed by conversation on the page, so it resets on switch. */
export function ReplyProvider({ children }: { children: ReactNode }) {
  const [reply, setReply] = useState<ReplyRef>(null);
  return <ReplyContext.Provider value={{ reply, setReply }}>{children}</ReplyContext.Provider>;
}
export const useReply = () => useContext(ReplyContext);

/**
 * The composer. Enter sends, Shift+Enter starts a new line. State lives here, so the live refresh that
 * brings in new messages never touches what is being typed (the form is marked data-refresh-safe).
 */
export function Composer({ orgSlug, conversationId, task, prefill, placeholder, canVoice = true }: { canVoice?: boolean; orgSlug: string; conversationId: string; task: TaskRef; prefill?: string; placeholder: string }) {
  const router = useRouter();
  const [body, setBody] = useState(prefill ?? "");
  const [attached, setAttached] = useState<TaskRef>(task);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  const voice = useVoiceRecorder();
  const [sendingVoice, setSendingVoice] = useState(false);
  const { reply, setReply } = useReply();
  useEffect(() => { ref.current?.focus(); }, [conversationId]);
  useEffect(() => { if (reply) ref.current?.focus(); }, [reply]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const sendVoice = async () => {
    const note = await voice.stop();
    if (!note) { setError("Nothing was recorded."); return; }
    setSendingVoice(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", note.blob, `voice.${note.type.split("/")[1]}`); fd.append("conversationId", conversationId); fd.append("seconds", String(note.seconds));
      const res = await fetch(`/api/orgs/${orgSlug}/messages/voice`, { method: "POST", body: fd, credentials: "same-origin" });
      if (!res.ok) { const data = await res.json().catch(() => null); throw new Error(data?.message ?? "The voice note was not sent."); }
      router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setSendingVoice(false); }
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
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Your message was not sent."); }
    finally { setPending(false); }
  };
  return (
    <form data-refresh-safe className="border-t border-border-soft bg-bg px-4 py-3 md:px-6" onSubmit={(e) => { e.preventDefault(); void send(); }} onKeyDown={(e) => { if (e.key === "Escape" && reply) { e.preventDefault(); setReply(null); } }}>
      <Presence show={!!reply}>
        <div className="mb-2 flex items-center gap-3 rounded-[var(--radius-sm)] border border-border-soft bg-wash py-1.5 pl-3 pr-1.5 text-sm">
          <span className="h-8 w-0.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <Reply className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-fg-muted">Replying to {reply?.name}</span><span className="block truncate text-xs text-fg-subtle">{reply?.body}</span></span>
          <button type="button" aria-label="Stop replying" className="grid size-7 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors duration-[var(--duration-fast)] hover:bg-wash-strong hover:text-fg" onClick={() => setReply(null)}><X className="size-3.5" aria-hidden /></button>
        </div>
      </Presence>
      <Presence show={!!attached}>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="text-fg-subtle">About</span>
          <Link href={`/app/${orgSlug}/tasks/${attached?.id}`} className="truncate whitespace-nowrap rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 font-medium text-accent hover:underline">{attached?.title}</Link>
          <button type="button" aria-label="Remove the task from this message" className="rounded-full p-1 text-fg-subtle hover:text-fg" onClick={() => setAttached(null)}><X className="size-3.5" aria-hidden /></button>
        </div>
      </Presence>
      <Presence show={!!(error ?? voice.error)}><p id={errId} role="alert" className="mb-2 text-sm text-danger">{error ?? voice.error}</p></Presence>
      {voice.recording ? (
        <div className="flex items-center gap-3 rounded-[22px] border border-accent/50 bg-[linear-gradient(180deg,var(--surface-top),var(--surface-bottom))] p-2 pr-3 shadow-[var(--card-shadow)]">
          <div className="size-14 shrink-0"><VoicePoweredOrb enableVoiceControl className="rounded-full" /></div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow eyebrow-accent">Recording</p>
            <p role="timer" className="font-display text-2xl tabular-nums leading-tight">{fmt(voice.seconds)}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => voice.cancel()} disabled={sendingVoice}><Trash2 className="size-4" aria-hidden />Cancel</Button>
          <Button type="button" size="sm" onClick={() => void sendVoice()} disabled={sendingVoice || voice.seconds < 1}><Send className="size-4" aria-hidden />{sendingVoice ? "Sending…" : "Send"}</Button>
        </div>
      ) : (
      <div className="flex items-end gap-2 rounded-[22px] border border-border bg-[linear-gradient(180deg,var(--surface-top),var(--surface-bottom))] p-1.5 pl-4 shadow-[var(--card-shadow)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-border-strong">
        <textarea ref={ref} value={body} rows={1} placeholder={placeholder} aria-label="Message" aria-describedby={error ? errId : undefined} disabled={pending}
          className="prompt-scroll max-h-[200px] min-h-10 flex-1 resize-none self-center bg-transparent py-2 text-base text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
          onChange={(e) => { setBody(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {canVoice && voice.supported && !body.trim() ? <button type="button" aria-label="Record a voice note" disabled={pending} onClick={() => void voice.start()} className="grid size-9 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors duration-[var(--duration-fast)] hover:bg-wash hover:text-fg"><Mic className="size-4" aria-hidden /></button> : null}
        <button type="submit" aria-label="Send" disabled={pending || !body.trim()} className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)] disabled:cursor-not-allowed", body.trim() && !pending ? "bg-accent hover:bg-[var(--accent-hover)] text-accent-fg hover:scale-105" : "bg-wash text-fg-subtle")}><Send className="size-4" aria-hidden /></button>
      </div>
      )}
      <p className="eyebrow mt-2 normal-case tracking-normal">{voice.recording ? "Speak, then press Send. Up to ten minutes." : "Enter sends, Shift+Enter starts a new line. The microphone records a voice note."}</p>
    </form>
  );
}

/**
 * The one "New" button on Messages (owner decision, 26 September 2026): orange, and it asks which kind of new,
 * a channel or a direct thread with someone, instead of two buttons side by side.
 */
export function NewConversation({ orgSlug, people }: { orgSlug: string; people: Person[] }) {
  const { open, setOpen, pos, btn, root, show } = useMenu(256);
  const [sheet, setSheet] = useState<"channel" | "person" | null>(null);
  return (
    <div ref={root} className="relative">
      <Button ref={btn} size="sm" aria-haspopup="menu" aria-expanded={open} onClick={show}><Plus className="size-4" aria-hidden />New</Button>
      <Menu open={open} pos={pos} label="New" className="w-64">
        <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setSheet("channel"); }}><Hash className="size-4" aria-hidden /><span><span className="block text-fg">New channel</span><span className="block text-xs text-fg-subtle">A room for a topic or a group</span></span></button>
        <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setSheet("person"); }}><MessageSquarePlus className="size-4" aria-hidden /><span><span className="block text-fg">Message someone</span><span className="block text-xs text-fg-subtle">A direct thread with a teammate</span></span></button>
      </Menu>
      <NewChannel orgSlug={orgSlug} people={people} open={sheet === "channel"} onClose={() => setSheet(null)} />
      <NewMessage orgSlug={orgSlug} people={people} open={sheet === "person"} onClose={() => setSheet(null)} />
    </div>
  );
}

/** "Message someone": pick a person, land in the direct thread. */
export function NewMessage({ orgSlug, people, open, onClose }: { orgSlug: string; people: Person[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const shown = people.filter((p) => !q.trim() || `${p.display_name} ${p.teams ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const start = async (membershipId: string) => {
    setPending(membershipId); setError(null);
    try { const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/messages/direct`, { method: "POST", body: { membershipId } }); onClose(); router.push(`/app/${orgSlug}/messages?c=${r.id}`); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(null); }
  };
  return (
    <>
      <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
        <div className="grid gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 id={titleId} className="font-display text-xl">Message someone</h2><p className="mt-1 text-sm text-fg-muted">Anyone in the organisation, in your team or not.</p></div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
          </div>
          <Input aria-label="Search people" placeholder="Search by name or team…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <ul className="max-h-72 divide-y divide-border-soft overflow-y-auto rounded-[var(--radius-sm)] border border-border-soft">
            {shown.length === 0 ? <li className="p-3 text-sm text-fg-muted">{people.length === 0 ? "Nobody else has joined yet." : "No one matches that."}</li> : shown.map((p) => (
              <li key={p.membership_id}>
                <button type="button" disabled={pending !== null} onClick={() => start(p.membership_id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-accent-soft/60 disabled:opacity-50">
                  <Avatar profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} presence={p.presence} size={32} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.display_name}</span><span className="block truncate text-xs text-fg-subtle">{[ROLE[p.role] ?? p.role, p.teams].filter(Boolean).join(", ")}</span></span>
                  <span className="text-xs text-fg-subtle">{pending === p.membership_id ? "Opening…" : "Message"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
const ROLE: Record<string, string> = { owner: "Organisation owner", hr: "HR", manager: "Team lead", employee: "Staff" };

/** Keeps the thread scrolled to the newest message as new ones arrive. */
export function ScrollToLatest({ count, conversationId }: { count: number; conversationId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "end" }); }, [count, conversationId]);
  return <div ref={ref} aria-hidden />;
}

export function WithdrawMessage({ orgSlug, id, className }: { orgSlug: string; id: string; className?: string }) {
  const router = useRouter();
  return (
    <ConfirmButton size="sm" variant="ghost" className={cn("h-7 px-2 text-xs", className)} title="Withdraw this message?" description="It is removed for everyone in the conversation. The line stays so the thread keeps its shape." confirmLabel="Withdraw"
      onConfirm={async () => { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "DELETE" }); router.refresh(); }}>
      Withdraw
    </ConfirmButton>
  );
}

// ---- Menus and sheets (owner decision, 25 September 2026): one burger per message and per conversation ---------------

function useMenu(width = 208) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos>({ top: 0, left: 0, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    // Below the button unless that would run off the bottom of the screen; then it opens upward from the button's top.
    if (r) { const up = r.bottom + 6 + 220 > window.innerHeight && r.top > window.innerHeight - r.bottom; setPos({ top: up ? r.top - 6 : r.bottom + 6, up, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) }); }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    // The menu itself is portaled to the body (see Menu), so a press inside it must not count as outside.
    const onDown = (e: MouseEvent) => { const t = e.target as Element | null; if (root.current && !root.current.contains(t) && !t?.closest?.("[data-menu]")) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, pos, btn, root, show };
}

const MENU_ITEM = "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm text-fg-muted transition-colors duration-[var(--duration-fast)] hover:bg-wash hover:text-fg disabled:opacity-40";

/**
 * The pop-up itself. Rendered into the body: a fixed box inside a transformed or scrolling ancestor (the hover burger
 * on a list row, the scrolling thread) would be measured from that ancestor and clipped by it.
 */
type MenuPos = { top: number; left: number; up: boolean };

function Menu({ open, pos, children, label, className }: { open: boolean; pos: MenuPos; children: ReactNode; label: string; className?: string }) {
  if (typeof document === "undefined") return null;
  const lift = pos.up ? 4 : -4;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div ref={liftToTopLayer} key="menu" role="menu" aria-label={label} data-menu initial={{ opacity: 0, y: lift, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: lift, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
          style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }} className={cn("top-pop w-52 rounded-[var(--radius)] border border-border-strong bg-popover p-1.5 shadow-[var(--card-shadow)]", className)}>
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** A small sheet with one textarea: used to edit a message and to report one. */
function TextSheet({ onClose, title, description, label, initial = "", submitLabel, danger = false, onSubmit }: { onClose: () => void; title: string; description?: string; label: string; initial?: string; submitLabel: string; danger?: boolean; onSubmit: (text: string) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  // Mounted only while open, so opening is just showing the dialog and state starts fresh each time.
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <form className="grid gap-3 p-5" onSubmit={async (e) => { e.preventDefault(); setPending(true); setError(null); try { await onSubmit(text); onClose(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>
        <div className="flex items-start justify-between gap-3"><div><h2 id={titleId} className="font-display text-xl">{title}</h2>{description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}</div><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button></div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <label className="grid gap-1.5"><span className="eyebrow">{label}</span><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} required autoFocus /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending || !text.trim()}>{pending ? "Working…" : submitLabel}</Button></div>
      </form>
    </dialog>
  );
}

const HOVER_BTN = "grid size-7 place-items-center rounded-full border border-transparent text-fg-subtle transition-colors duration-[var(--duration-fast)] hover:border-border hover:bg-wash hover:text-fg";

/** The actions beside a message: a reply arrow, and a burger with copy, edit and withdraw for your own, copy and report for everyone else's. */
export function MessageMenu({ orgSlug, id, mine, body, isVoice, senderName, canReply = true }: { orgSlug: string; id: string; mine: boolean; body: string; isVoice: boolean; senderName: string; canReply?: boolean }) {
  const router = useRouter();
  const { open, setOpen, pos, btn, root, show } = useMenu();
  const { setReply } = useReply();
  const [sheet, setSheet] = useState<"edit" | "report" | "withdraw" | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } setOpen(false); };
  const startReply = () => { setOpen(false); setReply({ id, name: mine ? "yourself" : senderName, body: isVoice ? "Voice note" : body }); };
  return (
    <div ref={root} className={cn("relative flex items-center gap-0.5", mine && "flex-row-reverse")}>
      {canReply ? <button type="button" aria-label="Reply" onClick={startReply} className={HOVER_BTN}><Reply className="size-4" aria-hidden /></button> : null}
      <button ref={btn} type="button" aria-label="Message actions" aria-haspopup="menu" aria-expanded={open} onClick={show} className={HOVER_BTN}><MoreHorizontal className="size-4" aria-hidden /></button>
      <Menu open={open} pos={pos} label="Message actions">
        {canReply ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={startReply}><Reply className="size-4" aria-hidden />Reply</button> : null}
        {!isVoice ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={copy}><Copy className="size-4" aria-hidden />{copied ? "Copied" : "Copy text"}</button> : null}
        {mine && !isVoice ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setSheet("edit"); }}><Pencil className="size-4" aria-hidden />Edit</button> : null}
        {mine ? <button type="button" role="menuitem" className={cn(MENU_ITEM, "text-danger hover:text-danger")} onClick={() => { setOpen(false); setSheet("withdraw"); }}><Trash2 className="size-4" aria-hidden />Withdraw</button> : null}
        {!mine ? <button type="button" role="menuitem" className={cn(MENU_ITEM, "text-warning hover:text-warning")} onClick={() => { setOpen(false); setSheet("report"); }}><Flag className="size-4" aria-hidden />Report</button> : null}
      </Menu>
      {sheet === "edit" ? <TextSheet onClose={() => setSheet(null)} title="Edit message" label="Message" initial={body} submitLabel="Save" onSubmit={async (text) => { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "PATCH", body: { body: text }, retries: 0 }); router.refresh(); }} /> : null}
      {sheet === "report" ? <TextSheet onClose={() => setSheet(null)} title="Report this message" description="The organisation owner and HR are told, with your reason. The sender is not." label="What is wrong with it" submitLabel="Send report" danger onSubmit={async (text) => { await api(`/api/orgs/${orgSlug}/messages/${id}/report`, { method: "POST", body: { reason: text }, retries: 0 }); }} /> : null}
      <ConfirmDialog open={sheet === "withdraw"} onClose={() => setSheet(null)} title="Withdraw this message?" description="It is removed for everyone in the conversation. The line stays so the thread keeps its shape." confirmLabel="Withdraw" onConfirm={async () => { await api(`/api/orgs/${orgSlug}/messages/${id}`, { method: "DELETE", retries: 0 }); router.refresh(); }} />
    </div>
  );
}

type Person = { membership_id: string; display_name: string; role: string; teams: string | null; profile_id: string; avatar_key: string | null; presence: PresenceStatus };

/** A checklist of people for a channel. */
function PeoplePicker({ people, chosen, onChange }: { people: Person[]; chosen: Set<string>; onChange: (next: Set<string>) => void }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => p.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="grid gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" />
      <ul className="prompt-scroll max-h-56 space-y-0.5 overflow-y-auto">
        {list.map((p) => (
          <li key={p.membership_id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-wash">
              <input type="checkbox" checked={chosen.has(p.membership_id)} onChange={(e) => { const next = new Set(chosen); if (e.target.checked) next.add(p.membership_id); else next.delete(p.membership_id); onChange(next); }} />
              <Avatar profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{p.display_name}</span><span className="block truncate text-xs text-fg-subtle">{p.teams ?? p.role}</span></span>
            </label>
          </li>
        ))}
        {list.length === 0 ? <li className="px-2 py-3 text-center text-xs text-fg-subtle">Nobody matches.</li> : null}
      </ul>
      <p className="text-xs text-fg-subtle">{chosen.size} chosen. You are always in.</p>
    </div>
  );
}

/** Start a channel: a name and the people in it. Mounted only while open, so every opening starts blank. */
export function NewChannel({ orgSlug, people, open, onClose }: { orgSlug: string; people: Person[]; open: boolean; onClose: () => void }) {
  return open ? <NewChannelSheet orgSlug={orgSlug} people={people} onClose={onClose} /> : null;
}

function NewChannelSheet({ orgSlug, people, onClose }: { orgSlug: string; people: Person[]; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
      <form className="grid gap-4 p-5" onSubmit={async (e) => { e.preventDefault(); setPending(true); setError(null); try { const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/messages/channels`, { method: "POST", body: { title, memberIds: [...chosen] }, retries: 0 }); onClose(); router.push(`/app/${orgSlug}/messages?c=${r.id}`); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>
        <div className="flex items-start justify-between gap-3"><div><h2 id={titleId} className="font-display text-xl">New channel</h2><p className="mt-1 text-sm text-fg-muted">A named room for a topic or a group. You can add or remove people later.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button></div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <label className="grid gap-1.5"><span className="eyebrow">Channel name</span><InputAdorned prefix="#" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required placeholder="launch-week" autoFocus /></label>
        <div><p className="eyebrow mb-1.5">People</p><PeoplePicker people={people} chosen={chosen} onChange={setChosen} /></div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !title.trim()}>{pending ? "Creating…" : "Create channel"}</Button></div>
      </form>
    </dialog>
  );
}

/**
 * The burger that slides in when a conversation in the list is hovered (owner decision, 26 September 2026): mark it
 * unread or read, mute or unmute, archive or restore a channel you run, delete a chat or channel.
 */
export function ConversationRowMenu({ orgSlug, conversation, active }: { orgSlug: string; conversation: { id: string; kind: string; title: string; unread: number; muted: boolean; archived_at: string | null; can_manage: boolean }; active: boolean }) {
  const router = useRouter();
  const { open, setOpen, pos, btn, root, show } = useMenu();
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [pending, setPending] = useState(false);
  const c = conversation;
  const patch = async (body: Record<string, unknown>) => { setOpen(false); setPending(true); try { await api(`/api/orgs/${orgSlug}/messages/conversations/${c.id}`, { method: "PATCH", body, retries: 0 }); router.refresh(); } finally { setPending(false); } };
  const isChannel = c.kind === "channel";
  const canDelete = c.kind === "direct" || (isChannel && c.can_manage);
  return (
    <div ref={root} className={cn("absolute right-2 top-1/2 -translate-y-1/2 transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]", open ? "translate-x-0 opacity-100" : "translate-x-1.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 focus-within:translate-x-0 focus-within:opacity-100")}>
      <IconButton ref={btn} aria-label={`Actions for ${c.title}`} aria-haspopup="menu" aria-expanded={open} disabled={pending} onClick={(e) => { e.preventDefault(); e.stopPropagation(); show(); }} className="size-7 border-border-strong bg-[var(--bg-popover)]"><MoreHorizontal className="size-3.5" aria-hidden /></IconButton>
      <Menu open={open} pos={pos} label={`Actions for ${c.title}`}>
        {!active ? (c.unread > 0
          ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ unread: false })}><MailOpen className="size-4" aria-hidden />Mark as read</button>
          : <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ unread: true })}><Mail className="size-4" aria-hidden />Mark as unread</button>) : null}
        {c.muted
          ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ muted: false })}><Bell className="size-4" aria-hidden />Unmute</button>
          : <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ muted: true })}><BellOff className="size-4" aria-hidden />Mute</button>}
        {isChannel && c.can_manage ? (c.archived_at
          ? <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ archived: false })}><ArchiveRestore className="size-4" aria-hidden />Restore</button>
          : <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => void patch({ archived: true })}><Archive className="size-4" aria-hidden />Archive</button>) : null}
        {canDelete ? <button type="button" role="menuitem" className={cn(MENU_ITEM, "text-danger hover:text-danger")} onClick={() => { setOpen(false); setConfirm("delete"); }}><Trash2 className="size-4" aria-hidden />{isChannel ? "Delete channel" : "Delete chat"}</button> : null}
      </Menu>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title={isChannel ? `Delete #${c.title}?` : `Delete the chat with ${c.title}?`}
        description={isChannel ? "Every message in it is removed for everyone. Archive it instead if you might want it back." : "It disappears from your list. The other person keeps their copy, and it comes back here if they write to you again."}
        confirmLabel={isChannel ? "Delete channel" : "Delete chat"}
        onConfirm={async () => { await api(`/api/orgs/${orgSlug}/messages/conversations/${c.id}`, { method: "DELETE", retries: 0 }); if (active) router.push(`/app/${orgSlug}/messages`); router.refresh(); }} />
    </div>
  );
}

/** The burger on a conversation header: manage people, rename, archive or restore, delete; hide a direct thread. */
export function ConversationMenu({ orgSlug, conversation, people, memberIds }: { orgSlug: string; conversation: { id: string; kind: string; title: string; archived_at: string | null; can_manage: boolean; other_membership_id?: string | null }; people: Person[]; memberIds: string[] }) {
  const router = useRouter();
  const { open, setOpen, pos, btn, root, show } = useMenu();
  const [sheet, setSheet] = useState<"people" | "rename" | "delete" | "hide" | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(memberIds));
  const [pending, setPending] = useState(false);
  const peopleRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { if (sheet === "people") peopleRef.current?.showModal(); else peopleRef.current?.close(); }, [sheet]);
  const patch = async (body: Record<string, unknown>) => { setPending(true); try { await api(`/api/orgs/${orgSlug}/messages/conversations/${conversation.id}`, { method: "PATCH", body, retries: 0 }); router.refresh(); } finally { setPending(false); } };
  const isChannel = conversation.kind === "channel";
  if (!isChannel && conversation.kind !== "direct") return null;
  return (
    <div ref={root} className="relative">
      <IconButton ref={btn} aria-label="Conversation actions" aria-haspopup="menu" aria-expanded={open} onClick={show} className="size-9"><MoreHorizontal className="size-4" aria-hidden /></IconButton>
      <Menu open={open} pos={pos} label="Conversation actions">
        {isChannel && conversation.can_manage ? <>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setChosen(new Set(memberIds)); setSheet("people"); }}><Users className="size-4" aria-hidden />People</button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); setSheet("rename"); }}><Pencil className="size-4" aria-hidden />Rename</button>
          <button type="button" role="menuitem" className={MENU_ITEM} disabled={pending} onClick={() => { setOpen(false); void patch({ archived: !conversation.archived_at }); }}><Archive className="size-4" aria-hidden />{conversation.archived_at ? "Restore" : "Archive"}</button>
          <button type="button" role="menuitem" className={cn(MENU_ITEM, "text-danger hover:text-danger")} onClick={() => { setOpen(false); setSheet("delete"); }}><Trash2 className="size-4" aria-hidden />Delete channel</button>
        </> : null}
        {isChannel && !conversation.can_manage ? <p className="px-2.5 py-2 text-xs text-fg-subtle">Only the person who made this channel, the owner or HR can change it.</p> : null}
        {conversation.kind === "direct" ? <button type="button" role="menuitem" className={cn(MENU_ITEM, "text-danger hover:text-danger")} onClick={() => { setOpen(false); setSheet("hide"); }}><Trash2 className="size-4" aria-hidden />Delete chat</button> : null}
      </Menu>
      <dialog ref={peopleRef} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); setSheet(null); }} onClose={() => setSheet(null)}>
        <form className="grid gap-4 p-5" onSubmit={async (e) => { e.preventDefault(); await patch({ memberIds: [...chosen] }); setSheet(null); }}>
          <div className="flex items-start justify-between gap-3"><h2 id={titleId} className="font-display text-xl">People in #{conversation.title}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => setSheet(null)}><X className="size-4" aria-hidden /></Button></div>
          <PeoplePicker people={people} chosen={chosen} onChange={setChosen} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSheet(null)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save people"}</Button></div>
        </form>
      </dialog>
      {sheet === "rename" ? <TextSheet onClose={() => setSheet(null)} title="Rename channel" label="Channel name" initial={conversation.title} submitLabel="Rename" onSubmit={async (text) => { await patch({ title: text.trim().slice(0, 80) }); }} /> : null}
      <ConfirmDialog open={sheet === "delete"} onClose={() => setSheet(null)} title={`Delete #${conversation.title}?`} description="Every message in it is removed for everyone. Archive it instead if you might want it back." confirmLabel="Delete channel" onConfirm={async () => { await api(`/api/orgs/${orgSlug}/messages/conversations/${conversation.id}`, { method: "DELETE", retries: 0 }); router.push(`/app/${orgSlug}/messages`); router.refresh(); }} />
      <ConfirmDialog open={sheet === "hide"} onClose={() => setSheet(null)} title="Delete this chat?" description="It disappears from your list. The other person keeps their copy, and it comes back here if they write to you again." confirmLabel="Delete chat" onConfirm={async () => { await api(`/api/orgs/${orgSlug}/messages/conversations/${conversation.id}`, { method: "DELETE", retries: 0 }); router.push(`/app/${orgSlug}/messages`); router.refresh(); }} />
    </div>
  );
}
