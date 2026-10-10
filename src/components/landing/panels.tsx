"use client";
import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { PALETTE } from "@/lib/assistant-look";
import { LiveIndicator } from "@/components/ui/status-dot";
import { ToolSquare } from "@/components/ui/tool-tile";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON, FeatureCard, FeatureText, Pane } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const EVENTS: { icon: Icon3DName; name: string; text: string }[] = [
  { icon: "clock-in", name: "Clocked in", text: "Ada, 08:58, on time" },
  { icon: "stopwatch", name: "Started", text: "Homepage design, estimate 2h 30m" },
  { icon: "video-people", name: "On a call", text: "Ada and Ben, design review" },
  { icon: "flag-alert", name: "Blocked", text: "Chidi, waiting on client copy" },
  { icon: "card-check", name: "Sent for check", text: "Revision 2 to David" },
  { icon: "shield-check", name: "Approved", text: "Task completed, history kept" },
];

/** The two people on the demo call: initials, and the ring in their own assistant's colour (Ada's Max is orange). */
const CALLERS: { name: string; initials: string; ring: string }[] = [
  { name: "Ada", initials: "AO", ring: PALETTE.orange.sphere.shade },
  { name: "Ben", initials: "BA", ring: PALETTE.blue.sphere.shade },
];

/**
 * Two feature cards side by side: calls (owner decisions, 8 October 2026: phase 8, in place of the old recording
 * card): two call tiles with each person's assistant colour as the avatar ring, the call's running time in orange
 * digits (live) and a quiet chip for Brenda's notes; and every change as it happens (the current event carries the
 * orange selected marker and moves down the list while the card is on screen; still under reduced motion).
 */
export function Panels() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduced || !inView) return;
    const id = setInterval(() => setActive((a) => (a + 1) % EVENTS.length), 1700);
    return () => clearInterval(id);
  }, [reduced, inView]);
  return (
    <div ref={ref} className="grid gap-3 md:grid-cols-2">
      <FeatureCard>
        <Pane className="flex-1 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-secondary">#Design</p>
              <p className="mt-1 font-mono text-[32px] leading-none tabular-nums text-accent-text">12:08</p>
            </div>
            <LiveIndicator className="mt-0.5">On a call</LiveIndicator>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-2" aria-label="People on the call">
            {CALLERS.map((p) => (
              <li key={p.name} className="relative grid aspect-[4/3] place-items-center rounded-xl bg-fill-1">
                <span aria-hidden className="grid size-12 place-items-center rounded-full bg-background text-sm font-semibold text-foreground" style={{ boxShadow: `0 0 0 2px ${p.ring}` }}>{p.initials}</span>
                <span className="absolute bottom-2 left-2.5 text-meta font-medium text-foreground">{p.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 inline-flex h-7 items-center rounded-full bg-fill-0 px-3 text-meta font-normal text-secondary">Brenda is taking notes, from Ada and Ben</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={cn(buttonVariants({ variant: "secondary", size: "xs" }), FAKE_BUTTON)}>Mute</span>
            <span className={cn(buttonVariants({ variant: "secondary", size: "xs" }), FAKE_BUTTON)}>Share screen</span>
            <span className={cn(buttonVariants({ variant: "destructive", size: "xs" }), FAKE_BUTTON)}>Leave</span>
          </div>
        </Pane>
        <FeatureText title="Calls, one press away">
          Call anyone you can message, or ring the whole team from its channel, and share your screen, on every plan. Nothing is recorded, and Brenda only takes notes for the people who say yes.
        </FeatureText>
      </FeatureCard>
      <FeatureCard>
        <Pane className="flex-1 p-2">
          <ul className="space-y-0.5" aria-label="Events as they happen">
            {EVENTS.map((e, i) => {
              const Icon = LINE_ICON[e.icon];
              const on = active === i;
              return (
                <li key={e.name} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-200", on && "selected-marker bg-fill-1")}>
                  <ToolSquare size={36} className={cn("[&_svg]:size-[18px]", on && "text-foreground")}><Icon aria-hidden /></ToolSquare>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{e.name}</span>
                    <span className="block truncate text-meta font-normal text-secondary">{e.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Pane>
        <FeatureText title="Every change, the second it happens">
          Clock-ins, starts, pauses, submissions and decisions reach every open screen within seconds. Reconnect and the page refetches the truth, so nothing shown is stale.
        </FeatureText>
      </FeatureCard>
    </div>
  );
}
