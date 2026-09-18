"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Presence } from "@/components/ui/motion";
import { ConfirmButton } from "@/components/ui/confirm";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
  useEffect(() => { ref.current?.focus(); }, [conversationId]);
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
    <form data-refresh-safe className="border-t border-border-soft bg-elevated p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Presence show={!!attached}>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="text-fg-subtle">About</span>
          <Link href={`/app/${orgSlug}/tasks/${attached?.id}`} className="truncate rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 font-medium text-accent hover:underline">{attached?.title}</Link>
          <button type="button" aria-label="Remove the task from this message" className="rounded-full p-1 text-fg-subtle hover:text-fg" onClick={() => setAttached(null)}><X className="size-3.5" aria-hidden /></button>
        </div>
      </Presence>
      <Presence show={!!error}><p id={errId} role="alert" className="mb-2 text-sm text-danger">{error}</p></Presence>
      <div className="flex items-end gap-2">
        <textarea ref={ref} value={body} rows={1} placeholder={placeholder} aria-label="Message" aria-describedby={error ? errId : undefined} disabled={pending}
          className="max-h-[200px] min-h-11 flex-1 resize-none rounded-[var(--radius-sm)] border border-border-strong bg-inset px-3.5 py-2.5 text-base text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50"
          onChange={(e) => { setBody(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <Button type="submit" size="icon" aria-label="Send" disabled={pending || !body.trim()}><Send className="size-4" aria-hidden /></Button>
      </div>
      <p className="mt-1.5 text-xs text-fg-subtle">Enter sends, Shift+Enter starts a new line.</p>
    </form>
  );
}

/** "New message": pick a person, land in the direct thread. */
export function NewMessage({ orgSlug, people }: { orgSlug: string; people: { membership_id: string; display_name: string; role: string; teams: string | null }[] }) {
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
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog"><MessageSquarePlus className="size-4" aria-hidden />New message</Button>
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
                  <span className="min-w-0"><span className="block truncate font-medium">{p.display_name}</span><span className="block truncate text-xs text-fg-subtle">{[ROLE[p.role] ?? p.role, p.teams].filter(Boolean).join(", ")}</span></span>
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
