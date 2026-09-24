"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, MessageSquarePlus, Mic, Trash2 } from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Presence } from "@/components/ui/motion";
import { ConfirmButton } from "@/components/ui/confirm";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import type { Presence as PresenceStatus } from "@/lib/presence";

type TaskRef = { id: string; title: string } | null;

/**
 * The composer. Enter sends, Shift+Enter starts a new line. State lives here, so the live refresh that
 * brings in new messages never touches what is being typed (the form is marked data-refresh-safe).
 */
export function Composer({ orgSlug, conversationId, task, prefill, placeholder }: { orgSlug: string; conversationId: string; task: TaskRef; prefill?: string; placeholder: string }) {
  const router = useRouter();
  const [body, setBody] = useState(prefill ?? "");
  const [attached, setAttached] = useState<TaskRef>(task);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  const voice = useVoiceRecorder();
  const [sendingVoice, setSendingVoice] = useState(false);
  useEffect(() => { ref.current?.focus(); }, [conversationId]);
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
      await api(`/api/orgs/${orgSlug}/messages`, { method: "POST", body: { conversationId, body: text, taskId: attached?.id ?? null } });
      setBody(""); setAttached(null);
      if (ref.current) { ref.current.style.height = "auto"; ref.current.focus(); }
      if (attached) router.replace(`/app/${orgSlug}/messages?c=${conversationId}`);
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Your message was not sent."); }
    finally { setPending(false); }
  };
  return (
    <form data-refresh-safe className="border-t border-border-soft bg-bg px-4 py-3 md:px-6" onSubmit={(e) => { e.preventDefault(); void send(); }}>
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
        {voice.supported && !body.trim() ? <button type="button" aria-label="Record a voice note" title="Record a voice note" disabled={pending} onClick={() => void voice.start()} className="grid size-9 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors duration-[var(--duration-fast)] hover:bg-wash hover:text-fg"><Mic className="size-4" aria-hidden /></button> : null}
        <button type="submit" aria-label="Send" disabled={pending || !body.trim()} className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)] disabled:cursor-not-allowed", body.trim() && !pending ? "bg-[linear-gradient(180deg,var(--accent-hover),var(--accent))] text-accent-fg shadow-[0_6px_18px_-6px_rgba(255,108,2,0.6)] hover:scale-105" : "bg-wash text-fg-subtle")}><Send className="size-4" aria-hidden /></button>
      </div>
      )}
      <p className="eyebrow mt-2 normal-case tracking-normal">{voice.recording ? "Speak, then press Send. Up to ten minutes." : "Enter sends, Shift+Enter starts a new line. The microphone records a voice note."}</p>
    </form>
  );
}

/** "New message": pick a person, land in the direct thread. */
export function NewMessage({ orgSlug, people }: { orgSlug: string; people: { membership_id: string; display_name: string; role: string; teams: string | null; profile_id: string; avatar_key: string | null; presence: PresenceStatus }[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const shown = people.filter((p) => !q.trim() || `${p.display_name} ${p.teams ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const start = async (membershipId: string) => {
    setPending(membershipId); setError(null);
    try { const r = await api<{ id: string }>(`/api/orgs/${orgSlug}/messages/direct`, { method: "POST", body: { membershipId } }); setOpen(false); router.push(`/app/${orgSlug}/messages?c=${r.id}`); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(null); }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog"><MessageSquarePlus className="size-4" aria-hidden />New</Button>
      <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={() => setOpen(false)} onCancel={(e) => { e.preventDefault(); setOpen(false); }}>
        <div className="grid gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 id={titleId} className="font-display text-xl">Message someone</h2><p className="mt-1 text-sm text-fg-muted">Anyone in the organisation, in your team or not.</p></div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></Button>
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
