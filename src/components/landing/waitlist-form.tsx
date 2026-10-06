"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SIZES = ["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"];

/**
 * The public waitlist form: name, work email, company, size, role, and why. Posts to /api/waitlist (unchanged). v4:
 * the app's fields (`.field`, labels 14/20 medium), and the submit is the screen's one orange button (joining is the
 * one thing to do here). The caller puts it on a card.
 */
export function WaitlistForm({ cta = "Join the waitlist", source = "landing" }: { cta?: string; source?: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = "grid gap-1.5 text-sm font-medium text-foreground";
  if (done) {
    return (
      <div id="waitlist" role="status" className="flex items-start gap-3 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/12 text-success"><Check className="size-4" aria-hidden /></span>
        <div><p className="text-sm font-semibold text-foreground">You are on the list.</p><p className="mt-0.5 text-sm font-normal text-secondary">We will email {done} the moment Boredroom opens.</p></div>
      </div>
    );
  }
  return (
    <form id="waitlist" className="grid gap-4 text-left sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const f = new FormData(e.currentTarget);
      const body = Object.fromEntries(f.entries());
      try { await api("/api/waitlist", { method: "POST", body: { ...body, source }, retries: 0 }); setDone(String(body.email)); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again in a moment."); }
      finally { setPending(false); }
    }}>
      <label className={label}>First name<input name="firstName" required maxLength={80} autoComplete="given-name" className="field field-lg" /></label>
      <label className={label}>Last name<input name="lastName" maxLength={80} autoComplete="family-name" className="field field-lg" /></label>
      <label className={cn(label, "sm:col-span-2")}>Work email<input name="email" type="email" required autoComplete="email" className="field field-lg" /></label>
      <label className={label}>Company<input name="company" maxLength={160} autoComplete="organization" className="field field-lg" /></label>
      <label className={label}>Company size<select name="companySize" className="field field-lg" defaultValue=""><option value="" disabled>Choose</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className={cn(label, "sm:col-span-2")}>Your role<input name="role" maxLength={80} autoComplete="organization-title" className="field field-lg" /></label>
      <label className={cn(label, "sm:col-span-2")}><span>What would you use Boredroom for? <span className="font-normal text-subtle">(optional)</span></span><textarea name="interest" maxLength={1000} rows={2} className="field field-lg min-h-[4.5rem] py-2" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error ? <p role="alert" className="text-sm font-normal text-danger sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2"><button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(buttonVariants({ variant: "accent", size: "lg" }), "h-11 w-full text-[15px]")}>{pending ? "Adding you…" : cta}</button></div>
      <p className="text-xs font-normal text-secondary sm:col-span-2">One email when we open, nothing else. Reply “unsubscribe” to any email to stop.</p>
    </form>
  );
}
