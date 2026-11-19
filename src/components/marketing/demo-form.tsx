"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SIZES = ["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"];

/**
 * The Book a demo form (owner request, 17 November 2026): name, work email, company, team size, role, the times that
 * suit and what they would like to see. Posts to /api/demo with the browser's time zone, so a time can be offered in it.
 * The waitlist form's fields and labels (each label wraps its field and is tied to it by htmlFor/id); the caller puts it
 * on a card. Sending it does not add the person to the waitlist or to product news.
 */
export function DemoForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const label = "grid gap-1.5 text-sm font-medium text-foreground";
  const optional = <span className="font-normal text-subtle">(optional)</span>;
  if (done) {
    return (
      <div id="demo-form" role="status" className="flex items-start gap-3 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/12 text-success"><Check className="size-4" aria-hidden /></span>
        <div><p className="text-sm font-semibold text-foreground">We have your request.</p><p className="mt-0.5 text-sm font-normal text-secondary">We will email {done} to agree a time.</p></div>
      </div>
    );
  }
  return (
    <form id="demo-form" className="grid gap-4 text-left sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const body = Object.fromEntries(new FormData(e.currentTarget).entries());
      let timezone = "";
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { /* an old browser: sent without */ }
      try { await api("/api/demo", { method: "POST", body: { ...body, timezone, source: window.location.pathname.slice(0, 60) }, retries: 0 }); setDone(String(body.email)); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again in a moment."); }
      finally { setPending(false); }
    }}>
      <label htmlFor={id("first-name")} className={label}>First name<input id={id("first-name")} name="firstName" required maxLength={80} autoComplete="given-name" className="field field-lg" /></label>
      <label htmlFor={id("last-name")} className={label}>Last name<input id={id("last-name")} name="lastName" maxLength={80} autoComplete="family-name" className="field field-lg" /></label>
      <label htmlFor={id("email")} className={cn(label, "sm:col-span-2")}>Work email<input id={id("email")} name="email" type="email" required autoComplete="email" className="field field-lg" /></label>
      <label htmlFor={id("company")} className={label}>Company<input id={id("company")} name="company" required maxLength={160} autoComplete="organization" className="field field-lg" /></label>
      <label htmlFor={id("company-size")} className={label}>Team size<select id={id("company-size")} name="companySize" className="field field-lg" defaultValue=""><option value="" disabled>Choose</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label htmlFor={id("role")} className={cn(label, "sm:col-span-2")}><span>Your role {optional}</span><input id={id("role")} name="role" maxLength={80} autoComplete="organization-title" className="field field-lg" /></label>
      <label htmlFor={id("times")} className={cn(label, "sm:col-span-2")}><span>When suits you? {optional}</span><input id={id("times")} name="times" maxLength={300} placeholder="Weekday mornings, or Thursday after 2pm" className="field field-lg" /></label>
      <label htmlFor={id("notes")} className={cn(label, "sm:col-span-2")}><span>What would you like to see? {optional}</span><textarea id={id("notes")} name="notes" maxLength={1000} rows={2} className="field field-lg min-h-[4.5rem] py-2" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error ? <p role="alert" className="text-sm font-normal text-danger sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2"><button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(buttonVariants({ variant: "primary", size: "lg" }), "h-11 w-full text-[15px]")}>{pending ? "Sending…" : "Book a demo"}</button></div>
      <p className="text-xs font-normal text-secondary sm:col-span-2">We use these details to arrange your demo, and nothing else. How we use them is in the <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</a>.</p>
    </form>
  );
}
