"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input, InputAdorned, Field, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { ProgressBar } from "@/components/ui/progress-arc";
import { api } from "@/lib/api-client";
import { check, useSubmit } from "@/components/auth/forms";
import { AuthHeading } from "@/components/auth/auth-shell";

const ZONES = ["Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];
const DEFAULT_ZONE = "Africa/Lagos";
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// The browser's own time zone, read after hydration (the server cannot know it), so the list starts on the right one.
const noSubscribe = () => () => {};
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
const serverZone = () => null;

const slugFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");

const nameRule = (v: string) => (v.trim() ? null : "Enter your organisation's name.");
const slugRule = (v: string) => (SLUG.test(v.trim()) ? null : "Use 3 to 64 lowercase letters, numbers and hyphens, starting and ending with a letter or number.");
const codeRule = (v: string) => (!v.trim() || /^[A-Za-z0-9-]{2,24}$/.test(v.trim()) ? null : "Use 2 to 24 letters, numbers or hyphens, or leave it empty.");

/**
 * Creating a workspace, as a calm two-step form (v4): the step count sits above the title in the secondary grey, never
 * as a numbered badge. Step 1 names the workspace and its address; step 2 sets the company time zone and the owner's
 * employee ID, then creates it. Both steps live in one form (the first step's fields stay in it, hidden), so one
 * request sends everything. A mistake in the first step's fields, found here or by the server (an address already
 * taken), brings that step back with the cursor in the field. Moving between steps puts focus on the new step's title.
 */
export function OnboardingForm() {
  const { pending, error, fieldErrors, run, go, showFieldErrors } = useSubmit();
  const [step, setStep] = useState<1 | 2>(1);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const detected = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const zone = chosenZone ?? detected ?? DEFAULT_ZONE;
  const zones = ZONES.includes(zone) ? ZONES : [zone, ...ZONES];

  const slugTaken = error?.code === "SLUG_TAKEN";
  const slugError = fieldErrors.slug ?? (slugTaken ? error?.message : undefined);
  const firstStepWrong = Boolean(fieldErrors.name || slugError);
  const view: 1 | 2 = firstStepWrong ? 1 : step;

  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set by Continue and Back, so focus moves to the new title only when the person moved, not on the first render.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headingRef.current?.focus();
  }, [view]);
  useEffect(() => {
    if (view !== 1 || !firstStepWrong) return;
    formRef.current?.querySelector<HTMLElement>(fieldErrors.name ? '[name="name"]' : '[name="slug"]')?.focus();
  }, [view, firstStepWrong, fieldErrors.name]);

  return (
    <div>
      <AuthHeading ref={headingRef} step={`Step ${view} of 2`}
        title={view === 1 ? "Name your workspace" : "Set the company time zone"}
        subtitle={view === 1 ? "You will be its first owner. Your team opens it at the address below." : "You can change it, and the work schedule, later in Settings."} />
      {/* How far through (accent rules, 6 October 2026: progress fills in orange); the step count above says it in words. */}
      <ProgressBar size="sm" value={view} max={2} doneTone="accent" label="Workspace setup" valueText={`Step ${view} of 2`} className="mx-auto -mt-4 mb-8 max-w-24" />
      <form ref={formRef} className="flex flex-col gap-4" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (view === 1) {
          const errors = check(form, { name: nameRule, slug: slugRule });
          if (errors) return showFieldErrors(form, errors);
          showFieldErrors(form, {});
          moved.current = true;
          setStep(2);
          return;
        }
        const errors = check(form, { name: nameRule, slug: slugRule, employeeCode: codeRule });
        if (errors) return showFieldErrors(form, errors);
        const f = new FormData(form);
        const r = await run(() => api<{ slug: string }>("/api/organisations", { method: "POST", body: { name: f.get("name"), slug: f.get("slug"), timezone: f.get("timezone"), employeeCode: String(f.get("employeeCode") ?? "").trim() || "OWN-001" }, retries: 0 }), form);
        // The workspace's own address decides where it opens (Brenda Home, owner decision, 5 October 2026).
        if (r) go(`/app/${r.slug}`);
      }}>
        {error && !slugTaken ? <Alert tone="danger">{error.message}</Alert> : null}

        <div hidden={view !== 1} className="flex flex-col gap-4">
          <Field label="Organisation name" htmlFor="name" error={fieldErrors.name}>
            <Input id="name" name="name" fieldSize="lg" autoComplete="organization" required maxLength={160} placeholder="Company name" onChange={(e) => { if (!slugTouched) setSlug(slugFrom(e.currentTarget.value)); }} />
          </Field>
          {/* The error mark lands on the inner input; the frame around it is what shows red. */}
          <Field label="Workspace address" htmlFor="slug" description="Lowercase letters, numbers and hyphens." error={slugError}>
            <InputAdorned id="slug" name="slug" prefix="/app/" fieldSize="lg" className="has-[[aria-invalid=true]]:border-danger" required autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={64} value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
          </Field>
        </div>

        <div hidden={view !== 2} className="flex flex-col gap-4">
          <Field label="Company time zone" htmlFor="timezone" error={fieldErrors.timezone}>
            <Select id="timezone" name="timezone" fieldSize="lg" value={zone} onChange={(e) => setChosenZone(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>
          </Field>
          <Field label="Your employee ID" htmlFor="employeeCode" hint="Optional" error={fieldErrors.employeeCode}>
            <Input id="employeeCode" name="employeeCode" fieldSize="lg" placeholder="OWN-001" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={24} />
          </Field>
        </div>

        {/* Only the current step's buttons are in the form, so pressing Enter in a field always means the visible one. */}
        {view === 1 ? (
          <Button type="submit" size="lg" className="mt-2 w-full">Continue</Button>
        ) : (
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="lg" disabled={pending} onClick={() => { moved.current = true; setStep(1); }}>Back</Button>
            <Button type="submit" size="lg" variant="accent" className="min-w-0 flex-1" loading={pending}>{pending ? "Creating workspace…" : "Create workspace"}</Button>
          </div>
        )}
      </form>
    </div>
  );
}
