"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/motion";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Status = "not_in" | "in" | "out";

/** `timeZone` is the organisation's schedule zone, so the end time on the button matches the one on the page. */
type Timing = { startAt: string; endAt: string; graceMinutes: number; timeZone?: string };
const HHMM = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

/** How the clock button should read right now: on time, late, very late, before the end of the day, after it. */
function timingState(status: Status, timing: Timing | undefined, nowMs: number) {
  if (!timing) return { tone: "default" as const, message: null as string | null, until: null as string | null };
  if (status === "not_in") {
    const lateMs = nowMs - Date.parse(timing.startAt) - timing.graceMinutes * 60_000;
    if (lateMs <= 0) return { tone: "default" as const, message: null, until: null };
    const mins = Math.round(lateMs / 60_000);
    const text = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins} min`;
    return mins >= 60 ? { tone: "danger" as const, message: `You are very late: ${text} past the start. Clocking in now is recorded as late.`, until: null } : { tone: "warning" as const, message: `You are ${text} late. Clocking in now is recorded as late.`, until: null };
  }
  if (status === "in") {
    const endMs = Date.parse(timing.endAt);
    const end = HHMM(timing.endAt, timing.timeZone);
    if (nowMs < endMs) return { tone: "danger" as const, message: `The day ends at ${end}. Clocking out before then is flagged for your team lead.`, until: end };
    return { tone: "success" as const, message: null, until: null };
  }
  return { tone: "default" as const, message: null, until: null };
}

// The time the button reads from, refreshed every 30 seconds. It is null while the server renders and while the page
// hydrates, so the lateness ("3h 59m") and the end time are only ever worked out in the browser: computed on both
// sides, they disagreed when a minute ticked over and React had to rebuild the page.
const subscribeClock = (tick: () => void) => { const t = window.setInterval(tick, 30_000); return () => window.clearInterval(t); };
const clockNow = () => Math.floor(Date.now() / 30_000) * 30_000;
const noClock = () => null;

const DOT = { default: "bg-subtle", warning: "bg-warning", danger: "bg-danger", success: "bg-success" } as const;

/**
 * The clock button, v4. Clock in is the orange standout (accent rules, 6 October 2026: the one thing to do on the
 * screens it sits on); late and very late say so in its label, with the lateness
 * spelled out beside an amber or red dot underneath. Once in, Clock out is the red outline (the danger button) until
 * the day's end, naming the end time and that leaving early is flagged; after the end it is a plain outline. The
 * buttons live on the Clock in page; My Day's "Your day" shows your clock as a row that opens it, and Brenda clocks
 * you in or out when asked.
 */
export function ClockButtons({ orgSlug, status, timerOpen, size = "lg", timing }: { orgSlug: string; status: Status; timerOpen: boolean; size?: "lg" | "md"; timing?: Timing }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const nowMs = useSyncExternalStore(subscribeClock, clockNow, noClock);
  const state = timingState(status, nowMs === null ? undefined : timing, nowMs ?? 0);
  const call = async (path: "in" | "out") => {
    setPending(true); setError(null);
    try { await api(`/api/orgs/${orgSlug}/clock/${path}`, { method: "POST" }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and press the button again."); }
    finally { setPending(false); }
  };
  const describedBy = state.message ? noteId : undefined;
  return (
    <div className="flex flex-col items-start gap-2.5">
      {status === "not_in" ? (
        <Button size={size} variant="accent" loading={pending} aria-describedby={describedBy} onClick={() => call("in")}>
          {pending ? null : <LogIn aria-hidden />}{pending ? "Clocking in…" : state.tone === "danger" ? "Clock in, very late" : state.tone === "warning" ? "Clock in, late" : "Clock in"}
        </Button>
      ) : null}
      {status === "in" ? (
        <Button size={size} variant={state.until ? "danger" : "secondary"} loading={pending} aria-describedby={describedBy} data-tip={timerOpen ? "Stop your timer first" : state.message ?? undefined} onClick={() => call("out")}>
          {pending ? null : <LogOut aria-hidden />}{pending ? "Clocking out…" : state.until ? <>Clock out, day ends <span className="tabular-nums">{state.until}</span></> : "Clock out"}
        </Button>
      ) : null}
      {status === "out" ? <p className="text-sm font-normal text-secondary">You have clocked out for today.</p> : null}
      {state.message ? (
        <p id={noteId} className="flex max-w-xs items-start gap-2 text-meta font-normal text-secondary">
          <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[state.tone])} aria-hidden />{state.message}
        </p>
      ) : null}
      <Presence show={!!error}><p role="alert" className="text-meta font-medium text-danger">{error}</p></Presence>
    </div>
  );
}
