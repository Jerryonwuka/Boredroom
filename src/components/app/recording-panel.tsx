"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Textarea, Field } from "@/components/ui/input";
import { api, isApiFailure } from "@/lib/api-client";

type Rec = { id: string; segment_index: number; source_type: string; capture_state: string; upload_state: string; received_bytes: number; capture_started_at: string | null; capture_ended_at: string | null; expires_at: string; restricted_at: string | null; deleted_at: string | null; failure_reason: string | null };

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { ready: "success", partial: "warning", failed: "danger", restricted: "danger", deleted: "neutral", deleting: "neutral", processing: "info", uploading: "info", pending: "neutral" };
const STATE_LABEL: Record<string, string> = { ready: "Ready to watch", partial: "Partial", failed: "Failed", processing: "Processing", uploading: "Uploading", pending: "Pending", deleting: "Deleting", deleted: "Deleted" };
const sourceLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/**
 * The recordings of one work session, inside the task's session list. Times read in the organisation's zone when the
 * page passes `timeZone`; without it the expiry is a date in UTC, the same on the server and in the browser.
 */
export function SessionRecordings({ orgSlug, recordings, own, timeZone }: { orgSlug: string; recordings: Rec[]; own: boolean; timeZone?: string }) {
  const router = useRouter();
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const formId = useId();
  const expiry = (iso: string) => new Intl.DateTimeFormat("en-GB", timeZone ? { dateStyle: "medium", timeStyle: "short", timeZone } : { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
  async function play(r: Rec) {
    setError(null); setBusy(r.id);
    try { const p = await api<{ url: string }>(`/api/orgs/${orgSlug}/recordings/${r.id}/playback`, { method: "POST" }); setPlaying({ id: r.id, url: p.url }); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server to open the recording. Check your connection and try again."); }
    finally { setBusy(null); }
  }
  return (
    <div className="mt-2 space-y-2 text-meta font-normal">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {recordings.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">Part <span className="tabular-nums">{r.segment_index + 1}</span>, {sourceLabel(r.source_type).toLowerCase()}</span>
          <Badge tone={r.restricted_at ? "danger" : TONE[r.upload_state] ?? "neutral"}>{r.restricted_at ? "Restricted" : STATE_LABEL[r.upload_state] ?? r.upload_state}</Badge>
          <span className="text-secondary"><span className="tabular-nums">{(r.received_bytes / 1048576).toFixed(1)}</span> MB, kept until {expiry(r.expires_at)}</span>
          {r.failure_reason ? <span className="text-warning">{r.failure_reason}</span> : null}
          {r.upload_state === "ready" && !r.restricted_at ? <Button size="xs" variant="secondary" loading={busy === r.id} onClick={() => play(r)}>{busy === r.id ? "Opening…" : playing?.id === r.id ? "Playing" : "Watch"}</Button> : null}
          {own && !r.restricted_at && !r.deleted_at ? <Button size="xs" variant="ghost" aria-expanded={flagging === r.id} aria-controls={flagging === r.id ? `${formId}-${r.id}` : undefined} onClick={() => { setFlagError(null); setFlagging(flagging === r.id ? null : r.id); }}>Flag as sensitive</Button> : null}
          {flagging === r.id ? (
            <form id={`${formId}-${r.id}`} className="mt-1 grid w-full max-w-md gap-2" onSubmit={async (e) => {
              e.preventDefault(); const f = new FormData(e.currentTarget); setFlagError(null); setBusy(`flag-${r.id}`);
              try { await api(`/api/orgs/${orgSlug}/recordings/${r.id}/flag`, { method: "POST", body: { reason: f.get("reason") } }); setFlagging(null); router.refresh(); }
              catch (err) { setFlagError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again."); }
              finally { setBusy(null); }
            }}>
              <p className="text-secondary">Flagged footage is locked at once. Nobody can watch it until a privacy administrator reviews it.</p>
              <Field label="Why is this footage sensitive?" htmlFor={`flag-${r.id}`} error={flagError ?? undefined}><Textarea id={`flag-${r.id}`} name="reason" required maxLength={2000} className="min-h-16" /></Field>
              <div className="flex flex-wrap gap-2"><Button size="sm" type="submit" variant="danger" loading={busy === `flag-${r.id}`}>{busy === `flag-${r.id}` ? "Flagging…" : "Flag as sensitive"}</Button><Button size="sm" variant="ghost" onClick={() => setFlagging(null)}>Cancel</Button></div>
            </form>
          ) : null}
        </div>
      ))}
      {playing ? (
        <div className="mt-2" role="region" aria-label="Recording player">
          <p className="mb-1.5 text-secondary">The link works for 60 seconds. Every play is written to the access log.</p>
          <video key={playing.id} controls autoPlay src={playing.url} className="max-h-80 w-full rounded-xl border border-border bg-black" onError={() => setError("This browser could not play the video. Try another browser, or press Watch again for a fresh link.")} />
          <Button size="xs" variant="ghost" className="mt-1.5" onClick={() => setPlaying(null)}>Close player</Button>
        </div>
      ) : null}
    </div>
  );
}
