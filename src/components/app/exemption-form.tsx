"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

export function ExemptionForm({ orgSlug, members }: { orgSlug: string; members: { id: string; display_name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!open) return <Button variant="subtle" size="sm" onClick={() => setOpen(true)}>Add day exemption</Button>;
  return (
    <form className="tile mt-3 flex flex-wrap items-end gap-2 p-3" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setMsg(null);
      const f = new FormData(e.currentTarget);
      try { await api(`/api/orgs/${orgSlug}/exemptions`, { method: "POST", body: { membershipId: f.get("membershipId"), localDate: f.get("localDate"), reason: f.get("reason") } }); setMsg({ tone: "success", text: "Exemption recorded." }); router.refresh(); }
      catch (err) { setMsg({ tone: "danger", text: isApiFailure(err) ? err.error.message : "Cannot reach the server." }); }
      finally { setPending(false); }
    }}>
      <Field label="Member" htmlFor="ex-member"><Select id="ex-member" name="membershipId">{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
      <Field label="Date" htmlFor="ex-date"><Input id="ex-date" name="localDate" type="date" required /></Field>
      <Field label="Reason" htmlFor="ex-reason"><Input id="ex-reason" name="reason" placeholder="Annual leave" required maxLength={500} /></Field>
      <Button type="submit" size="md" variant="outline" disabled={pending}>Save</Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      {msg ? <Alert tone={msg.tone} className="w-full">{msg.text}</Alert> : null}
    </form>
  );
}
