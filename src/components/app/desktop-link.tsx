"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, Check, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime, relativeTime } from "@/lib/utils";

type Device = { id: string; device_name: string | null; created_at: string; last_seen_at: string; expires_at: string };

/** Approve a desktop code for one workspace, and see or unlink the computers already linked. */
export function DesktopLinkForm({ initialCode, workspaces, devices }: { initialCode: string; workspaces: { slug: string; name: string }[]; devices: Device[] }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [org, setOrg] = useState(workspaces[0]?.slug ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      {done ? (
        <Alert tone="success" title="Linked">Brenda on your computer is signed in to {done}. You can close this tab; the desktop app picks it up in a few seconds.</Alert>
      ) : (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setPending(true); setError(null);
          try { const r = await api<{ workspace: string }>("/api/desktop/link/approve", { method: "POST", body: { userCode: code, orgSlug: org }, retries: 0 }); setDone(r.workspace); router.refresh(); }
          catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
          finally { setPending(false); }
        }}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Code on your screen" htmlFor="dl-code"><Input id="dl-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KQ7M-4TXD" maxLength={12} required autoComplete="off" className="font-mono text-lg tracking-[0.2em]" /></Field>
          {workspaces.length > 1 ? <Field label="Workspace" htmlFor="dl-org"><Select id="dl-org" value={org} onChange={(e) => setOrg(e.target.value)}>{workspaces.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}</Select></Field> : null}
          {workspaces.length === 0 ? <Alert tone="warning">You are not in a workspace yet. Join or create one first.</Alert> : null}
          <Button type="submit" disabled={pending || !code.trim() || !org}><Check className="size-4" aria-hidden />{pending ? "Approving…" : "Approve this computer"}</Button>
          <p className="text-xs text-fg-subtle">Only approve a code you started yourself on your own computer.</p>
        </form>
      )}
      {devices.length ? (
        <div>
          <p className="eyebrow mb-2">Linked computers</p>
          <ul className="divide-y divide-border-soft">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-wash"><Laptop className="size-4 text-fg-muted" aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{d.device_name ?? "Brenda desktop"}</span><span className="block text-xs text-fg-subtle">Linked {formatDateTime(d.created_at)} · active {relativeTime(d.last_seen_at)}</span></span>
                <IconButton aria-label={`Unlink ${d.device_name ?? "this computer"}`} className="size-9 text-danger hover:text-danger" onClick={async () => { try { await api(`/api/desktop/devices/${d.id}`, { method: "DELETE", retries: 0 }); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } }}><Unlink className="size-4" aria-hidden /></IconButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
