"use client";
import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { LiveIndicator } from "@/components/ui/status-dot";
import { ToolSquare } from "@/components/ui/tool-tile";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON, FeatureCard, FeatureText, Pane } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const EVENTS: { icon: Icon3DName; name: string; text: string }[] = [
  { icon: "clock-in", name: "Clocked in", text: "Ada, 08:58, on time" },
  { icon: "stopwatch", name: "Started", text: "Homepage design, estimate 2h 30m" },
  { icon: "screen-record", name: "Recording", text: "Ben shares a window, segment 2" },
  { icon: "flag-alert", name: "Blocked", text: "Chidi, waiting on client copy" },
  { icon: "card-check", name: "Sent for check", text: "Revision 2 to David" },
  { icon: "shield-check", name: "Approved", text: "Task completed, history kept" },
];

const SEGMENTS: [string, React.ReactNode][] = [
  ["Segment 1, 24 min", <Badge key="1" tone="success" dot>Ready to watch</Badge>],
  ["Segment 2, 6 min, sharing stopped", <Badge key="2" tone="warning" dot>Interrupted</Badge>],
  ["Segment 3", <Badge key="3" tone="neutral">Recording</Badge>],
];

/**
 * Two feature cards side by side: recording by consent (the task's running timer and the recording mark in orange,
 * live; the segments' states in their status colours) and every change as it happens (the current event carries the
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
              <p className="truncate text-sm font-medium text-secondary">Brand deck, revision 2</p>
              <p className="mt-1 font-mono text-[32px] leading-none tabular-nums text-accent-text">0:47:31</p>
            </div>
            <LiveIndicator className="mt-0.5">Recording, 12:08</LiveIndicator>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className={cn(buttonVariants({ variant: "secondary", size: "xs" }), FAKE_BUTTON)}>Stop recording</span>
            <span className={cn(buttonVariants({ variant: "secondary", size: "xs" }), FAKE_BUTTON)}>Pause</span>
          </div>
          <ul className="mt-5 space-y-1">
            {SEGMENTS.map(([label, badge]) => (
              <li key={label} className="flex items-center justify-between gap-3 rounded-xl bg-fill-0 px-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{label}</span>
                {badge}
              </li>
            ))}
          </ul>
        </Pane>
        <FeatureText title="Recording, only on a press">
          Off until an owner turns it on. Even then nothing records until the person presses Record screen and picks what to share. An indicator shows the whole time, and stopping the share ends the segment honestly.
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
