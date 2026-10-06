"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, Check, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime, relativeTime } from "@/lib/utils";

type Device = { id: string; device_name: string | null; created_at: string; last_seen_at: string; expires_at: string };

const OFFLINE = "Cannot reach the server. Check your connection and try again.";

/**
 * Approve a desktop code for one workspace, and see or unlink the computers already linked (v4: the code in a large
 * mono field, the white primary to approve, the linked computers as list rows with a ghost unlink button).
 */
export function DesktopLinkForm({ initialCode, workspaces, devices }: { initialCode: string; workspaces: { slug: string; name: string }[]; devices: Device[] }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [org, setOrg] = useState(workspaces[0]?.slug ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="grid gap-8">
      {/* Above both parts: an unlink that fails after a link has gone through still needs somewhere to say so. */}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {done ? (
        <Alert tone="success" title="Linked">Brenda on your computer is signed in to {done}. You can close this tab; the desktop app picks it up in a few seconds.</Alert>
      ) : (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setPending(true); setError(null); setFieldErrors({});
          try { const r = await api<{ workspace: string }>("/api/desktop/link/approve", { method: "POST", body: { userCode: code, orgSlug: org }, retries: 0 }); setDone(r.workspace); router.refresh(); }
          catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError(`${OFFLINE} The computer was not linked.`); }
          finally { setPending(false); }
        }}>
          <Field label="Code on your screen" htmlFor="dl-code" error={fieldErrors.userCode}><Input id="dl-code" fieldSize="lg" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KQ7M-4TXD" maxLength={12} required autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono text-lg tracking-[0.2em]" /></Field>
          {workspaces.length > 1 ? <Field label="Workspace" htmlFor="dl-org" error={fieldErrors.orgSlug}><Select id="dl-org" value={org} onChange={(e) => setOrg(e.target.value)}>{workspaces.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}</Select></Field> : null}
          {workspaces.length === 0 ? <Alert tone="warning">You are not in a workspace yet. Join or create one first.</Alert> : null}
          <Button type="submit" size="lg" loading={pending} disabled={!code.trim() || !org}>{pending ? null : <Check aria-hidden />}{pending ? "Approving…" : "Approve this computer"}</Button>
          <p className="text-xs font-medium text-subtle">Only approve a code you started yourself on your own computer.</p>
        </form>
      )}
      {devices.length ? (
        <div>
          <p className="mb-1 text-sm font-medium text-secondary">Linked computers</p>
          <LinkedComputers devices={devices} onError={setError} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The computers linked to the person's account, as list rows: a laptop in a 40px square, the name, when it was linked
 * and last active, and a ghost unlink button that asks first. Used on the link page and in Settings, Desktop.
 */
export function LinkedComputers({ devices, onError, empty = false }: { devices: Device[]; onError?: (message: string | null) => void; /** Show an empty state when there are none. */ empty?: boolean }) {
  const router = useRouter();
  const [ownError, setOwnError] = useState<string | null>(null);
  const report = onError ?? setOwnError;
  if (!devices.length) return empty ? <EmptyState compact icon={Laptop} title="No computers linked" description="Open Brenda desktop and press Sign in. It shows a code and opens a page in your browser to approve it." /> : null;
  return (
    <>
      {!onError && ownError ? <Alert tone="danger" className="mb-2">{ownError}</Alert> : null}
      <ul className="-mx-2 space-y-0.5">
        {devices.map((d) => {
          const name = d.device_name ?? "Brenda desktop";
          return (
            <li key={d.id} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-fill-1 text-secondary"><Laptop className="size-5" aria-hidden /></span>
              {/* Dates follow the browser's clock and zone, which the server cannot know; the text settles on the client. */}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{name}</span><span className="block truncate text-meta font-normal text-secondary">Linked <time dateTime={d.created_at} suppressHydrationWarning>{formatDateTime(d.created_at)}</time>, active <time dateTime={d.last_seen_at} suppressHydrationWarning>{relativeTime(d.last_seen_at)}</time></span></span>
              <ConfirmButton variant="ghost" size="icon-sm" aria-label={`Unlink ${name}`} title={`Unlink ${name}?`} description="Brenda on that computer is signed out at once. Link it again any time with a new code from the app." confirmLabel="Unlink" pendingLabel="Unlinking…"
                onConfirm={async () => { report(null); try { await api(`/api/desktop/devices/${d.id}`, { method: "DELETE", retries: 0 }); router.refresh(); } catch (err) { report(isApiFailure(err) ? err.error.message : `${OFFLINE} ${name} is still linked.`); } }}>
                <Unlink aria-hidden />
              </ConfirmButton>
            </li>
          );
        })}
      </ul>
    </>
  );
}
