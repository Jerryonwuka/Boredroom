"use client";
import { GlassCard } from "@/components/landing/glass-card";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

const TABS = ["Join code", "Join link", "Email invitation"] as const;

/** The three ways in, cycling on their own; click a tab to hold it. */
export function JoinDemo() {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const id = setInterval(() => setI((n) => (n + 1) % TABS.length), 3600);
    return () => clearInterval(id);
  }, [held]);
  return (
    <GlassCard className="overflow-hidden">
      <div className="flex gap-1 border-b p-2 lp-line" role="tablist" aria-label="Ways to join">
        {TABS.map((t, n) => (
          <button key={t} role="tab" aria-selected={i === n} onClick={() => { setI(n); setHeld(true); }} className={cn("rounded-full px-3.5 py-1.5 text-sm transition-colors", i === n ? "bg-white/10 text-white" : "lp-muted hover:text-white")}>{t}</button>
        ))}
      </div>
      <div className="relative min-h-[260px] p-6">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(6px)" }} transition={{ duration: 0.35 }}>
            {i === 0 ? (
              <div>
                <p className="lp-muted text-sm">Your organisation&apos;s join code</p>
                <p className="mt-3 font-display text-5xl tracking-[0.12em] text-accent md:text-6xl">K7QM-3XNA</p>
                <p className="lp-muted mt-3 text-sm">New joiners land in <span className="text-white">Design</span> as <span className="text-white">Staff</span>. Pause it and it stops working that second.</p>
                <div className="mt-5 flex gap-2"><span className="lp-btn lp-btn-secondary lp-btn-sm">Pause code</span><span className="lp-btn lp-btn-secondary lp-btn-sm">Rotate</span></div>
              </div>
            ) : i === 1 ? (
              <div>
                <p className="lp-muted text-sm">Share one link</p>
                <div className="mt-3 flex items-center justify-between gap-3 lp-glass rounded-xl px-4 py-3 font-mono text-sm lp-line"><span className="truncate">boredroom.app/join/K7QM-3XNA</span><span className="lp-btn lp-btn-primary lp-btn-sm">Copy</span></div>
                <ol className="lp-muted mt-5 space-y-2 text-sm">
                  <li className="flex gap-3"><span className="text-accent">1</span>They open it and create a staff account.</li>
                  <li className="flex gap-3"><span className="text-accent">2</span>They verify their email.</li>
                  <li className="flex gap-3"><span className="text-accent">3</span>They land on My Day, inside your workspace, in the right team.</li>
                </ol>
              </div>
            ) : (
              <div>
                <p className="lp-muted text-sm">Invite one person by email</p>
                <div className="mt-3 space-y-2">
                  <div className="lp-glass rounded-xl px-4 py-3 text-sm lp-line">ada@studio.example</div>
                  <div className="flex gap-2"><div className="flex-1 lp-glass rounded-xl px-4 py-3 text-sm lp-line">Team lead</div><div className="flex-1 lp-glass rounded-xl px-4 py-3 text-sm lp-line">Graphics</div></div>
                </div>
                <div className="mt-4 flex items-center justify-between"><span className="lp-btn lp-btn-primary lp-btn-sm">Send invitation</span><span className="lp-muted text-xs">Single use, expires in 7 days</span></div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}
