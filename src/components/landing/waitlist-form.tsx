"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { api, isApiFailure } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SIZES = ["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"];

/**
 * The public waitlist form: name, work email, company, size, role, and why. Posts to /api/waitlist (unchanged). v4:
 * the app's fields (`.field`, labels 14/20 medium), and the submit is the white primary (owner request, 10 October
 * 2026: the landing's buttons are all white). The caller puts it on a card.
 *
 * Each field is wrapped by its visible label and also tied to it by `htmlFor`/`id` (owner request, 17 October 2026: SEO
 * analysis, A9: checkers that look only for the for/id pairing found the four inputs unlabelled). Ids come from useId,
 * so two forms on a page never share one.
 */
export function WaitlistForm({ cta = "Join the waitlist", source = "landing", sourceFromPath = false }: {
  cta?: string; source?: string;
  /** Send the page's path as the source instead (the public pages' closing section; at most 60 characters, as the API allows). */
  sourceFromPath?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
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
      const from = sourceFromPath ? window.location.pathname.slice(0, 60) : source;
      try { await api("/api/waitlist", { method: "POST", body: { ...body, source: from }, retries: 0 }); setDone(String(body.email)); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again in a moment."); }
      finally { setPending(false); }
    }}>
      <label htmlFor={id("first-name")} className={label}>First name<input id={id("first-name")} name="firstName" required maxLength={80} autoComplete="given-name" className="field field-lg" /></label>
      <label htmlFor={id("last-name")} className={label}>Last name<input id={id("last-name")} name="lastName" maxLength={80} autoComplete="family-name" className="field field-lg" /></label>
      <label htmlFor={id("email")} className={cn(label, "sm:col-span-2")}>Work email<input id={id("email")} name="email" type="email" required autoComplete="email" className="field field-lg" /></label>
      <label htmlFor={id("company")} className={label}>Company<input id={id("company")} name="company" maxLength={160} autoComplete="organization" className="field field-lg" /></label>
      <label htmlFor={id("company-size")} className={label}>Company size<select id={id("company-size")} name="companySize" className="field field-lg" defaultValue=""><option value="" disabled>Choose</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label htmlFor={id("role")} className={cn(label, "sm:col-span-2")}>Your role<input id={id("role")} name="role" maxLength={80} autoComplete="organization-title" className="field field-lg" /></label>
      <label htmlFor={id("interest")} className={cn(label, "sm:col-span-2")}><span>What would you use Boredroom for? <span className="font-normal text-subtle">(optional)</span></span><textarea id={id("interest")} name="interest" maxLength={1000} rows={2} className="field field-lg min-h-[4.5rem] py-2" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error ? <p role="alert" className="text-sm font-normal text-danger sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2"><button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(buttonVariants({ variant: "primary", size: "lg" }), "h-11 w-full text-[15px]")}>{pending ? "Adding you…" : cta}</button></div>
      <p className="text-xs font-normal text-secondary sm:col-span-2">One email when we open, nothing else. Reply “unsubscribe” to any email to stop.</p>
    </form>
  );
}
