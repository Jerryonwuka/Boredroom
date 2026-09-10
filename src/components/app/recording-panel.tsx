"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Textarea, Field } from "@/components/ui/input";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

type Rec = { id: string; segment_index: number; source_type: string; capture_state: string; upload_state: string; received_bytes: number; capture_started_at: string | null; capture_ended_at: string | null; expires_at: string; restricted_at: string | null; deleted_at: string | null; failure_reason: string | null };

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { ready: "success", partial: "warning", failed: "danger", restricted: "danger", deleted: "neutral", deleting: "neutral", processing: "info", uploading: "info", pending: "neutral" };

export function SessionRecordings({ orgSlug, recordings, own }: { orgSlug: string; recordings: Rec[]; own: boolean }) {
  const router = useRouter();
  const [playing, setPlaying] = useState<{ id: string; url: string; mime: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  return (
    <div className="mt-2 space-y-1 text-xs">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {recordings.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <span>Segment {r.segment_index + 1} · {r.source_type}</span>
          <Badge tone={TONE[r.upload_state] ?? "neutral"}>{r.upload_state}</Badge>
          <span className="text-fg-subtle">{(r.received_bytes / 1048576).toFixed(1)} MB · expires {formatDateTime(r.expires_at)}</span>
          {r.failure_reason ? <span className="text-warning">{r.failure_reason}</span> : null}
          {r.upload_state === "ready" ? <Button size="sm" variant="ghost" onClick={async () => { setError(null); try { const p = await api<{ url: string }>(`/api/orgs/${orgSlug}/recordings/${r.id}/playback`, { method: "POST" }); setPlaying({ id: r.id, url: p.url, mime: "video/webm" }); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Playback failed"); } }}>Play</Button> : null}
          {own && !r.restricted_at && !r.deleted_at ? <Button size="sm" variant="ghost" onClick={() => setFlagging(r.id)}>Flag sensitive</Button> : null}
          {flagging === r.id ? (
            <form className="mt-1 w-full max-w-md" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await api(`/api/orgs/${orgSlug}/recordings/${r.id}/flag`, { method: "POST", body: { reason: f.get("reason") } }); setFlagging(null); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Failed"); } }}>
              <Field label="Why is this footage sensitive?" htmlFor={`flag-${r.id}`}><Textarea id={`flag-${r.id}`} name="reason" required maxLength={2000} className="min-h-16" /></Field>
              <div className="mt-1 flex gap-2"><Button size="sm" type="submit" variant="danger">Restrict now</Button><Button size="sm" variant="ghost" onClick={() => setFlagging(null)}>Cancel</Button></div>
            </form>
          ) : null}
        </div>
      ))}
      {playing ? (
        <div className="mt-2">
          <p className="mb-1 text-fg-subtle">Playback link valid for 60 seconds; access is logged.</p>
          <video controls src={playing.url} className="max-h-80 w-full rounded-lg border border-border bg-black" onError={() => setError("The media could not be played in this browser.")} />
          <Button size="sm" variant="ghost" onClick={() => setPlaying(null)}>Close</Button>
        </div>
      ) : null}
    </div>
  );
}
