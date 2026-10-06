"use client";

/**
 * A list of screen recordings, v4: a calm table with tiny status badges and tabular figures; Watch opens the player in
 * a wide side sheet. Playback links are short-lived and every play is logged.
 */
import { useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { Sheet } from "@/components/ui/sheet";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime, formatDuration } from "@/lib/utils";
import type { RecordingListRow } from "@/server/services/recording";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { ready: "success", partial: "warning", failed: "danger", deleting: "info", processing: "neutral", uploading: "neutral", pending: "info" };
const STATE_LABEL: Record<string, string> = { ready: "Ready to watch", partial: "Partial", failed: "Failed", processing: "Processing", uploading: "Uploading", pending: "Pending", deleting: "Deleting" };

export function RecordingsTable({ orgSlug, rows, timeZone, showPerson = true, showTask = true, compact = false }: { orgSlug: string; rows: RecordingListRow[]; timeZone: string; showPerson?: boolean; showTask?: boolean; compact?: boolean }) {
  const [playing, setPlaying] = useState<{ id: string; url: string; title: string; when: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function play(r: RecordingListRow) {
    setError(null); setVideoError(null); setBusy(r.id);
    try {
      const p = await api<{ url: string }>(`/api/orgs/${orgSlug}/recordings/${r.id}/playback`, { method: "POST" });
      setPlaying({ id: r.id, url: p.url, title: `${r.display_name}, ${r.task_title}`, when: r.capture_started_at ? formatDateTime(r.capture_started_at, timeZone) : "" });
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server to open the recording. Check your connection and try again."); }
    finally { setBusy(null); }
  }
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable caption="Screen recordings">
        <thead><tr>{showPerson ? <th>Person</th> : null}{showTask ? <th>Task</th> : null}<th>Recorded</th><th className="!text-right">Length</th>{compact ? null : <th>Source</th>}<th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            {showPerson ? <td><span className="font-medium">{r.display_name}</span>{r.team_names.length ? <p className="text-meta text-secondary">{r.team_names.join(", ")}</p> : null}</td> : null}
            {showTask ? <td><Link href={`/app/${orgSlug}/tasks/${r.task_id}`} className="hover:underline">{r.task_title}</Link>{r.segment_index > 0 ? <span className="ml-1.5 text-meta text-secondary">part <span className="tabular-nums">{r.segment_index + 1}</span></span> : null}</td> : null}
            <td className="nowrap tabular-nums text-secondary">{r.capture_started_at ? formatDateTime(r.capture_started_at, timeZone) : "Not started"}</td>
            <td className="nowrap text-right tabular-nums">{formatDuration(r.duration_seconds)}</td>
            {compact ? null : <td className="text-secondary">{r.source_label || r.source_type}, <span className="tabular-nums">{(r.received_bytes / 1048576).toFixed(1)}</span>&nbsp;MB</td>}
            <td><Badge tone={r.restricted_at ? "danger" : TONE[r.upload_state] ?? "neutral"} dot={r.upload_state === "ready" && !r.restricted_at}>{r.restricted_at ? "Restricted" : STATE_LABEL[r.upload_state] ?? r.upload_state}</Badge></td>
            <td className="nowrap"><span className="flex justify-end">{r.upload_state === "ready" && !r.restricted_at
              ? <Button size="xs" variant={playing?.id === r.id ? "subtle" : "secondary"} loading={busy === r.id} aria-label={`Watch ${r.display_name}, ${r.task_title}`} onClick={() => play(r)}>{busy === r.id ? null : <Play aria-hidden />}{busy === r.id ? "Opening…" : "Watch"}</Button>
              : <Link href={`/app/${orgSlug}/tasks/${r.task_id}`} className={buttonVariants({ variant: "ghost", size: "xs" })} aria-label={`Details for ${r.task_title}`}>Details</Link>}</span></td>
          </tr>
        ))}</tbody>
      </DataTable>
      <Sheet open={!!playing} onClose={() => setPlaying(null)} size="lg" title={playing?.title ?? "Recording"} closeLabel="Close player"
        description={<>{playing?.when ? <>{playing.when}. </> : null}The link works for 60 seconds. Every play is written to the access log.</>}>
        {playing ? (
          <div className="space-y-3">
            {videoError ? <Alert tone="danger">{videoError}</Alert> : null}
            <video key={playing.id} controls autoPlay src={playing.url} className="max-h-[70dvh] w-full rounded-xl border border-border bg-black" onError={() => setVideoError("This browser could not play the video. Try another browser, or press Watch again for a fresh link.")} />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
