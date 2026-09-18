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

/** One line at the top of My Day until the person has clocked in. */
export function ClockBanner({ orgSlug, status, startLabel, late }: { orgSlug: string; status: Status; startLabel: string; late: boolean }) {
  if (status !== "not_in") return null;
  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-4 py-3 ${late ? "border-warning/40 bg-warning/10" : "border-accent/40 bg-accent-soft/40"}`}>
      <p className="text-sm"><span className="font-semibold">{late ? "You have not clocked in yet, and the day started at " : "Clock in to start your day. Work starts at "}{startLabel}.</span> <span className="text-fg-muted">{late ? "Clocking in now will be recorded as late." : "Clock in on or before then to be on time."}</span></p>
      <div className="flex items-center gap-3"><ClockButtons orgSlug={orgSlug} status={status} timerOpen={false} size="md" /><Link href={`/app/${orgSlug}/clock`} className="text-sm underline">Your clock</Link></div>
    </div>
  );
}
