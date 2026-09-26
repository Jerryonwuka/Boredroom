"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/motion";
import { api, isApiFailure } from "@/lib/api-client";

type Status = "not_in" | "in" | "out";

/** The two buttons. Clock in is the only action before work; Clock out the only one after. */
export function ClockButtons({ orgSlug, status, timerOpen, size = "lg" }: { orgSlug: string; status: Status; timerOpen: boolean; size?: "lg" | "md" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (path: "in" | "out") => {
    setPending(true); setError(null);
    try { await api(`/api/orgs/${orgSlug}/clock/${path}`, { method: "POST" }); router.refresh(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      {status === "not_in" ? <Button size={size} disabled={pending} onClick={() => call("in")}><LogIn className="size-4" aria-hidden />{pending ? "Clocking in…" : "Clock in"}</Button> : null}
      {status === "in" ? <Button size={size} variant="outline" disabled={pending} title={timerOpen ? "Stop your timer first" : undefined} onClick={() => call("out")}><LogOut className="size-4" aria-hidden />{pending ? "Clocking out…" : "Clock out"}</Button> : null}
      {status === "out" ? <p className="text-sm text-fg-muted">You have clocked out for today.</p> : null}
      <Presence show={!!error}><p role="alert" className="text-sm text-danger">{error}</p></Presence>
    </div>
  );
}

/**
 * The first thing on My Day until the person has clocked in: the day's start time, whether they are late, and one
 * big Clock in. Once they are in it shrinks to a line with the time and a Clock out; after clocking out it says so.
 */
export function ClockCard({ orgSlug, status, startLabel, endLabel, late, clockedInAt, lateBy, timerOpen }: { orgSlug: string; status: Status; startLabel: string; endLabel: string; late: boolean; clockedInAt?: string | null; lateBy?: string | null; timerOpen: boolean }) {
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
        <div className="flex items-center gap-3"><ClockButtons orgSlug={orgSlug} status={status} timerOpen={false} size="lg" /><Link href={`/app/${orgSlug}/clock`} className="link-action">Your clock</Link></div>
      </section>
    );
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border-soft bg-wash-soft px-4 py-3">
      <p className="text-sm"><span className="font-semibold">{status === "in" ? `Clocked in${clockedInAt ? ` at ${clockedInAt}` : ""}.` : "You have clocked out for today."}</span> <span className="text-fg-muted">{status === "in" ? (lateBy ? `Late by ${lateBy}.` : "On time.") : ""}</span></p>
      <div className="flex items-center gap-3">{status === "in" ? <ClockButtons orgSlug={orgSlug} status={status} timerOpen={timerOpen} size="md" /> : null}<Link href={`/app/${orgSlug}/clock`} className="link-action">Your clock</Link></div>
    </div>
  );
}
