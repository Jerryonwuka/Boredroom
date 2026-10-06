"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { LiveIndicator } from "@/components/ui/status-dot";
import { ToolSquare } from "@/components/ui/tool-tile";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON, Pane } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const TYPED = "Finish the homepage design by Friday";

const FEED: { icon: Icon3DName; text: string; meta: string }[] = [
  { icon: "clock-in", text: "Ada clocked in", meta: "08:58, on time" },
  { icon: "stopwatch", text: "Ada started Homepage design", meta: "09:12" },
  { icon: "screen-record", text: "Ben is recording his screen", meta: "Brand deck, revision 2" },
  { icon: "day-checklist", text: "Chidi added 3 to-dos", meta: "from a voice note" },
  { icon: "card-check", text: "Ada sent Homepage design for a check", meta: "revision 2, Figma link" },
  { icon: "shield-check", text: "David approved it", meta: "both revisions kept" },
  { icon: "clock-out", text: "Ben clocked out", meta: "17:31, 7h 40m confirmed" },
];

const TODOS: [string, string, boolean][] = [["Homepage design", "Fri, 2h 30m", true], ["Client kickoff notes", "today", false], ["Brand deck, revision 2", "Thu", false]];

/**
 * Whether the person asked for reduced motion. Read through useSyncExternalStore so the server and the first client
 * render agree (no motion preference on the server), and the page follows the setting if it changes.
 */
const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useReducedMotionSafe() {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCE).matches, () => false);
}

/** Types `text` one character at a time once `run` turns true; all of it at once under reduced motion. */
function useTyped(text: string, run: boolean, reduced: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || reduced || n >= text.length) return;
    const id = setTimeout(() => setN((k) => k + 1), n === 0 ? 500 : 45);
    return () => clearTimeout(id);
  }, [n, run, reduced, text.length]);
  return reduced ? text.length : n;
}

/**
 * The day, both sides of it: a to-do gets typed into a focused v4 field over the day's list (the running one carries
 * the orange selected marker), and beside it the room's events arrive at the top of a live feed (the orange "Live"
 * mark). Both move only while on screen and not at all under reduced motion. The feed is not a live region: it
 * changes every 1.6 seconds, which would talk over a screen reader; its current rows read as a plain list.
 */
export function DayDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const reduced = useReducedMotionSafe();
  const typed = useTyped(TYPED, inView, reduced);
  const [n, setN] = useState(3);
  useEffect(() => {
    if (reduced || !inView) return;
    const id = setInterval(() => setN((k) => k + 1), 1600);
    return () => clearInterval(id);
  }, [reduced, inView]);
  // The newest four, newest first, sliding around the list forever so the card is never empty.
  const shown = Array.from({ length: 4 }, (_, j) => FEED[(n - j) % FEED.length]);
  const done = typed >= TYPED.length;

  return (
    <div ref={ref} className="grid gap-3 md:grid-cols-[1.1fr_1fr]">
      <Pane className="lp-reveal p-5 sm:p-6">
        <p className="text-sm font-medium text-foreground">What do you need to do?</p>
        <div className="mt-2 min-h-11 rounded-xl border border-foreground px-3.5 py-2.5 text-base font-normal text-foreground shadow-[var(--field-ring)]">
          <span className="sr-only">{TYPED}</span>
          <span aria-hidden>{TYPED.slice(0, typed)}<span className={cn("ml-px inline-block h-5 w-[1.5px] bg-foreground align-[-4px]", done && !reduced && "animate-pulse")} /></span>
        </div>
        <ul className="mt-4 space-y-1">
          {TODOS.map(([t, m, running]) => (
            <li key={t} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", running && "selected-marker bg-fill-1")}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t}</span>
              <span className="shrink-0 text-meta font-normal tabular-nums text-secondary">{m}</span>
              <span className={cn(buttonVariants({ variant: running ? "primary" : "secondary", size: "xs" }), FAKE_BUTTON)}>{running ? "Done" : "Start"}</span>
            </li>
          ))}
        </ul>
      </Pane>
      <Pane className="lp-reveal flex flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Today in the room</p>
          <LiveIndicator />
        </div>
        <ul aria-label="Events as they happen" className="mt-3 h-[236px] space-y-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {shown.map((e) => {
              const Icon = LINE_ICON[e.icon];
              return (
                <motion.li key={e.text} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="flex items-center gap-3 rounded-xl py-2">
                  <ToolSquare size={36} className="[&_svg]:size-[18px]"><Icon aria-hidden /></ToolSquare>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{e.text}</span>
                    <span className="block truncate text-meta font-normal text-secondary">{e.meta}</span>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </Pane>
    </div>
  );
}
