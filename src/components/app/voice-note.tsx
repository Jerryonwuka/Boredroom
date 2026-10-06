"use client";

/** A voice note in a bubble, v4: a round white play button, a thin track that seeks (click, arrows, Home, End), and the time. */
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function VoiceNote({ src, seconds, mine }: { src: string; seconds: number; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(seconds);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { audio.current?.pause(); }, []);
  // After a failed load, pressing play tries again from a fresh request.
  const toggle = () => { const a = audio.current; if (!a) return; if (failed) { setFailed(false); a.load(); } if (a.paused) void a.play().catch(() => setFailed(true)); else a.pause(); };
  const seekTo = (t: number) => { const a = audio.current; if (!a || !length) return; a.currentTime = Math.max(0, Math.min(length, t)); setAt(a.currentTime); };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length); };
  const keys: Record<string, () => number> = { ArrowRight: () => at + 5, ArrowUp: () => at + 5, ArrowLeft: () => at - 5, ArrowDown: () => at - 5, Home: () => 0, End: () => length };
  const progress = length ? Math.min(1, at / length) : 0;
  return (
    <div className="flex min-w-[220px] items-center gap-3 py-0.5">
      <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0); }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setLength(e.currentTarget.duration); }} onError={() => setFailed(true)} />
      {/* v4: the white primary, round; the one live control in the bubble. */}
      <button type="button" onClick={toggle} aria-label={playing ? "Pause voice note" : failed ? "Try playing the voice note again" : "Play voice note"}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-colors duration-75 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:size-10">
        {playing ? <Pause className="size-3.5 fill-current" aria-hidden /> : <Play className="ml-0.5 size-3.5 fill-current" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div role="slider" aria-label="Voice note position" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(at)} aria-valuetext={`${fmt(at)} of ${fmt(length)}`} tabIndex={0} onClick={seek}
          onKeyDown={(e) => { const next = keys[e.key]; if (!next) return; e.preventDefault(); seekTo(next()); }}
          className="relative flex h-5 w-full cursor-pointer items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-border-input-hover">
            {/* Progress moves by transform only, so playback never triggers layout. */}
            <div className="absolute inset-0 origin-left rounded-full bg-foreground transition-transform duration-100 ease-linear" style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>
        <p className={cn("text-xs font-medium tabular-nums", failed ? "text-danger" : mine ? "text-secondary" : "text-subtle")}>{failed ? "Could not play this note" : `${fmt(playing || at ? at : 0)} / ${fmt(length)}`}</p>
      </div>
    </div>
  );
}
