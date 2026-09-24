"use client";
import { GlassCard } from "@/components/landing/glass-card";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TypewriterEffect } from "@/components/aceternity/typewriter-effect";

const TYPE = "text-left text-[15px] font-normal sm:text-[15px] md:text-[15px] lg:text-[15px]";

const FEED = [
  { icon: "clock-in", text: "Ada clocked in", meta: "08:58, on time" },
  { icon: "stopwatch", text: "Ada started Homepage design", meta: "09:12" },
  { icon: "screen-record", text: "Ben is recording his screen", meta: "Brand deck, revision 2" },
  { icon: "day-checklist", text: "Chidi added 3 to-dos", meta: "from a voice note" },
  { icon: "card-check", text: "Ada sent Homepage design for a check", meta: "revision 2, Figma link" },
  { icon: "shield-check", text: "David approved it", meta: "both revisions kept" },
  { icon: "clock-out", text: "Ben clocked out", meta: "17:31, 7h 40m confirmed" },
];

/** A to-do gets typed; underneath, the day's events stream past the way a feed does. */
export function DayDemo() {
  const reduced = useReducedMotion();
  const [n, setN] = useState(3);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setN((k) => k + 1), 1500);
    return () => clearInterval(id);
  }, [reduced]);
  // A window of the last four events, sliding around the list forever, so the card is never empty.
  const shown = Array.from({ length: 4 }, (_, j) => FEED[(n - 3 + j) % FEED.length]);
  return (
    <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
      <GlassCard tilt={false} bodyClassName="p-6">
        <p className="lp-muted text-sm">What do you need to do?</p>
        <div className="mt-2 min-h-12 lp-glass rounded-xl px-4 py-3">
          <TypewriterEffect words={"Finish the homepage design by Friday".split(" ").map((text) => ({ text, className: "text-fg" }))} className={TYPE} cursorClassName="h-5 bg-accent" />
        </div>
        <ul className="mt-4 space-y-2">
          {[["Homepage design", "Fri, 2h 30m", true], ["Client kickoff notes", "today", false], ["Brand deck, revision 2", "Thu", false]].map(([t, m, live]) => (
            <li key={String(t)} className={`flex items-center justify-between lp-glass rounded-xl px-4 py-3 text-sm ${live ? "border-[rgba(255,108,2,0.5)]" : "lp-line"}`}>
              <span>{t}</span>
              <span className="flex items-center gap-3"><span className="lp-muted text-xs">{m}</span><span className={`lp-btn lp-btn-sm ${live ? "lp-btn-primary" : "lp-btn-secondary"}`}>{live ? "Done" : "Start"}</span></span>
            </li>
          ))}
        </ul>
      </GlassCard>
      <GlassCard tilt={false} bodyClassName="flex h-full flex-col p-6">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold">Today in the room</p><span className="flex items-center gap-2 text-xs lp-muted"><span className="rec-dot h-1.5 w-1.5 rounded-full bg-success" aria-hidden />live</span></div>
        <ul className="mt-4 h-[232px] space-y-2 overflow-hidden" aria-live="polite">
          <AnimatePresence initial={false}>
            {shown.map((e) => (
              <motion.li key={e.text} layout initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }} className="lp-card-sm flex items-center gap-3 px-3 py-2.5">
                <img src={`/icons/${e.icon}.png`} alt="" className="h-8 w-8 object-contain" />
                <span className="min-w-0"><span className="block truncate text-sm">{e.text}</span><span className="lp-muted block text-xs">{e.meta}</span></span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </GlassCard>
    </div>
  );
}
