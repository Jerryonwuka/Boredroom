"use client";

/**
 * Chat bubbles for the messaging page (from the owner's chat-messages reference, 24 September 2026), on the design
 * tokens. v4: the person's own messages sit right on a solid grey (grey-100), other people's sit left on fill-0 with a
 * hairline, 14/20 regular; no colour, no gradient.
 * `TypingIndicator` is the three-dot bubble. `ChatMessages` is the reference's self-playing demo, kept for previews.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { AnimatedRotateCcw, AnimatedSend } from "@/components/ui/animated-icons";
import { BrendaFace } from "@/components/app/brenda-face";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatMessage { id: string; sender: "user" | "assistant"; content: string; timestamp?: string }

export function TypingIndicator({ className }: { className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("inline-flex items-center gap-1 rounded-2xl rounded-tl-md border border-border bg-fill-0 px-4 py-3", className)}>
      {/* v4: nothing bounces; the dots only fade in turn. */}
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-secondary" animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </motion.div>
  );
}

/**
 * One bubble, v4. `mine` sits right on the solid grey (grey-100), other people's sit left on fill-0 with a hairline;
 * 14/20 regular in the foreground, r16 with the corner nearest the sender tucked to r6 on the first bubble of a run.
 * The sender's `avatar` (32px) stands beside the first bubble of a run on both sides (owner decision, 26 September
 * 2026). `grouped` bubbles (same sender within a few minutes) drop the name, keep the full radius and sit 4px apart.
 * `quote` is the message this one replies to, shown inside the bubble above the text. The reply and menu buttons show
 * on hover and keyboard focus, and while their menu is open; a touch screen has no hover, so there they always show.
 * `nameAdornment` sits after the name and the time (so a narrow column wraps the chip, not the time), in the name row of other people's messages; `timeAdornment`
 * before the time under your own (personal assistants, phase 3, owner decision, 8 October 2026: the "via Max" chip and
 * an assistant's "Olu's assistant" tag). Both rows wrap at narrow widths rather than push the bubble wider.
 *
 * Motion answers an action: a bubble fades up 6px only when it arrives on its own (a new message, yours or theirs). A
 * thread that opens, or a page that loads with its conversation, shows its bubbles at rest: bubbles that mount in the
 * same commit are a batch and do not move, and the server HTML is drawn visible instead of waiting for the script.
 */
const arriving: { el: HTMLElement; mine: boolean }[] = [];
function queueEntrance(el: HTMLElement, mine: boolean) {
  arriving.push({ el, mine });
  if (arriving.length > 1) return;
  // Layout effects of one commit all run before this microtask, and the microtask runs before the browser paints.
  queueMicrotask(() => {
    const batch = arriving.splice(0);
    if (batch.length !== 1) return;
    const { el: one, mine: own } = batch[0];
    one.style.opacity = "0";
    animate(one, { opacity: [0, 1], x: [own ? 6 : -6, 0], y: [6, 0] }, { duration: 0.2, ease: [0.23, 1, 0.32, 1] });
  });
}

export function MessageBubble({ mine, avatar, name, time, grouped = false, withdrawn = false, children, footer, actions, quote, nameAdornment, timeAdornment, className }: { mine: boolean; avatar?: ReactNode; name?: string; time?: ReactNode; grouped?: boolean; withdrawn?: boolean; children: ReactNode; footer?: ReactNode; actions?: ReactNode; quote?: ReactNode; nameAdornment?: ReactNode; timeAdornment?: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  // Once, on mount: whether it moves is decided by what else mounted with it (see queueEntrance).
  const entrance = useRef({ mine, reduced });
  useLayoutEffect(() => { if (ref.current && !entrance.current.reduced) queueEntrance(ref.current, entrance.current.mine); }, []);
  return (
    <div ref={ref} className={cn("group flex w-full", mine ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-4", className)}>
      <div className={cn("flex max-w-[min(80%,40rem)] items-end gap-2", mine && "flex-row-reverse")}>
        {avatar ? <div className="w-8 shrink-0">{grouped ? null : avatar}</div> : null}
        <div className="min-w-0">
          {!grouped && !mine && name ? <p className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-1"><span className="text-meta font-semibold text-foreground">{name}</span><span className="text-xs font-medium text-subtle">{time}</span>{nameAdornment ? <span className="flex min-w-0 self-center">{nameAdornment}</span> : null}</p> : null}
          <div className={cn("relative break-words rounded-2xl px-3.5 py-2 text-sm font-normal",
            withdrawn ? "border border-dashed border-border-input bg-transparent italic text-subtle"
              : mine ? cn("bg-grey-100 text-foreground", !grouped && "rounded-tr-md")
                : cn("border border-border bg-fill-0 text-foreground", !grouped && "rounded-tl-md"))}>
            {quote}
            {children}
          </div>
          {footer ? <div className={cn("mt-1.5", mine ? "text-right" : "pl-1")}>{footer}</div> : null}
          {mine && !grouped && time ? (timeAdornment
            ? <p className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 pr-1 text-xs font-medium text-subtle">{timeAdornment}<span>{time}</span></p>
            : <p className="mt-1 pr-1 text-right text-xs font-medium text-subtle">{time}</p>) : null}
        </div>
        {actions ? <div className="self-center opacity-0 transition-opacity duration-75 focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---- The reference demo: a conversation that plays itself. Not used by the product; kept for previews. ----

const DEFAULT_MESSAGES: ChatMessage[] = [
  { id: "1", sender: "assistant", content: "Hello, I'm Brenda. What do you need to get done today?" },
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
    <div className={cn("card-panel relative flex flex-col overflow-hidden p-0", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BrendaFace size="sm" />
          <div><h3 className="text-sm font-medium">Brenda</h3><p className="text-xs font-medium text-secondary">Your AI teammate</p></div>
        </div>
        {showReplay ? <button type="button" onClick={replay} aria-label="Replay conversation" className={buttonVariants({ variant: "secondary", size: "xs" })}><AnimatedRotateCcw aria-hidden />Replay</button> : null}
      </div>
      <div ref={scrollRef} role="log" aria-label="Chat messages" aria-live="polite" className="flex-1 overflow-y-auto p-4">
        {chatMessages.slice(0, visibleCount).map((m) => (
          <MessageBubble key={m.id} mine={m.sender === "user"} avatar={m.sender === "user" ? undefined : <div className="grid size-8 place-items-center"><BrendaFace size="sm" /></div>}>{m.content}</MessageBubble>
        ))}
        <AnimatePresence>{isTyping ? <div className="mt-3"><TypingIndicator /></div> : null}</AnimatePresence>
      </div>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-[26px] bg-surface py-1.5 pl-4 pr-1.5 shadow-[0_0_0_1px_var(--border)] focus-within:shadow-[0_0_0_1px_var(--border-input-hover)]">
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} disabled={!interactive}
            placeholder={interactive ? "Ask Brenda…" : "Demo, press Replay to watch again"} aria-label={interactive ? "Type your message" : "Chat input (demo)"} className="flex-1 bg-transparent text-sm font-normal text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed" />
          <button type="button" onClick={handleSend} disabled={!interactive || !inputValue.trim()} aria-label="Send message" className={cn("grid size-9 place-items-center rounded-full transition-colors duration-75", interactive && inputValue.trim() ? "bg-primary text-primary-fg hover:bg-primary-hover" : "bg-fill-150 text-subtle")}><AnimatedSend className="size-4" aria-hidden /></button>
        </div>
      </div>
    </div>
  );
}

export default ChatMessages;
