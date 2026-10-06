"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { useSubmit } from "@/components/auth/forms";
import { AUTH_LINK } from "@/components/auth/auth-shell";

const CODE = /([A-Z0-9]{4}-[A-Z0-9]{4})/i;

/** Takes the code or the whole link, whichever the person was given, and opens that organisation's join page. */
export function JoinCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      e.preventDefault();
      const m = CODE.exec(value.toUpperCase());
      if (!m) { setError(value.trim() ? "That does not look like a code. It has eight letters or numbers with a hyphen in the middle, like ABCD-1234." : "Enter the code or paste the link from your organisation."); return; }
      setError(null);
      startOpening(() => router.push(`/join/${m[1]}`));
    }}>
      <Field label="Organisation code or link" htmlFor="join-code" description="A code looks like ABCD-1234." error={error ?? undefined}>
        <Input id="join-code" name="code" fieldSize="lg" value={value} onChange={(e) => { setValue(e.target.value); if (error) setError(null); }} placeholder="ABCD-1234 or the join link" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus required />
      </Field>
      <Button type="submit" size="lg" className="mt-2 w-full" loading={opening}>{opening ? "Opening…" : "Continue"}</Button>
    </form>
  );
}

export function JoinAccept({ code, orgName, orgSlug }: { code: string; orgName: string; orgSlug: string }) {
  const { pending, error, run, go } = useSubmit();
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.code === "ALREADY_MEMBER" ? <span className="mt-2 block"><Link className={AUTH_LINK} href={`/app/${orgSlug}`}>Open {orgName}</Link></span> : null}
        </Alert>
      ) : null}
      <Button size="lg" className="w-full" loading={pending} onClick={async () => {
        const r = await run(() => api<{ orgSlug: string }>("/api/join/accept", { method: "POST", body: { code }, retries: 0 }));
        if (r) go(`/app/${r.orgSlug}/home`); // straight in: no policy step (owner decision, 5 October 2026)
      }}>{pending ? "Joining…" : `Join ${orgName}`}</Button>
    </div>
  );
}
