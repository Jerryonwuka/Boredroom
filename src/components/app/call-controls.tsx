"use client";

/**
 * The call's controls (owner decisions, 8 October 2026: phase 8, calls; contract D.6): round 44px buttons in a bar at
 * the bottom of the stage (fixed above the safe area on a phone): Microphone, Camera, Share screen (hidden where the
 * browser cannot share a screen; on every plan for now, owner decision 4), the slot for Brenda's notes toggle
 * (brenda_notes' `CallNotesToggle`), People, and Leave in red (status red, never orange). A group call's starter gets a
 * menu on Leave: "Leave" or "End for everyone" (a confirm: "Everyone is disconnected."). Device problems ("Your browser
 * blocked the microphone. You can still listen.") show above the bar.
 *
 * Toggles, one model everywhere (fix review, 10 October 2026: the camera's `aria-pressed` meant the opposite of the
 * microphone's, and sharing looked like the focus ring): each keeps one name for the state a press turns on, pressed
 * while it is on, and a pressed toggle is drawn inverted (white; the microphone, camera and screen also change their
 * icon), so the state never rests on a hue: "Mute" (pressed while muted), "Camera off" (pressed while the camera is off), "Share screen" (pressed
 * while sharing), and Brenda's notes toggle (pressed while notes are on). The tooltip says what a press does. The
 * pre-join panel's microphone and camera use the same names. `callToggleClass` is the look, for the notes toggle too.
 *
 * Presentational: the stage passes the host's state and actions in.
 */
import { useState } from "react";
import { ChevronUp, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Users, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm";
import { CALL_WORDS } from "@/lib/calls";
import { cn } from "@/lib/utils";

const ROUND = "size-11 rounded-full bg-fill-1 text-foreground hover:bg-fill-150 pointer-coarse:size-11 [&_svg]:size-[18px]";
const PRESSED = "bg-foreground text-background hover:bg-foreground/90 hover:text-background";
/** A round 44px call toggle's look: fill-1, inverted (white) while pressed. */
export const callToggleClass = (pressed: boolean) => cn(ROUND, pressed && PRESSED);

export type CallControlsProps = {
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** The browser can share a screen (`navigator.mediaDevices.getDisplayMedia`). */
  canShare: boolean;
  onMic: () => void;
  onCamera: () => void;
  onScreen: () => void;
  onPeople: () => void;
  peopleCount: number;
  /** One-to-one: Leave ends it. A group call's starter: Leave or End for everyone. */
  canEnd: boolean;
  onLeave: () => void;
  onEnd: () => Promise<unknown>;
  notes?: React.ReactNode;
  problem?: string | null;
  disabled?: boolean;
  className?: string;
};

export function CallControls({ micOn, cameraOn, sharing, canShare, onMic, onCamera, onScreen, onPeople, peopleCount, canEnd, onLeave, onEnd, notes, problem, disabled = false, className }: CallControlsProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (
    <div className={cn("grid gap-2", className)}>
      {problem ? <p role="alert" className="mx-auto max-w-md rounded-xl bg-fill-1 px-3 py-1.5 text-center text-meta font-normal text-foreground">{problem}</p> : null}
      <div role="toolbar" aria-label={CALL_WORDS.controls.label} className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        <IconButton variant="round" className={callToggleClass(!micOn)} aria-label={CALL_WORDS.mic.mute} data-tip={micOn ? CALL_WORDS.mic.mute : CALL_WORDS.mic.unmute} aria-pressed={!micOn} onClick={onMic} disabled={disabled}>
          {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </IconButton>
        <IconButton variant="round" className={callToggleClass(!cameraOn)} aria-label={CALL_WORDS.camera.toggle} data-tip={cameraOn ? CALL_WORDS.camera.off : CALL_WORDS.camera.on} aria-pressed={!cameraOn} onClick={onCamera} disabled={disabled}>
          {cameraOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
        </IconButton>
        {canShare ? (
          <IconButton variant="round" className={callToggleClass(sharing)} aria-label={CALL_WORDS.screen.start} data-tip={sharing ? CALL_WORDS.screen.stop : CALL_WORDS.screen.start} aria-pressed={sharing} onClick={onScreen} disabled={disabled}>
            {sharing ? <MonitorX aria-hidden /> : <MonitorUp aria-hidden />}
          </IconButton>
        ) : null}
        {notes}
        <IconButton variant="round" className={cn(ROUND, "relative")} aria-label={CALL_WORDS.people.button(peopleCount)} onClick={onPeople}>
          <Users aria-hidden />
          <span aria-hidden className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-fill-150 px-1 text-2xs font-semibold tabular-nums text-foreground">{peopleCount}</span>
        </IconButton>
        {canEnd ? (
          <>
            <Menu label={CALL_WORDS.controls.leaveOrEnd} align="end" trigger={<Button variant="destructive" className="h-11 rounded-full px-4"><PhoneOff aria-hidden />{CALL_WORDS.leave}<ChevronUp aria-hidden /></Button>}>
              <MenuItem icon={<PhoneOff aria-hidden />} onSelect={onLeave}>{CALL_WORDS.leave}</MenuItem>
              <MenuItem icon={<PhoneOff aria-hidden />} tone="danger" onSelect={() => setConfirmEnd(true)}>{CALL_WORDS.endForEveryone}</MenuItem>
            </Menu>
            <ConfirmDialog open={confirmEnd} onClose={() => setConfirmEnd(false)} title={CALL_WORDS.controls.endConfirm} description={CALL_WORDS.controls.endBody} confirmLabel={CALL_WORDS.endForEveryone} onConfirm={onEnd} />
          </>
        ) : (
          <Button variant="destructive" className="h-11 rounded-full px-4" onClick={onLeave}><PhoneOff aria-hidden />{CALL_WORDS.leave}</Button>
        )}
      </div>
    </div>
  );
}
