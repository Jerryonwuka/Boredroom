"use client";
import { GlassCard } from "@/components/landing/glass-card";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const EVENTS = [
  { icon: "clock-in", name: "Clocked in", text: "Ada, 08:58, on time" },
  { icon: "stopwatch", name: "Started", text: "Homepage design, estimate 2h 30m" },
  { icon: "screen-record", name: "Recording", text: "Ben shares a window, segment 2" },
  { icon: "flag-alert", name: "Blocked", text: "Chidi, waiting on client copy" },
  { icon: "card-check", name: "Sent for check", text: "Revision 2 to David" },
  { icon: "shield-check", name: "Approved", text: "Task completed, history kept" },
];

/** Two panels side by side, like Resend's Test mode and Modular webhooks: recording by consent, and live events. */
export function Panels() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((a) => (a + 1) % EVENTS.length), 1700);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <GlassCard tilt={false} bodyClassName="flex h-full flex-col p-6 md:p-8">
        <div className="lp-card-sm flex-1 p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="lp-muted text-sm">Brand deck, revision 2</p><p className="mt-1 font-display text-4xl leading-none tabular-nums text-accent">0:47:31</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/50 px-2.5 py-1 text-xs font-semibold text-danger"><span className="rec-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />REC 12:08</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2"><span className="lp-btn lp-btn-secondary lp-btn-sm">Stop recording</span><span className="lp-btn lp-btn-secondary lp-btn-sm">Pause</span></div>
          <ul className="mt-5 space-y-2 text-sm">
            {[["Segment 1, 24 min", "Ready to watch", "text-success"], ["Segment 2, 6 min, sharing stopped", "Interrupted", "text-warning"], ["Segment 3", "Recording", "text-danger"]].map(([a, b, c]) => (
              <li key={a} className="flex items-center justify-between lp-glass rounded-lg px-3 py-2"><span>{a}</span><span className={cn("text-xs font-semibold", c)}>{b}</span></li>
            ))}
          </ul>
        </div>
        <h3 className="mt-6 font-display text-2xl">Recording, only on a press</h3>
        <p className="lp-muted mt-2 text-pretty leading-relaxed">Off until an owner turns it on. Even then nothing records until the person presses Record screen and picks what to share. A red indicator shows the whole time, and stopping the share ends the segment honestly.</p>
      </GlassCard>
      <GlassCard tilt={false} bodyClassName="flex h-full flex-col p-6 md:p-8">
        <ul className="flex-1 space-y-2" aria-label="Events as they happen">
          {EVENTS.map((e, i) => (
            <motion.li key={e.name} animate={{ opacity: reduced || active === i ? 1 : 0.45, scale: active === i ? 1 : 0.985 }} transition={{ duration: 0.35 }} className={cn("lp-card-sm flex items-center gap-3 px-3 py-2.5", active === i && "border-[rgba(255,108,2,0.5)]")}>
              <img src={`/icons/${e.icon}.png`} alt="" className="h-9 w-9 object-contain" />
              <span className="min-w-0"><span className="block text-sm font-semibold">{e.name}</span><span className="lp-muted block truncate text-xs">{e.text}</span></span>
            </motion.li>
          ))}
        </ul>
        <h3 className="mt-6 font-display text-2xl">Every change, the second it happens</h3>
        <p className="lp-muted mt-2 text-pretty leading-relaxed">Clock-ins, starts, pauses, submissions and decisions reach every open screen within seconds. Reconnect and the page refetches the truth, so nothing shown is stale.</p>
      </GlassCard>
    </div>
  );
}
