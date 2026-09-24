"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";

const SIZES = ["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"];

/** The public waitlist form: name, work email, company, size, role, and why. Posts to /api/waitlist. */
export function WaitlistForm({ cta = "Join the waitlist", source = "landing" }: { cta?: string; source?: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) return <div className="lp-card flex items-start gap-3 p-5 text-left"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"><Check className="size-4" aria-hidden /></span><div><p className="font-semibold">You are on the list.</p><p className="lp-muted text-sm">We will email {done} the moment Boredroom opens.</p></div></div>;
  return (
    <form id="waitlist" className="lp-card grid gap-3 p-5 text-left sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const f = new FormData(e.currentTarget);
      const body = Object.fromEntries(f.entries());
      try { await api("/api/waitlist", { method: "POST", body: { ...body, source }, retries: 0 }); setDone(String(body.email)); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again in a moment."); }
      finally { setPending(false); }
    }}>
      <label className="grid gap-1 text-sm"><span className="lp-muted">First name</span><input name="firstName" required maxLength={80} autoComplete="given-name" className="lp-glass h-11 rounded-xl px-3 text-fg" /></label>
      <label className="grid gap-1 text-sm"><span className="lp-muted">Last name</span><input name="lastName" maxLength={80} autoComplete="family-name" className="lp-glass h-11 rounded-xl px-3 text-fg" /></label>
      <label className="grid gap-1 text-sm sm:col-span-2"><span className="lp-muted">Work email</span><input name="email" type="email" required autoComplete="email" className="lp-glass h-11 rounded-xl px-3 text-fg" /></label>
      <label className="grid gap-1 text-sm"><span className="lp-muted">Company</span><input name="company" maxLength={160} autoComplete="organization" className="lp-glass h-11 rounded-xl px-3 text-fg" /></label>
      <label className="grid gap-1 text-sm"><span className="lp-muted">Company size</span><select name="companySize" className="lp-glass h-11 rounded-xl px-3 text-fg" defaultValue=""><option value="" disabled>Choose</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="grid gap-1 text-sm sm:col-span-2"><span className="lp-muted">Your role</span><input name="role" maxLength={80} autoComplete="organization-title" className="lp-glass h-11 rounded-xl px-3 text-fg" /></label>
      <label className="grid gap-1 text-sm sm:col-span-2"><span className="lp-muted">What would you use Boredroom for? <span className="lp-faint">(optional)</span></span><textarea name="interest" maxLength={1000} rows={2} className="lp-glass rounded-xl px-3 py-2 text-fg" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2"><button type="submit" disabled={pending} className="lp-btn lp-btn-primary w-full">{pending ? "Adding you…" : cta}</button></div>
      <p className="lp-faint text-xs sm:col-span-2">One email when we open, nothing else. Reply “unsubscribe” to any email to stop.</p>
    </form>
  );
}
