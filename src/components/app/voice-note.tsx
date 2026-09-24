"use client";

/** A voice note in a bubble: play or pause, a progress bar that seeks, and the time. */
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
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play().catch(() => setFailed(true)); else a.pause(); };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => { const a = audio.current; if (!a || !length) return; const r = e.currentTarget.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length; };
  const progress = length ? Math.min(100, (at / length) * 100) : 0;
  const track = mine ? "bg-[rgba(255,255,255,0.14)]" : "bg-wash-active";
  return (
    <div className="flex min-w-[220px] items-center gap-3 py-0.5">
      <audio ref={audio} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0); }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setLength(e.currentTarget.duration); }} onError={() => setFailed(true)} />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause voice note" : "Play voice note"} className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-[var(--duration-fast)] hover:scale-105", "bg-[linear-gradient(180deg,var(--accent-hover),var(--accent))] text-accent-fg shadow-[0_6px_16px_-6px_rgba(255,108,2,0.6)]")}>
        {playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="ml-0.5 size-4 fill-current" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(at)} tabIndex={0} onClick={seek} onKeyDown={(e) => { const a = audio.current; if (!a) return; if (e.key === "ArrowRight") a.currentTime = Math.min(length, a.currentTime + 5); if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5); }}
          className={cn("relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full", track)}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-100" style={{ width: `${progress}%` }} />
        </div>
        <p className={cn("mt-1.5 text-[11px] tabular-nums", mine ? "text-fg-muted" : "text-fg-subtle")}>{failed ? "Could not play this note" : `${fmt(playing || at ? at : 0)} / ${fmt(length)}`}</p>
      </div>
    </div>
  );
}
