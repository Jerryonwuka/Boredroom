"use client";

/**
 * "On a call" (owner decisions, 8 October 2026: phase 8, calls; contract D.5). While THIS tab is connected and the person
 * is on another page, a small bar at the bottom centre (full width less 16px a side on a phone): the live dot, "On a call
 * with Ada" or "On a call in #Design", the running clock in orange digits (live), the microphone toggle, "Back to call"
 * and Leave (red). Tabs that are not connected show nothing here, even when the person is on the call from another tab
 * or device (the call's own page offers "Join here instead").
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusDot } from "@/components/ui/status-dot";
import { useCall } from "@/components/app/call-host";
import { CALL_WORDS, callClock, callHref } from "@/lib/calls";
import { callElapsedSeconds, onCallWith, skewOf } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

/** Seconds since `from` on the server's clock, ticking every second; null without a start. */
export function useCallClock(from: string | null, serverNow: string | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!from) return;
    const skew = skewOf(serverNow, Date.now());
    const tick = () => setSeconds(callElapsedSeconds(from, Date.now(), skew));
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [from, serverNow]);
  return from ? seconds : null;
}

/** The bar's look without the host (the design gallery shows it in place). */
export function CallDockBar({ label, seconds, micOn, href, onMic, onLeave, canPlayAudio = true, onSound, className }: {
  label: string; seconds: number | null; micOn: boolean; href: string; onMic: () => void; onLeave: () => void; canPlayAudio?: boolean; onSound?: () => void; className?: string;
}) {
  return (
    <div role="region" aria-label="Your call" data-refresh-safe className={cn("toast-surface flex items-center gap-2 rounded-2xl py-2 pl-3.5 pr-2 shadow-toast", className)}>
      <StatusDot tone="live" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {seconds !== null ? <span className="font-mono text-sm tabular-nums text-accent-text" aria-label={`Call time ${callClock(seconds)}`}>{callClock(seconds)}</span> : null}
      {!canPlayAudio && onSound ? <Button variant="secondary" size="sm" onClick={onSound}><Volume2 aria-hidden /><span className="max-sm:sr-only">{CALL_WORDS.stage.startAudio}</span></Button> : null}
      <IconButton aria-label={CALL_WORDS.mic.mute} data-tip={micOn ? CALL_WORDS.mic.mute : CALL_WORDS.mic.unmute} aria-pressed={!micOn} onClick={onMic}>{micOn ? <Mic aria-hidden /> : <MicOff aria-hidden className="text-danger" />}</IconButton>
      <Link href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}>{CALL_WORDS.backToCall}</Link>
      <Button variant="destructive" size="sm" onClick={onLeave} aria-label={CALL_WORDS.leave}><PhoneOff aria-hidden /><span className="max-sm:sr-only">{CALL_WORDS.leave}</span></Button>
    </div>
  );
}

export function CallDock({ pathname }: { pathname: string | null }) {
  const host = useCall();
  const view = host?.view ?? null;
  const seconds = useCallClock(view?.answeredAt ?? null, view?.serverNow ?? null);
  if (!host || !host.callId || (host.state !== "connected" && host.state !== "reconnecting")) return null;
  const href = callHref(host.orgSlug, host.callId);
  if (pathname === href) return null;
  const label = host.state === "reconnecting" ? CALL_WORDS.stage.reconnecting : view ? onCallWith(view.where) : "On a call";
  return (
    // Clear of the assistant's floating button (bottom right, 80px with its offset): narrower than the screen by its width
    // on wide screens, above it on a phone.
    <div className="fixed bottom-4 left-1/2 z-[var(--z-toast)] w-[min(560px,calc(100vw-12rem))] -translate-x-1/2 max-sm:bottom-[calc(88px+env(safe-area-inset-bottom))] max-sm:w-[calc(100vw-2rem)]">
      <CallDockBar label={label} seconds={seconds} micOn={host.micOn} href={href} onMic={() => void host.toggleMic()} onLeave={() => void host.leave()} canPlayAudio={host.canPlayAudio} onSound={() => void host.startAudio()} />
    </div>
  );
}
