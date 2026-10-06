"use client";
import { useRef, useState, useEffect } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Badge, MonoChip } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const TABS = [{ label: "Join code", value: "code" }, { label: "Join link", value: "link" }, { label: "Email invitation", value: "email" }];
const STEPS = ["They open it and create a staff account.", "They verify their email.", "They land on My Day, inside your workspace, in the right team."];
const fake = (variant: "primary" | "secondary") => cn(buttonVariants({ variant, size: "xs" }), FAKE_BUTTON);

/**
 * The three ways in, on real v4 underline tabs (the active one carries the orange underline). They cycle on their own
 * while the card is on screen; pointing at the card pauses them, and choosing a tab (or tabbing into them) holds the
 * choice. Under reduced motion they never move by themselves.
 */
export function JoinDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (held || hover || reduced || !inView) return;
    const id = setInterval(() => setI((n) => (n + 1) % TABS.length), 3600);
    return () => clearInterval(id);
  }, [held, hover, reduced, inView]);
  const tab = TABS[i];
  return (
    <div ref={ref} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHeld(true)}
      className="lp-reveal min-w-0 overflow-hidden rounded-[20px] border border-border bg-background shadow-chart">
      <Tabs tabs={TABS} value={tab.value} onChange={(v) => { setI(Math.max(0, TABS.findIndex((t) => t.value === v))); setHeld(true); }} label="Ways to join" className="px-5 pt-3 sm:px-6" />
      <div role="tabpanel" aria-label={tab.label} className="min-h-[268px] p-5 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab.value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab.value === "code" ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-secondary">Your organisation&apos;s join code</p>
                  <Badge tone="success" dot>Active</Badge>
                </div>
                <p className="mt-4 font-mono text-[34px] leading-none tracking-[0.06em] text-foreground sm:text-[44px]">K7QM-3XNA</p>
                <p className="mt-4 text-sm font-normal text-secondary">New joiners land in <span className="font-medium text-foreground">Design</span> as <span className="font-medium text-foreground">Staff</span>. Pause it and it stops working that second.</p>
                <div className="mt-5 flex gap-2"><span className={fake("secondary")}>Pause code</span><span className={fake("secondary")}>Rotate</span></div>
              </div>
            ) : tab.value === "link" ? (
              <div>
                <p className="text-sm font-medium text-secondary">Share one link</p>
                <div className="mt-3 flex h-10 items-center gap-3 rounded-xl border border-border-input pl-3 pr-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-meta text-foreground">boredroom.app/join/K7QM-3XNA</span>
                  <span className={fake("primary")}>Copy</span>
                </div>
                <ol className="mt-5 space-y-3">
                  {STEPS.map((s, n) => <li key={s} className="flex items-start gap-3 text-sm font-normal text-secondary"><MonoChip className="mt-px">{n + 1}</MonoChip><span>{s}</span></li>)}
                </ol>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-secondary">Invite one person by email</p>
                <div className="mt-3 space-y-2">
                  <div className="field flex items-center">ada@studio.example</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="field flex items-center justify-between gap-2"><span className="truncate">Team lead</span><ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden /></div>
                    <div className="field flex items-center justify-between gap-2"><span className="truncate">Graphics</span><ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden /></div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className={fake("primary")}>Send invitation</span><span className="text-xs text-subtle">Single use, expires in 7 days</span></div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
