"use client";

/**
 * The person's own Research list (Brenda's research in the background; owner decision, 28 October 2026: "Brenda, research
 * X and give me a PDF when you're done").
 *
 * One calm row per report, newest first, hairlines between them: the title (or the question while it is not written
 * yet) in medium, then a meta line in commas: the status word beside its dot ("Waiting to start", "Researching" with the
 * live dot, "Ready" green, "Couldn't finish" red, "Stopped"), when it was asked or finished, and the sources it cites.
 * A ready report offers PDF, Word and Markdown downloads (secondary buttons: never orange), the one it was asked for
 * first; a live one offers Stop (through ConfirmButton). A failure shows its plain words. Waiting more than ten minutes
 * says the background worker isn't running, honestly. The report a notification opened (`?r=`) is marked with the 2px
 * selected marker. Orange stays within the accent rules: the live dot and the marker.
 *
 * It reads `GET /api/orgs/{org}/brenda/research` again every 8 seconds while anything is waiting or running, for at most
 * 30 minutes, and never after the page goes. Before migration 0066 an info alert says it needs a database update.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileSearch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { Alert, EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, isApiFailure } from "@/lib/api-client";
import { whenWords } from "@/lib/jobs";
import { RESEARCH_FORMATS, RESEARCH_WORDS as W, researchLive, type ResearchFormat, type ResearchItem } from "@/lib/research";
import { cn } from "@/lib/utils";

const POLL_MS = 8_000;
const POLL_FOR_MS = 30 * 60_000;
const SLOW_MS = 10 * 60_000;

const TONE: Record<ResearchItem["status"], StatusTone> = { queued: "neutral", running: "live", done: "success", failed: "danger", stopped: "neutral" };

export type ResearchListProps = {
  orgSlug: string; timeZone: string; name: string;
  initial: { ready: boolean; reports: ResearchItem[] };
  /** The report a notification opened (`?r=`), marked. */
  selected: string | null;
  /** The server's clock, so "today" reads the same on both sides. */
  now: number;
};

/** The formats in the order to offer them: the one asked for first. */
const formatsFor = (asked: ResearchFormat) => [asked, ...RESEARCH_FORMATS.filter((f) => f !== asked)];

export function ResearchRow({ r, orgSlug, timeZone, now, selected, onStopped }: { r: ResearchItem; orgSlug: string; timeZone: string; now: number; selected: boolean; onStopped: (r: ResearchItem) => void }) {
  const live = researchLive(r.status);
  const title = r.title || r.topic;
  const status = r.status === "queued" && now - Date.parse(r.createdAt) > SLOW_MS ? W.queuedSlow : W.status[r.status];
  const when = r.finishedAt ? W.finished(whenWords(r.finishedAt, timeZone, new Date(now))) : r.startedAt ? W.started(whenWords(r.startedAt, timeZone, new Date(now))) : W.asked(whenWords(r.createdAt, timeZone, new Date(now)));
  const file = (f: ResearchFormat) => `/api/orgs/${orgSlug}/brenda/research/${encodeURIComponent(r.id)}/file?format=${f}`;
  return (
    // Only a ready report's downloads may wrap under its words on a phone; Stop stays beside them.
    <li id={`research-${r.id}`} className={cn("relative flex items-start gap-x-3 gap-y-2 py-4", r.status === "done" && "flex-wrap", selected && "selected-marker pl-3")} aria-current={selected || undefined}>
      <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary"><FileSearch className="size-4" /></span>
      <div className={cn("min-w-0 flex-1 space-y-1.5", r.status === "done" && "basis-60")}>
        <p className="break-words text-sm font-medium text-foreground">{title}</p>
        <p className="flex items-start gap-1.5 text-meta text-secondary">
          <StatusDot tone={TONE[r.status]} pulse={r.status === "running"} className="mt-1.5 shrink-0" />
          <span className="min-w-0 tabular-nums">{[status, when, r.status === "done" && r.sources ? W.sources(r.sources) : null].filter(Boolean).join(", ")}</span>
        </p>
        {r.title && r.title !== r.topic ? <p className="break-words text-meta text-secondary">{r.topic}</p> : null}
        {r.status === "failed" && r.error ? <p className="break-words text-sm text-secondary">{r.error}</p> : null}
      </div>
      {r.status === "done" ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 max-sm:pl-11">
          {formatsFor(r.format).map((f) => (
            <a key={f} href={file(f)} download className={buttonVariants({ variant: "secondary", size: "xs" })} aria-label={W.downloadLabel(f, title)}>{W.download(f)}</a>
          ))}
        </div>
      ) : live ? (
        <ConfirmButton variant="ghost" size="xs" className="shrink-0" title={W.stopTitle} description={W.stopBody}
          confirmLabel={W.stop} pendingLabel="Stopping…" aria-label={W.stopLabel(title)}
          onConfirm={async () => {
            try {
              const out = await api<{ research: ResearchItem }>(`/api/orgs/${orgSlug}/brenda/research/${encodeURIComponent(r.id)}/stop`, { method: "POST", retries: 1 });
              notify(W.stopped, { tone: "success" });
              onStopped(out.research);
            } catch (err) {
              notify(isApiFailure(err) && err.message ? err.message : W.stopFailed, { tone: "danger" });
            }
          }}>
          {W.stop}
        </ConfirmButton>
      ) : null}
    </li>
  );
}

export function ResearchList({ orgSlug, timeZone, name, initial, selected, now }: ResearchListProps) {
  const [data, setData] = useState(initial);
  const [clock, setClock] = useState(now);
  const started = useRef(now);
  const anyLive = data.reports.some((r) => researchLive(r.status));

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await api<{ ready: boolean; reports: ResearchItem[] }>(`/api/orgs/${orgSlug}/brenda/research`, { signal });
      setData(next);
      setClock(Date.now());
    } catch { /* the next poll tries again; the list stays as it was */ }
  }, [orgSlug]);

  useEffect(() => {
    if (!anyLive || clock - started.current > POLL_FOR_MS) return;
    const ctl = new AbortController();
    const t = setTimeout(() => { void refresh(ctl.signal); }, POLL_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [anyLive, clock, data, refresh]);

  // The report a notification opened comes into view once.
  useEffect(() => {
    if (selected) document.getElementById(`research-${selected}`)?.scrollIntoView({ block: "center" });
  }, [selected]);

  if (!data.ready) return <Alert tone="info">{W.notReady}</Alert>;
  if (!data.reports.length) return <EmptyState title={W.emptyTitle} description={W.emptyBody(name)} />;
  return (
    <ul className="divide-y divide-border" aria-label={W.title}>
      {data.reports.map((r) => (
        <ResearchRow key={r.id} r={r} orgSlug={orgSlug} timeZone={timeZone} now={clock} selected={r.id === selected}
          onStopped={(x) => setData((d) => ({ ...d, reports: d.reports.map((y) => (y.id === x.id ? x : y)) }))} />
      ))}
    </ul>
  );
}
