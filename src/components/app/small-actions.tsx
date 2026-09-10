"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

export function MarkRead({ orgSlug, id }: { orgSlug: string; id: string }) {
  const router = useRouter();
  return <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/orgs/${orgSlug}/notifications/${id}`, { method: "PATCH" }); router.refresh(); }}>Mark read</Button>;
}

export function AcknowledgePolicy({ orgSlug, next }: { orgSlug: string; next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> <span>I have read this version of the notice. (This records what you were shown and when; it does not by itself settle every legal question about monitoring.)</span></label>
      <Button disabled={!checked || pending} onClick={async () => { setPending(true); setError(null); try { await api(`/api/orgs/${orgSlug}/policy/acknowledge`, { method: "POST" }); router.push(next && next.startsWith("/") ? next : `/app/${orgSlug}/my-day`); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); } }}>{pending ? "Saving…" : "Acknowledge"}</Button>
    </div>
  );
}

/** Generic decision form used by the review queue (reports, corrections, exceptions, incidents). */
export function DecisionForm({ path, options, noteLabel = "Note", extra }: { path: string; options: { value: string; label: string }[]; noteLabel?: string; extra?: Record<string, unknown> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-2 grid gap-2" onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null);
      const f = new FormData(e.currentTarget);
      const decisionKey = options[0].value === "deleted" || options[0].value === "released" ? "disposition" : "decision";
      try { await api(path, { method: "POST", body: { [decisionKey]: f.get("decision"), note: f.get("note"), ...(extra ?? {}) } }); router.refresh(); }
      catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm"><span className="sr-only">Decision</span><select name="decision" className="h-10 rounded-xl border border-border-strong bg-inset px-3 text-sm">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <div className="min-w-60 flex-1"><Field label={noteLabel} htmlFor={`note-${path}`}><Textarea id={`note-${path}`} name="note" className="min-h-10" maxLength={4000} /></Field></div>
        <Button size="sm" type="submit" disabled={pending}>{pending ? "Saving…" : "Decide"}</Button>
      </div>
    </form>
  );
}
