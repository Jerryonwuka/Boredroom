"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/motion";
import { api, isApiFailure } from "@/lib/api-client";

type Status = "not_in" | "in" | "out";

type Timing = { startAt: string; endAt: string; graceMinutes: number };
const HHMM = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

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
    if (nowMs < endMs) return { tone: "danger" as const, message: `The day ends at ${HHMM(timing.endAt)}. Clocking out before then is flagged for your team lead.`, until: HHMM(timing.endAt) };
    return { tone: "success" as const, message: null, until: null };
  }
  return { tone: "default" as const, message: null, until: null };
}

/* Tints, not full colour (owner decision, 28 September 2026): a soft fill, a hairline and the text in the tone. */
const TONE: Record<"default" | "warning" | "danger" | "success", string> = {
  default: "",
  warning: "!border-warning/50 !bg-warning/10 !text-warning hover:!bg-warning/15",
  danger: "!border-danger/50 !bg-danger/10 !text-danger hover:!bg-danger/15",
  success: "!border-success/50 !bg-success/10 !text-success hover:!bg-success/15",
};

/**
 * The clock button (owner decision, 28 September 2026). Clock in is orange, turns amber when late and red when very
 * late, with the lateness spelled out. Once in, Clock out is red until the day's end, naming the end time and that
 * leaving early is flagged; at the end of the day it turns green.
 */
export function ClockButtons({ orgSlug, status, timerOpen, size = "lg", timing }: { orgSlug: string; status: Status; timerOpen: boolean; size?: "lg" | "md"; timing?: Timing }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNowMs(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const state = timingState(status, timing, nowMs);
  const call = async (path: "in" | "out") => {
    setPending(true); setError(null);
    try { await api(`/api/orgs/${orgSlug}/clock/${path}`, { method: "POST" }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      {status === "not_in" ? <Button size={size} disabled={pending} className={TONE[state.tone]} onClick={() => call("in")}><LogIn className="size-4" aria-hidden />{pending ? "Clocking in…" : state.tone === "danger" ? "Clock in, very late" : state.tone === "warning" ? "Clock in, late" : "Clock in"}</Button> : null}
      {status === "in" ? <Button size={size} variant="outline" disabled={pending} className={TONE[state.tone]} data-tip={timerOpen ? "Stop your timer first" : state.message ?? undefined} onClick={() => call("out")}><LogOut className="size-4" aria-hidden />{pending ? "Clocking out…" : state.until ? `Clock out · until ${state.until}` : "Clock out"}</Button> : null}
      {status === "out" ? <p className="text-sm text-fg-muted">You have clocked out for today.</p> : null}
      {state.message ? <p className={`max-w-xs text-xs ${state.tone === "danger" ? "text-danger" : state.tone === "warning" ? "text-warning" : "text-fg-subtle"}`}>{state.message}</p> : null}
      <Presence show={!!error}><p role="alert" className="text-sm text-danger">{error}</p></Presence>
    </div>
  );
}

/**
 * The first thing on My Day until the person has clocked in: the day's start time, whether they are late, and one
 * big Clock in. Once they are in it shrinks to a line with the time and a Clock out; after clocking out it says so.
 */
export function ClockCard({ orgSlug, status, startLabel, endLabel, late, clockedInAt, lateBy, timerOpen, timing }: { orgSlug: string; status: Status; startLabel: string; endLabel: string; late: boolean; clockedInAt?: string | null; lateBy?: string | null; timerOpen: boolean; timing?: Timing }) {
  if (status === "not_in") {
    return (
      <section aria-labelledby="clock-card" className={`tile mb-6 flex flex-wrap items-center justify-between gap-5 p-5 md:p-6 ${late ? "border-warning/50" : "tile-active"}`}>
        <div className="flex items-center gap-4">
          <span aria-hidden className="icon-tile size-14 rounded-[14px]"><LogIn className={`size-6 ${late ? "text-warning" : "text-accent"}`} /></span>
          <div>
            <p className="eyebrow">{late ? "The day started at " + startLabel : "Work starts at " + startLabel}</p>
            <h2 id="clock-card" className="mt-1 font-display text-2xl leading-tight md:text-[28px]">{late ? "You have not clocked in yet" : "Clock in to start your day"}</h2>
            <p className="mt-1 text-sm text-fg-muted">{late ? "Clocking in now is recorded as late; the record shows by how much." : `Clock in on or before ${startLabel} to be on time. The day ends at ${endLabel}.`}</p>
          </div>
        </div>
        <div className="flex items-center gap-3"><ClockButtons orgSlug={orgSlug} status={status} timerOpen={false} size="lg" timing={timing} /><Link href={`/app/${orgSlug}/clock`} className="link-action">Your clock</Link></div>
      </section>
    );
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border-soft bg-wash-soft px-4 py-3">
      <p className="text-sm"><span className="font-semibold">{status === "in" ? `Clocked in${clockedInAt ? ` at ${clockedInAt}` : ""}.` : "You have clocked out for today."}</span> <span className="text-fg-muted">{status === "in" ? (lateBy ? `Late by ${lateBy}.` : "On time.") : ""}</span></p>
      <div className="flex items-center gap-3">{status === "in" ? <ClockButtons orgSlug={orgSlug} status={status} timerOpen={timerOpen} size="md" timing={timing} /> : null}<Link href={`/app/${orgSlug}/clock`} className="link-action">Your clock</Link></div>
    </div>
  );
}
