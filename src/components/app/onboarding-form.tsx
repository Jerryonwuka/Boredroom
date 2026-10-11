"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input, InputAdorned, Field, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { SITE_ORIGIN } from "@/lib/site";
import { welcomeAutoPath } from "@/lib/welcome";
import { check, useSubmit } from "@/components/auth/forms";
import { AuthHeading } from "@/components/auth/auth-shell";

const ZONES = ["Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];
const DEFAULT_ZONE = "Africa/Lagos";
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

// The browser's own time zone, read after hydration (the server cannot know it), so the list starts on the right one.
const noSubscribe = () => () => {};
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
const serverZone = () => null;

const slugFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");

const nameRule = (v: string) => (v.trim() ? null : "Enter your organisation's name.");
const slugRule = (v: string) => (SLUG.test(v.trim()) ? null : "Use 3 to 64 lowercase letters, numbers and hyphens, starting and ending with a letter or number.");

/** A summary line with its "Change" button: "Address: boredroom.cc/app/acme  Change". */
function Summary({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta font-normal text-secondary">
      <span className="min-w-0 break-all">{label}: <span className="font-medium text-foreground">{value}</span></span>
      <Button variant="ghost" size="xs" className="-my-1 shrink-0" aria-label={`Change ${label.toLowerCase()}`} onClick={onChange}>Change</Button>
    </p>
  );
}

/**
 * Creating a workspace, one screen (owner request, 11 October 2026: the first-run welcome, D21; it was two steps). The
 * one thing the founder must decide is the name: the address follows it and the time zone is detected, each shown as
 * one line with "Change" that opens its field. The owner's employee ID is no longer asked (the server keeps OWN-001;
 * People edits it). An address the server refuses (taken, or not allowed) opens the address field with the error and
 * the cursor in it. Then straight into the workspace's welcome, which takes about two minutes.
 */
export function OnboardingForm() {
  const { pending, error, fieldErrors, run, go, showFieldErrors } = useSubmit();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [editAddress, setEditAddress] = useState(false);
  const [editZone, setEditZone] = useState(false);
  const detected = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const zone = chosenZone ?? detected ?? DEFAULT_ZONE;
  const zones = ZONES.includes(zone) ? ZONES : [zone, ...ZONES];

  const slugTaken = error?.code === "SLUG_TAKEN";
  const slugError = fieldErrors.slug ?? (slugTaken ? error?.message : undefined);
  // A wrong address is never hidden behind its summary line.
  const showAddress = editAddress || Boolean(slugError);

  const formRef = useRef<HTMLFormElement>(null);
  // "Change" puts the cursor in the field it opened; an address error puts it there too.
  const focusNext = useRef<"slug" | "timezone" | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    formRef.current?.querySelector<HTMLElement>(`[name="${target}"]`)?.focus();
  }, [showAddress, editZone]);
  useEffect(() => {
    if (slugError) formRef.current?.querySelector<HTMLElement>('[name="slug"]')?.focus();
  }, [slugError]);

  return (
    <div>
      <AuthHeading title="Create your workspace" subtitle="You'll be its first owner. Next comes a two-minute setup for you and your assistant." />
      <form ref={formRef} className="flex flex-col gap-4" method="post" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const errors = check(form, { name: nameRule, slug: slugRule });
        if (errors) {
          if (errors.slug && !errors.name) setEditAddress(true);
          return showFieldErrors(form, errors);
        }
        const r = await run(() => api<{ slug: string }>("/api/organisations", { method: "POST", body: { name: name.trim(), slug: slug.trim(), timezone: zone }, retries: 0 }), form);
        // Into the workspace's two-minute welcome (owner request, 11 October 2026).
        if (r) go(welcomeAutoPath(r.slug));
      }}>
        {error && !slugTaken ? <Alert tone="danger">{error.message}</Alert> : null}

        <Field label="Organisation name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" name="name" fieldSize="lg" autoFocus autoComplete="organization" required maxLength={160} placeholder="Company name" value={name}
            onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugFrom(e.target.value)); }} />
        </Field>

        {/* Each line opens its field in its own place. The slug always travels with the form, so an unopened address is
            still sent and checked. The error mark lands on the inner input; the frame around it is what shows red. */}
        {showAddress ? (
          <Field label="Workspace address" htmlFor="slug" description="Lowercase letters, numbers and hyphens." error={slugError}>
            <InputAdorned id="slug" name="slug" prefix="/app/" fieldSize="lg" className="has-[[aria-invalid=true]]:border-danger" required autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={64}
              value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
          </Field>
        ) : (
          <div className="-mt-2">
            <input type="hidden" name="slug" value={slug} />
            <Summary label="Address" value={`${HOST}/app/${slug || "your-company"}`}
              onChange={() => { focusNext.current = "slug"; setEditAddress(true); }} />
          </div>
        )}

        {editZone ? (
          <Field label="Company time zone" htmlFor="timezone" description="You can change it, and the work schedule, later in Settings." error={fieldErrors.timezone}>
            <Select id="timezone" name="timezone" fieldSize="lg" value={zone} onChange={(e) => setChosenZone(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>
          </Field>
        ) : (
          <div className={showAddress ? "-mt-2" : "-mt-3"}>
            <Summary label="Time zone" value={zone.replace(/_/g, " ")}
              onChange={() => { focusNext.current = "timezone"; setEditZone(true); }} />
          </div>
        )}

        <Button type="submit" size="lg" className="mt-2 w-full" loading={pending}>{pending ? "Creating workspace…" : "Create workspace"}</Button>
      </form>
    </div>
  );
}
