"use client";

/**
 * The workspace assistant: a floating sparkle bottom right on every page opens a side panel to ask anything about
 * the platform, dictated or typed, in the prompt box from the owner's reference. Replies may carry proposals (add a
 * to-do, clock in, start a timer, open a page); each is a button here that calls the normal endpoint, so the
 * assistant never changes anything on its own.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowUpRight, Check, Play, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { TypingIndicator } from "@/components/ui/chat-messages";
import { useDictation } from "@/hooks/use-dictation";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Action, ChatResult, Proposal } from "@/server/services/copilot";

type Msg = { role: "user" | "assistant"; content: string; actions?: Action[]; proposals?: (Proposal & { done?: string })[]; engine?: ChatResult["engine"]; note?: string | null };

// Where the floating button sits. Dragged positions are remembered per browser; nothing set means bottom right.
const POS_KEY = "boredroom-assistant-pos";
const POS_EVENT = "boredroom:assistant-pos";
const FAB = 56;
const subscribePos = (cb: () => void) => { window.addEventListener(POS_EVENT, cb); window.addEventListener("resize", cb); return () => { window.removeEventListener(POS_EVENT, cb); window.removeEventListener("resize", cb); }; };
const readPos = () => { try { return localStorage.getItem(POS_KEY); } catch { return null; } };
const writePos = (x: number, y: number) => { try { localStorage.setItem(POS_KEY, `${Math.round(x)},${Math.round(y)}`); } catch { /* private mode */ } window.dispatchEvent(new Event(POS_EVENT)); };
const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(8, x), window.innerWidth - FAB - 8), y: Math.min(Math.max(8, y), window.innerHeight - FAB - 8) });

/** The saved position, kept inside the viewport, or null for the default corner. */
function useFloatingPosition() {
  const raw = useSyncExternalStore(subscribePos, readPos, () => null);
  if (raw === null || typeof window === "undefined") return null;
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return clamp(x, y);
}

const STARTERS: Record<"org" | "worker", string[]> = {
  org: ["Who has clocked in today?", "Who is working right now?", "Message everyone: stand-up moves to 10:00 tomorrow", "Create a team called Design"],
  worker: ["What is on my day?", "Clock me in", "Add to-dos: finish the homepage by Friday, then update the deck", "Start the timer on my first task"],
};

export function AssistantDrawer({ orgSlug, isOrg, firstName, floating = false }: { orgSlug: string; isOrg: boolean; firstName: string; floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const dictation = useDictation(text, setText);
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const pos = useFloatingPosition();
  // A press that travels more than a few pixels is a drag: the button follows the pointer and the spot is saved on release.
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, originX: r.left, originY: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    const p = clamp(d.originX + dx, d.originY + dy);
    const el = fabRef.current; if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; el.style.right = "auto"; el.style.bottom = "auto"; el.style.transform = "none"; }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) { const p = clamp(d.originX + (e.clientX - d.startX), d.originY + (e.clientY - d.startY)); writePos(p.x, p.y); return; }
    setOpen((v) => !v);
  };

  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { dictation.stop(); setOpen(false); } }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey); }, [open, dictation]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pending]);

  async function send(content = text) {
    const q = content.trim();
    if (!q || pending) return;
    if (dictation.listening) dictation.stop();
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next); setText(""); setPending(true); setError(null);
    try {
      const r = await api<ChatResult>(`/api/orgs/${orgSlug}/assistant/chat`, { method: "POST", body: { messages: next.slice(-20).map((m) => ({ role: m.role, content: m.content })) }, retries: 0 });
      setMessages((cur) => [...cur, { role: "assistant", content: r.reply, actions: r.actions, proposals: r.proposals, engine: r.engine, note: r.note }]);
      if (r.actions?.length) router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); setMessages(next); }
    finally { setPending(false); }
  }

  async function act(mi: number, pi: number, p: Proposal) {
    const mark = (done: string) => setMessages((cur) => cur.map((m, i) => (i === mi && m.proposals ? { ...m, proposals: m.proposals.map((x, j) => (j === pi ? { ...x, done } : x)) } : m)));
    setError(null);
    try {
      if (p.kind === "open") { setOpen(false); router.push(p.href); return; }
      if (p.kind === "todo") { await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: p.title, description: p.description, dueAt: p.dueAt, assigneeMembershipId: p.assigneeMembershipId, estimateMinutes: p.estimateMinutes } }); mark("Added"); }
      else if (p.kind === "clock_in") { await api(`/api/orgs/${orgSlug}/clock/in`, { method: "POST" }); mark("Clocked in"); }
      else if (p.kind === "clock_out") { await api(`/api/orgs/${orgSlug}/clock/out`, { method: "POST" }); mark("Clocked out"); }
      else if (p.kind === "start_timer") { await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId: p.taskId } }); mark("Started"); }
      router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  }

  const starters = STARTERS[isOrg ? "org" : "worker"];
  const close = () => { dictation.stop(); setOpen(false); };

  return (
    <>
      {floating ? (
        <button ref={fabRef} type="button" aria-label="Assistant" aria-expanded={open} aria-controls="assistant-drawer" title="Assistant. Drag to move it out of the way."
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
          style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
          className={cn("fixed bottom-6 right-6 z-[var(--z-sticky)] grid size-14 touch-none select-none place-items-center rounded-full border text-accent transition-[box-shadow,border-color] duration-[var(--duration)] ease-[var(--ease-out)] cursor-grab active:cursor-grabbing hover:border-accent focus-visible:outline-2 focus-visible:outline-[var(--border-strong)] focus-visible:outline-offset-2",
            "border-accent/50 bg-[linear-gradient(180deg,var(--btn-top),var(--btn-bottom))] shadow-[inset_0_1px_0_var(--highlight),0_0_0_1px_rgba(255,108,2,0.2),0_12px_30px_-8px_rgba(255,108,2,0.55)]", open && !pos && "translate-x-[calc(-26rem+3.5rem)] md:translate-x-0")}>
          <Sparkles className="size-6 pointer-events-none" aria-hidden />
        </button>
      ) : (
        <IconButton aria-label="Assistant" aria-expanded={open} aria-controls="assistant-drawer" title="Assistant" onClick={() => setOpen((v) => !v)} className={cn(open && "border-accent/60 text-accent")}>
          <Sparkles className="size-[18px]" aria-hidden />
        </IconButton>
      )}
      {open ? <button type="button" aria-label="Close assistant" className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--overlay)] md:bg-transparent" onClick={close} /> : null}
      <aside id="assistant-drawer" role="dialog" aria-label="Assistant" aria-hidden={!open} data-refresh-safe
        className={cn("fixed inset-y-0 right-0 z-[var(--z-dialog)] flex w-full max-w-[26rem] flex-col border-l border-border bg-bg-elevated shadow-[var(--card-shadow)] transition-transform duration-[var(--duration)] ease-[var(--ease-out)]", open ? "translate-x-0" : "translate-x-full")}>
        <header className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-accent-soft"><Sparkles className="size-4 text-accent" aria-hidden /></div>
            <div><p className="eyebrow eyebrow-accent">Assistant</p><h2 className="font-display text-lg leading-tight">What do you need, {firstName}?</h2></div>
          </div>
          <IconButton aria-label="Close" onClick={close}><X className="size-[18px]" aria-hidden /></IconButton>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">Ask for anything on the platform and it gets done: {isOrg ? "assign work, message people, create teams, invite someone, see who is working or clocked in" : "add to-dos, start the timer, clock in, message someone, set your status"}. It acts as you, with your permissions.</p>
              <ul className="space-y-1.5">{starters.map((s) => <li key={s}><button type="button" className="chip chip-link w-full px-3 py-2 text-left text-sm" onClick={() => void send(s)}>{s}</button></li>)}</ul>
            </div>
          ) : null}
          {messages.map((m, mi) => (
            <div key={mi} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[90%] space-y-2", m.role === "user" ? "rounded-2xl rounded-tr-md border border-[var(--bubble-mine-border)] bg-[var(--bubble-mine)] px-3.5 py-2.5 text-sm text-fg" : "text-sm")}>
                {m.role === "assistant" ? <div className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><p className="whitespace-pre-wrap">{m.content}</p></div> : <p className="whitespace-pre-wrap">{m.content}</p>}
                {m.actions?.length ? (
                  <ul className="space-y-1.5 pl-6">{m.actions.map((a, ai) => (
                    <li key={ai} className="chip flex items-center gap-2 border-success/30 px-3 py-2 text-sm">
                      <Check className="size-4 shrink-0 text-success" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                      {a.href ? <Button size="sm" variant="ghost" onClick={() => { setOpen(false); router.push(a.href!); }}>Open<ArrowUpRight className="size-3.5" aria-hidden /></Button> : null}
                    </li>
                  ))}</ul>
                ) : null}
                {m.proposals?.length ? (
                  <ul className="space-y-1.5 pl-6">{m.proposals.map((p, pi) => (
                    <li key={pi} className="chip flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {p.kind === "todo" ? <>{p.title}{p.assigneeName ? <span className="text-fg-subtle"> for {p.assigneeName}</span> : null}</> : p.kind === "clock_in" ? "Clock in" : p.kind === "clock_out" ? "Clock out" : p.kind === "start_timer" ? <>Start <span className="text-fg-muted">{p.taskTitle}</span></> : p.label}
                      </span>
                      {p.done ? <span className="text-xs text-success">{p.done}</span> : (
                        <Button size="sm" variant={p.kind === "open" ? "subtle" : "primary"} onClick={() => void act(mi, pi, p)}>
                          {p.kind === "todo" ? <><Plus className="size-3.5" aria-hidden />Add</> : p.kind === "start_timer" ? <><Play className="size-3.5" aria-hidden />Start</> : p.kind === "open" ? <>Open<ArrowUpRight className="size-3.5" aria-hidden /></> : <><AlarmClock className="size-3.5" aria-hidden />{p.kind === "clock_in" ? "Clock in" : "Clock out"}</>}
                        </Button>
                      )}
                    </li>
                  ))}</ul>
                ) : null}
                {m.role === "assistant" && (m.engine === "builtin" || m.note) ? <p className="eyebrow pl-6 normal-case tracking-normal">{m.note ?? "Built-in helper; the AI is not connected yet."}</p> : null}
              </div>
            </div>
          ))}
          {pending ? <TypingIndicator /> : null}
          <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
          <Presence show={!!dictation.error}><Alert tone="warning">{dictation.error}</Alert></Presence>
        </div>

        <div className="border-t border-border-soft p-3">
          <PromptInputBox value={text} onValueChange={setText} onSend={(m) => void send(m)} isLoading={pending} placeholder={isOrg ? "e.g. Who is late today?" : "e.g. What should I start with?"}
            recording={dictation.listening} onToggleRecording={() => void dictation.toggle()} recordingSupported={dictation.supported !== false}
            recordingView={
              <div className="flex items-center gap-3 rounded-[16px] border border-accent/40 bg-accent-soft/40 p-2 pr-3">
                <div className="size-14 shrink-0"><VoicePoweredOrb enableVoiceControl onVoiceDetected={setVoiceActive} className="rounded-full" /></div>
                <p role="status" className="text-xs text-fg-muted">{voiceActive ? "Hearing you…" : dictation.heardWords ? `${dictation.heardWords} word${dictation.heardWords === 1 ? "" : "s"} so far. Press stop or send when you are done.` : "Listening. Speak naturally."}</p>
              </div>
            } />
        </div>
      </aside>
    </>
  );
}
