"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

export function JoinCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const m = /([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(value.toUpperCase()); if (m) router.push(`/join/${m[1]}`); }}>
      <Field label="Organisation code or link" htmlFor="join-code" hint="looks like ABCD-1234"><Input id="join-code" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ABCD-1234 or https://…/join/ABCD-1234" autoFocus required /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={!/([A-Z0-9]{4}-[A-Z0-9]{4})/i.test(value)}>Continue</Button>
    </form>
  );
}

export function JoinAccept({ code, orgName }: { code: string; orgName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="lg" className="w-full" disabled={pending} onClick={async () => {
        setPending(true); setError(null);
        try { const r = await api<{ orgSlug: string }>("/api/join/accept", { method: "POST", body: { code }, retries: 0 }); router.push(`/app/${r.orgSlug}/policy?welcome=1`); }
        catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
      }}>{pending ? "Joining…" : `Join ${orgName}`}</Button>
    </div>
  );
}
