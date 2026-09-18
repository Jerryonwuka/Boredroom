"use client";

/** A list of screen recordings with one shared player. Playback links are short-lived and every play is logged. */
import { useState } from "react";
import Link from "next/link";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime, formatDuration } from "@/lib/utils";
import type { RecordingListRow } from "@/server/services/recording";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { ready: "success", partial: "warning", failed: "danger", deleting: "neutral", processing: "info", uploading: "info", pending: "neutral" };
const STATE_LABEL: Record<string, string> = { ready: "Ready to watch", partial: "Partial", failed: "Failed", processing: "Processing", uploading: "Uploading", pending: "Pending", deleting: "Deleting" };

export function RecordingsTable({ orgSlug, rows, timeZone, showPerson = true, showTask = true, compact = false }: { orgSlug: string; rows: RecordingListRow[]; timeZone: string; showPerson?: boolean; showTask?: boolean; compact?: boolean }) {
  const [playing, setPlaying] = useState<{ id: string; url: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function play(r: RecordingListRow) {
    setError(null); setBusy(r.id);
    try { const p = await api<{ url: string }>(`/api/orgs/${orgSlug}/recordings/${r.id}/playback`, { method: "POST" }); setPlaying({ id: r.id, url: p.url, title: `${r.display_name}, ${r.task_title}` }); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Playback failed."); }
    finally { setBusy(null); }
  }
  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {playing ? (
        <div className="tile p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-semibold">{playing.title}</p><Button size="sm" variant="ghost" aria-label="Close player" onClick={() => setPlaying(null)}><X className="size-4" aria-hidden />Close</Button></div>
          <video controls autoPlay src={playing.url} className="max-h-[60vh] w-full rounded-[var(--radius-sm)] border border-border bg-black" onError={() => setError("The video could not be played in this browser.")} />
          <p className="mt-1 text-xs text-fg-subtle">This link works for 60 seconds. Every play is written to the access log.</p>
        </div>
      ) : null}
      <DataTable caption="Screen recordings">
        <thead><tr>{showPerson ? <th>Person</th> : null}{showTask ? <th>Task</th> : null}<th>Recorded</th><th>Length</th>{compact ? null : <th>Source</th>}<th>Status</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            {showPerson ? <td><span className="font-semibold">{r.display_name}</span>{r.team_names.length ? <p className="text-xs text-fg-subtle">{r.team_names.join(", ")}</p> : null}</td> : null}
            {showTask ? <td><Link href={`/app/${orgSlug}/tasks/${r.task_id}`} className="hover:underline">{r.task_title}</Link>{r.segment_index > 0 ? <span className="ml-1 text-xs text-fg-subtle">part {r.segment_index + 1}</span> : null}</td> : null}
            <td className="text-sm">{r.capture_started_at ? formatDateTime(r.capture_started_at, timeZone) : "—"}</td>
            <td className="tabular-nums">{formatDuration(r.duration_seconds)}</td>
            {compact ? null : <td className="text-sm text-fg-muted">{r.source_label || r.source_type}, {(r.received_bytes / 1048576).toFixed(1)}&nbsp;MB</td>}
            <td><Badge tone={r.restricted_at ? "danger" : TONE[r.upload_state] ?? "neutral"}>{r.restricted_at ? "Restricted" : STATE_LABEL[r.upload_state] ?? r.upload_state}</Badge></td>
            <td className="text-right">{r.upload_state === "ready" && !r.restricted_at ? <Button size="sm" variant={playing?.id === r.id ? "subtle" : "outline"} disabled={busy === r.id} onClick={() => play(r)}><Play className="size-4" aria-hidden />{busy === r.id ? "Opening…" : "Watch"}</Button> : <Link href={`/app/${orgSlug}/tasks/${r.task_id}`} className="text-xs underline">Details</Link>}</td>
          </tr>
        ))}</tbody>
      </DataTable>
    </div>
  );
}
