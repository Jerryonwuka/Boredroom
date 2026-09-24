"use client";

/**
 * Chat bubbles for the messaging page (from the owner's chat-messages reference, 24 September 2026), on the design
 * tokens: the person's own messages sit right in a dark shade of the orange, other people's sit left in grey with their avatar.
 * `TypingIndicator` is the three-dot bubble. `ChatMessages` is the reference's self-playing demo, kept for previews.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Send, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage { id: string; sender: "user" | "assistant"; content: string; timestamp?: string }

export function TypingIndicator({ className }: { className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("inline-flex items-center gap-1 rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3", className)}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-2 w-2 rounded-full bg-fg-muted" animate={{ opacity: [0.4, 1, 0.4], y: [0, -4, 0] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </motion.div>
  );
}

/**
 * One bubble. `mine` sits right in orange; other people's sit left with `avatar` beside the last bubble of a run.
 * `grouped` bubbles (same sender within a few minutes) drop the name and tighten the spacing.
 */
export function MessageBubble({ mine, avatar, name, time, grouped = false, withdrawn = false, children, footer, actions, className }: { mine: boolean; avatar?: ReactNode; name?: string; time?: ReactNode; grouped?: boolean; withdrawn?: boolean; children: ReactNode; footer?: ReactNode; actions?: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97, x: mine ? 14 : -14 }} animate={{ opacity: 1, y: 0, scale: 1, x: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn("group flex w-full", mine ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-3", className)}>
      <div className={cn("flex max-w-[78%] items-end gap-2", mine && "flex-row-reverse")}>
        {!mine ? <div className="w-8 shrink-0">{grouped ? null : avatar}</div> : null}
        <div className="min-w-0">
          {!grouped && !mine && name ? <p className="mb-1 flex items-baseline gap-2 pl-1 text-xs text-fg-subtle"><span className="font-semibold text-fg-muted">{name}</span>{time}</p> : null}
          <div className={cn("relative rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
            withdrawn ? "border border-dashed border-border bg-transparent italic text-fg-subtle"
              : mine ? "rounded-tr-md border border-[var(--bubble-mine-border)] bg-[var(--bubble-mine)] text-fg"
                : "rounded-tl-md border border-[var(--bubble-theirs-border)] bg-[var(--bubble-theirs)] text-fg")}>
            {children}
          </div>
          {footer ? <div className={cn("mt-1", mine ? "text-right" : "pl-1")}>{footer}</div> : null}
          {mine && !grouped && time ? <p className="mt-1 pr-1 text-right text-[11px] text-fg-subtle">{time}</p> : null}
        </div>
        {actions ? <div className="self-center opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover:opacity-100">{actions}</div> : null}
      </div>
    </motion.div>
  );
}

// ---- The reference demo: a conversation that plays itself. Not used by the product; kept for previews. ----

const DEFAULT_MESSAGES: ChatMessage[] = [
  { id: "1", sender: "assistant", content: "Hello. I am the Boredroom assistant. What do you need to get done today?" },
  { id: "2", sender: "user", content: "Finish the homepage design by Friday, then update the brand deck." },
  { id: "3", sender: "assistant", content: "Two to-dos drafted: the homepage design, due Friday at 17:00, and the brand deck. Add them when you are ready." },
];

export function ChatMessages({ messages = DEFAULT_MESSAGES, autoPlay = true, autoPlayDelay = 1800, typingDuration = 1400, showReplay = true, interactive = false, className }: { messages?: ChatMessage[]; autoPlay?: boolean; autoPlayDelay?: number; typingDuration?: number; showReplay?: boolean; interactive?: boolean; className?: string }) {
  const [visibleCount, setVisibleCount] = useState(autoPlay ? 0 : messages.length);
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playing = useRef(false);
  // The reveal calls itself for the next message; it goes through a ref so the callback need not name itself.
  const revealRef = useRef<(index: number) => void>(() => {});

  const scrollToBottom = useCallback(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, []);
  const revealNext = useCallback(async (index: number) => {
    if (index >= chatMessages.length) { playing.current = false; return; }
    const message = chatMessages[index];
    if (message.sender === "assistant") { setIsTyping(true); await new Promise((r) => setTimeout(r, typingDuration)); setIsTyping(false); }
    setVisibleCount(index + 1);
    await new Promise((r) => setTimeout(r, 100));
    scrollToBottom();
    await new Promise((r) => setTimeout(r, autoPlayDelay - (message.sender === "assistant" ? typingDuration : 0) - 100));
    if (playing.current) revealRef.current(index + 1);
  }, [chatMessages, autoPlayDelay, typingDuration, scrollToBottom]);
  useEffect(() => { revealRef.current = (i) => { void revealNext(i); }; }, [revealNext]);
  const replay = useCallback(() => { setVisibleCount(0); setChatMessages(messages); playing.current = true; setTimeout(() => revealNext(0), 100); }, [messages, revealNext]);

  useEffect(() => {
    if (!autoPlay) return;
    playing.current = true;
    const timer = setTimeout(() => revealNext(0), 500);
    return () => { clearTimeout(timer); playing.current = false; };
  }, [autoPlay, revealNext]);
  useEffect(() => { scrollToBottom(); }, [visibleCount, isTyping, scrollToBottom]);

  const handleSend = () => {
    if (!inputValue.trim() || !interactive) return;
    setChatMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", content: inputValue.trim() }]);
    setInputValue(""); setVisibleCount((prev) => prev + 1);
    setTimeout(() => { setChatMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, sender: "assistant", content: "Noted. I will draft that as a to-do." }]); setVisibleCount((prev) => prev + 1); }, typingDuration + 500);
  };

  return (
    <div className={cn("tile relative flex flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-full bg-accent-soft"><Sparkles className="size-4 text-accent" /></div>
          <div><h3 className="text-sm font-medium">Assistant</h3><p className="text-xs text-fg-subtle">Always here to help</p></div>
        </div>
        {showReplay ? <button type="button" onClick={replay} aria-label="Replay conversation" className="chip chip-link flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-muted"><RotateCcw className="size-3.5" />Replay</button> : null}
      </div>
      <div ref={scrollRef} role="log" aria-label="Chat messages" aria-live="polite" className="flex-1 overflow-y-auto p-4">
        {chatMessages.slice(0, visibleCount).map((m) => (
          <MessageBubble key={m.id} mine={m.sender === "user"} avatar={<div className="grid size-8 place-items-center rounded-full bg-accent-soft"><Sparkles className="size-4 text-accent" /></div>}>{m.content}</MessageBubble>
        ))}
        <AnimatePresence>{isTyping ? <div className="mt-3"><TypingIndicator /></div> : null}</AnimatePresence>
      </div>
      <div className="border-t border-border-soft p-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-inset px-4 py-2 focus-within:border-border-strong">
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} disabled={!interactive}
            placeholder={interactive ? "Ask the assistant…" : "Demo, press Replay to watch again"} aria-label={interactive ? "Type your message" : "Chat input (demo)"} className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed" />
          <button type="button" onClick={handleSend} disabled={!interactive || !inputValue.trim()} aria-label="Send message" className={cn("grid size-8 place-items-center rounded-lg transition-colors", interactive && inputValue.trim() ? "bg-accent text-accent-fg" : "bg-wash text-fg-subtle")}><Send className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}

export default ChatMessages;
