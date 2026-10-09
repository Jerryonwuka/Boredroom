"use client";

/**
 * Brenda (owner decision, 3 October 2026): a floating button bottom right on every page opens a side panel to talk to
 * her, typed or spoken. The conversation itself (`brenda-chat.tsx`) is shared with Brenda Home.
 *
 * In the style of the desktop notch (owner decision, 4 October 2026): her living face on the button and in the header
 * (poke her); her mood and a soft glow follow the conversation; the same small chimes, with a mute switch (chimes only:
 * her voice has its own setting). Her faces react as on her page (owner request, 7 October 2026): they read along
 * while you type in the box (eyes on the caret),
 * listen while you dictate (head tilted, eyes wide), think while she works and smile at her reply (brenda-chat).
 *
 * Not on Brenda's own page (owner decision, 5 October 2026): that page is the conversation with her, so the floating
 * button and its panel stay out of the way there.
 *
 * Its conversations are kept like the ones on Brenda's page (owner decision, 5 October 2026), and Past chats in the
 * header opens her chat there with the list beside it (`?tab=history`). Dictating here shows the notch's voice card,
 * as everywhere (it comes with the shared box).
 *
 * v4 (6 October 2026): the panel is the right-side sheet (spec §7 Dialogs): full height, 512px (the whole width of a
 * phone), the canvas colour, a hairline on its left and the sheet shadow, over the grey overlay at 30% with no blur;
 * its header is the sheet's (title 18/26 medium, the question in the secondary grey) with ghost icon buttons on the
 * right. No glass and no glow. The floating button is a 56px circle on the popover surface with the toast shadow.
 *
 * The starter prompts fill the box, like the asks on Brenda's page (polish, 6 October 2026): the words can be edited
 * and nothing is sent until the person presses Send.
 *
 * It is the person's own assistant (owner decision, 7 October 2026: personal assistants): the button, the panel's title,
 * its aria-labels and her opening words use the name they chose (`useAssistant`); her faces draw their look.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): the chat reads replies aloud as the person chose, with Listen on
 * each (brenda-chat). Putting the panel away stops her: however it closes (the overlay, Escape, Close, the button, a
 * link in a reply, Past chats) and on Brenda's page, where the panel is not shown; a reply that lands while it is
 * closed is not read. Her faces here (the button, the header, the replies) talk while she speaks, with every other face
 * of hers on the page (brenda-face).
 *
 * Act without asking (owner decision, 8 October 2026): the box starts with the person's mode (the pill, from the shared
 * composer; the text narrows to make room, so the microphone and Send stay on the row at 400px), and her opening words
 * say which mode is in force: she asks before anything that lands on someone else, or does what they ask at once with
 * Undo for 10 minutes.
 *
 * Quiet hours (owner decision, 8 October 2026: phase 7a): during the person's quiet hours the panel opens and closes
 * without its chime, and her replies are not read aloud on their own (brenda-chat); Listen and the chimes switch work.
 * Confirm cards here say who receives what (the shared BrendaMessages).
 *
 * Abilities (owner decisions, 8–9 October 2026: phase 7c): her opening words and the starters leave out what is switched
 * off for the person (catching up on Messages; asking a colleague's assistant), read once the panel first opens
 * (`useAbilitiesOff`); with Voice switched off for the workspace the box has no microphone and no reply has Listen
 * (the shared composer and BrendaMessages).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BellOff, MessageSquareText, X } from "lucide-react";
// Past chats is a link styled as an icon button, so it carries its animated twin itself (IconButton swaps its own).
import { AnimatedHistory } from "@/components/ui/animated-icons";
import { IconButton, ICON_BUTTON } from "@/components/ui/icon-button";
import { BrendaFace } from "@/components/app/brenda-face";
import { BrendaComposer, BrendaMessages, STARTERS, STARTER_ABILITY, useBrendaChat } from "@/components/app/brenda-chat";
import { useAbilitiesOff } from "@/hooks/use-abilities";
import type { AbilityKey } from "@/lib/abilities";
import { useAssistant } from "@/components/app/assistant-context";
import { ACT_WORDS } from "@/lib/act-mode";
import { playSound, soundsMuted, setSoundsMuted, subscribeSounds } from "@/lib/brenda-sound";
import { cn } from "@/lib/utils";

// Where the floating button sits. Dragged positions are remembered per browser; nothing set means bottom right.
const POS_KEY = "boredroom-assistant-pos";
const POS_EVENT = "boredroom:assistant-pos";
const FAB = 56;
const subscribePos = (cb: () => void) => { window.addEventListener(POS_EVENT, cb); window.addEventListener("resize", cb); return () => { window.removeEventListener(POS_EVENT, cb); window.removeEventListener("resize", cb); }; };
const readPos = () => { try { return localStorage.getItem(POS_KEY); } catch { return null; } };
const writePos = (x: number, y: number) => { try { localStorage.setItem(POS_KEY, `${Math.round(x)},${Math.round(y)}`); } catch { /* private mode */ } window.dispatchEvent(new Event(POS_EVENT)); };
const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(8, x), window.innerWidth - FAB - 8), y: Math.min(Math.max(8, y), window.innerHeight - FAB - 8) });

/** What she can do, in her opening words before the first message. */
const CAN_DO: Record<"org" | "worker", string[]> = {
  org: ["See what is waiting", "Assign work", "Ask someone's assistant where they are", "Follow up on tasks nobody picked up", "Message people", "Set reminders"],
  worker: ["See what is waiting", "Start and stop your timer", "Clock in", "Update your tasks", "Ask a colleague's assistant where they are", "Set reminders"],
};
/** Phase 7c: the lines of CAN_DO that need an ability, left out while it is off for the person. */
const CAN_DO_ABILITY: Readonly<Record<string, AbilityKey>> = { "Ask someone's assistant where they are": "follow_ups", "Ask a colleague's assistant where they are": "follow_ups" };

/** The saved position, kept inside the viewport, or null for the default corner. */
function useFloatingPosition() {
  const raw = useSyncExternalStore(subscribePos, readPos, () => null);
  if (raw === null || typeof window === "undefined") return null;
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return clamp(x, y);
}

// `timeZone`: the organisation's, for the times on a follow-up's live card in the chat (phase 4, integration review,
// 8 October 2026); her page passes the same.
export function AssistantDrawer({ orgSlug, isOrg, firstName, floating = false, timeZone }: { orgSlug: string; isOrg: boolean; firstName: string; floating?: boolean; timeZone?: string }) {
  const [open, setOpen] = useState(false);
  const assistants = useAssistant();
  const { name } = assistants.personal;
  const onBrendaPage = /^\/app\/[^/]+\/home\/?$/.test(usePathname() ?? "");
  const muted = useSyncExternalStore(subscribeSounds, soundsMuted, () => false);
  // Y and N answer this panel's Confirm only while it is open and showing; on Brenda's page her own chat takes them.
  const showing = open && !onBrendaPage;
  const chat = useBrendaChat({ orgSlug, keysActive: showing, visible: showing, timeZone, onLeave: () => setOpen(false) });
  const { messages, pending, dictation, look, quiet } = chat;
  // Every way the panel goes away (each sets `open` false) stops what this chat was reading aloud; so does her page.
  useEffect(() => { if (!showing) quiet(); }, [showing, quiet]);
  const listRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** A starter's words go in the box, the cursor at their end, to edit and send; never sent from here. */
  const fill = (words: string) => {
    chat.setText(words);
    const field = boxRef.current?.querySelector("textarea");
    if (!field) return;
    field.focus();
    requestAnimationFrame(() => { const n = field.value.length; field.setSelectionRange(n, n); });
  };
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

  const opened = useRef(false);
  // Opening and closing chime, except during the person's quiet hours (owner decision, 8 October 2026: phase 7a).
  const hushed = useRef(chat.hushed);
  useEffect(() => { hushed.current = chat.hushed; });
  useEffect(() => { if (opened.current !== open) { if ((open || opened.current) && !hushed.current) playSound(open ? "open" : "close"); opened.current = open; } }, [open]);
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { void dictation.stop(); setOpen(false); } }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey); }, [open, dictation]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pending]);

  // Phase 7c: what is switched off for the person, read once the panel has opened (nothing is hidden until then).
  const [everOpen, setEverOpen] = useState(false);
  if (open && !everOpen) setEverOpen(true);
  const off = useAbilitiesOff(orgSlug, everOpen);
  const usable = (line: string, map: Readonly<Record<string, AbilityKey>>) => { const k = map[line]; return !k || !off.has(k); };
  const starters = STARTERS[isOrg ? "org" : "worker"].filter((s) => usable(s, STARTER_ABILITY));
  const canDo = CAN_DO[isOrg ? "org" : "worker"].filter((t) => usable(t, CAN_DO_ABILITY));
  const close = () => { void dictation.stop(); setOpen(false); };
  if (onBrendaPage) return null;

  return (
    <>
      {floating ? (
        <button ref={fabRef} type="button" aria-label={name} aria-expanded={open} aria-controls="assistant-drawer" data-tip={`${name}. Drag to move`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
          style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
          className="fixed bottom-6 right-6 z-[var(--z-sticky)] grid size-14 cursor-grab touch-none select-none place-items-center rounded-full bg-popover shadow-toast transition-[background-color] duration-75 hover:bg-[color-mix(in_srgb,var(--foreground)_4.3%,var(--popover))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:cursor-grabbing">
          <BrendaFace size="md" mood={look.mood} tone={look.tone} className="pointer-events-none" />
        </button>
      ) : (
        <IconButton aria-label={name} aria-expanded={open} aria-controls="assistant-drawer" onClick={() => setOpen((v) => !v)}>
          <BrendaFace size="sm" mood={look.mood} tone={look.tone} />
        </IconButton>
      )}
      {open ? <button type="button" aria-label={`Close ${name}`} tabIndex={-1} className="fixed inset-0 z-[var(--z-overlay)] bg-overlay" onClick={close} /> : null}
      {/* Closed, it only slides off screen: `inert` keeps its controls out of the Tab order and away from screen readers. */}
      <aside id="assistant-drawer" role="dialog" aria-labelledby="assistant-drawer-title" aria-describedby="assistant-drawer-question" aria-hidden={!open} inert={!open} data-refresh-safe
        className={cn("fixed inset-y-0 right-0 z-[var(--z-dialog)] flex w-[min(100vw,var(--sheet-width))] flex-col border-l border-border bg-background shadow-sheet transition-[translate,visibility] duration-[var(--duration-sheet)] ease-[var(--ease-out)]",
          open ? "visible translate-x-0" : "invisible translate-x-full")}>
        <header className="flex shrink-0 items-start gap-3 border-b border-border py-5 pl-6 pr-4">
          <BrendaFace size="lg" mood={look.mood} tone={look.tone} interactive className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 id="assistant-drawer-title" className="type-dialog-title truncate">{name}</h2>
            <p id="assistant-drawer-question" className="truncate text-sm font-medium text-secondary">What do you need, {firstName}?</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Saves what is waiting first, so the list it opens already has this conversation. */}
            <Link href={`/app/${orgSlug}/home?tab=history`} aria-label="Past chats" className={ICON_BUTTON} onClick={() => { chat.saveNow(); close(); }}>
              <AnimatedHistory aria-hidden />
            </Link>
            {/* Her chimes only, not her voice (Settings → Your assistant → Voice, and Listen on each reply): named and drawn
                as chimes so it is not taken for the Listen speaker just below it (review, 7 October 2026). */}
            <IconButton aria-label={muted ? `Turn ${name}'s chimes on` : `Turn ${name}'s chimes off`} aria-pressed={!muted} onClick={() => { setSoundsMuted(!muted); if (muted) playSound("reply"); }}>
              {muted ? <BellOff aria-hidden /> : <Bell aria-hidden />}
            </IconButton>
            <IconButton aria-label="Close" onClick={close}><X aria-hidden /></IconButton>
          </div>
        </header>

        <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {messages.length === 0 ? (
            <div className="space-y-4">
              {/* What she does, as a list, not a sentence strung with commas (owner request, 7 October 2026: "if you're
                  listing things, it should not be in a paragraph"); the list is drawn like the ones in her replies. */}
              <div className="text-sm font-normal text-secondary">
                <p>I&apos;m {name}. Tell me what you need done and I&apos;ll take care of it:</p>
                <ul className="my-2 list-disc pl-[1.25em] marker:text-secondary [&>li+li]:mt-[0.35em]">
                  {canDo.map((t) => <li key={t}>{t}</li>)}
                </ul>
                <p>{ACT_WORDS.chat.intro(chat.actMode.state.effective === "auto", assistants.ai)}</p>
              </div>
              {/* Chips (spec §7): h40 r12 px12 outline, 14/20 medium. */}
              <ul className="space-y-2">{starters.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => fill(s)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-border-input bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-75 hover:border-border-input-hover hover:bg-fill-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                    <MessageSquareText className="size-[18px] shrink-0 text-secondary" aria-hidden /><span className="min-w-0 flex-1">{s}</span>
                  </button>
                </li>
              ))}</ul>
            </div>
          ) : null}
          <BrendaMessages chat={chat} onLeave={() => setOpen(false)} />
        </div>

        {/* A solid strip with a hairline above: the conversation never shows through the box. */}
        {/* A size container: the box's mode pill is its icon alone when this is narrow (review, 8 October 2026). */}
        <div ref={boxRef} className="@container shrink-0 border-t border-border bg-background px-4 pb-4 pt-3">
          <BrendaComposer chat={chat} />
        </div>
      </aside>
    </>
  );
}
