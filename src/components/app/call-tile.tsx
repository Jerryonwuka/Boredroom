"use client";

/**
 * One person on a call (owner decisions, 8 October 2026: phase 8, calls; contract D.6). A tile is r16 on fill-1. With
 * the camera on it shows their video (`video`, the stage's LiveKit `VideoTrack`, covering the tile and mirrored for
 * yourself); with it off, their face (64px, 40px in the strip) centred, with a 2px ring in their assistant's colour.
 * Bottom left, their name ("You" for yourself) on a translucent chip with a 3px bar in their assistant's colour, and a
 * crossed-out microphone when they are muted; top right, the connection's three bars. While they speak the tile carries a
 * 2px orange outline (live), still under reduced motion. Its accessible name says it all: "Ada, microphone off, camera off,
 * speaking". A tile never shows anyone's notes choice (only Brenda's banner and note-taker tile speak of notes).
 *
 * Presentational only: no LiveKit import, so the design gallery draws every state; the stage feeds it.
 */
import { MicOff, MonitorUp } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { AssistantProfile } from "@/lib/assistant-look";
import { CALL_WORDS } from "@/lib/calls";
import { assistantRingColour, qualityBars, tileLabel } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

export type CallTileProps = {
  name: string;
  you?: boolean;
  profileId: string;
  avatarKey?: string | null;
  assistant?: Pick<AssistantProfile, "colour"> | null;
  micOn: boolean;
  cameraOn: boolean;
  speaking?: boolean;
  /** Their screen share is on (the share itself takes the main area). */
  sharing?: boolean;
  quality?: string | null;
  /** The video element when the camera is on (or the screen, for a share tile). */
  video?: React.ReactNode;
  /** `strip`: the small tiles beside a screen share. */
  compact?: boolean;
  className?: string;
};

/** Three bars, lit by the connection's quality, with words for screen readers. */
export function QualityBars({ quality, className }: { quality: string | null | undefined; className?: string }) {
  const q = qualityBars(quality);
  return (
    <span role="img" aria-label={q.words} className={cn("inline-flex h-3 items-end gap-0.5", className)}>
      {[1, 2, 3].map((i) => <span key={i} className={cn("w-[3px] rounded-full", i <= q.lit ? (q.lit === 1 ? "bg-warning" : "bg-foreground") : "bg-faint")} style={{ height: 4 + i * 2.5 }} />)}
    </span>
  );
}

export function CallTile({ name, you = false, profileId, avatarKey, assistant, micOn, cameraOn, speaking = false, sharing = false, quality, video, compact = false, className }: CallTileProps) {
  const ring = assistantRingColour(assistant);
  const shown = you ? CALL_WORDS.history.you : name;
  return (
    <figure role="group" aria-label={tileLabel({ name, you, micOn, cameraOn, speaking, sharing })}
      className={cn("relative isolate m-0 grid min-h-0 place-items-center overflow-hidden rounded-2xl bg-fill-1", speaking && "outline-2 outline-offset-0 outline-accent", compact ? "aspect-video" : "h-full w-full", className)}>
      {cameraOn && video ? <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">{video}</div>
        : <Avatar profileId={profileId} name={name} avatarKey={avatarKey ?? null} size={compact ? 40 : 64} ring={ring} />}
      <figcaption className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--background)_72%,transparent)] py-0.5 pl-0 pr-2 text-xs font-medium text-foreground">
        <span aria-hidden className="h-5 w-[3px] shrink-0" style={{ background: ring }} />
        <span className="truncate">{shown}</span>
        {sharing ? <MonitorUp aria-hidden className="size-3.5 shrink-0 text-secondary" /> : null}
        {!micOn ? <MicOff aria-hidden className="size-3.5 shrink-0 text-danger" /> : null}
      </figcaption>
      {quality !== undefined ? <QualityBars quality={quality} className="absolute right-2.5 top-2.5" /> : null}
    </figure>
  );
}
