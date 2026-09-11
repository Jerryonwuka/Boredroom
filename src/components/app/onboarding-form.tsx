"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

const ZONES = ["Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];

export function OnboardingForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null); setFieldErrors({});
      const f = new FormData(e.currentTarget);
      try {
        const r = await api<{ slug: string }>("/api/organisations", { method: "POST", body: { name: f.get("name"), slug: f.get("slug"), timezone: f.get("timezone"), employeeCode: f.get("employeeCode") || "OWN-001" }, retries: 0 });
        router.push(`/app/${r.slug}/dashboard`);
      } catch (err) {
        if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server.");
      } finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Organisation name" htmlFor="name" error={fieldErrors.name}>
        <Input id="name" name="name" required maxLength={160} onChange={(e) => { if (!slugTouched) setSlug(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)); }} />
      </Field>
      <Field label="Workspace URL" htmlFor="slug" hint="lowercase letters, numbers, hyphens" error={fieldErrors.slug}>
        <div className="flex items-center gap-2"><span className="text-sm text-fg-subtle">/app/</span><Input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} /></div>
      </Field>
      <Field label="Company time zone" htmlFor="timezone" error={fieldErrors.timezone}>
        <Select id="timezone" name="timezone" defaultValue="Africa/Lagos">{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
      </Field>
      <Field label="Your employee ID" htmlFor="employeeCode" hint="optional" error={fieldErrors.employeeCode}><Input id="employeeCode" name="employeeCode" placeholder="OWN-001" /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
    </form>
  );
}
