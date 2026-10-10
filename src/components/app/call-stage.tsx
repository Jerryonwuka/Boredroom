"use client";

/**
 * The call's own page (owner decisions, 8 October 2026: phase 8, calls; contract D.6). Loaded on the client only
 * (`call-stage-loader.tsx`, `next/dynamic` with `ssr: false`), since it draws LiveKit's room through
 * `@livekit/components-react`'s hooks and unstyled pieces (D14: `useTracks`, `useParticipants`, `useIsSpeaking`,
 * `useIsMuted`, `useConnectionQualityIndicator`, `useMediaDeviceSelect`, `VideoTrack`, `RoomContext`; never its styled
 * prefabs nor its stylesheet; our look comes from src/components/ui).
 *
 * It keeps the call's view (GET /calls/:id again on the calls tables' change events, debounced 300 ms, and whenever the
 * host reads a newer one) and shows one of:
 * - Pre-join (this tab is not connected, the call is live and the person may join): who is in it, the microphone and
 *   camera choices (on and off by default), "Join call" (the screen's one orange), and "Join without microphone or
 *   camera" when the browser has none or blocked them (joining works receive-only). From the notch's Accept
 *   (`?from=notch`) the same panel, heartbeating meanwhile so the 90-second grace never drops the person.
 * - Another tab or device: "You joined this call from another tab or device." with "Join here instead".
 * - Outgoing (you started it, nobody has answered): the face of who you call and how each ring is going, and Cancel.
 * - Live: a header (back to the thread, the title, the clock in orange digits, the connection's bars, People), Brenda's
 *   notes banner (brenda_notes), the tiles (1 fills; 2 side by side, stacked on a phone; 3–4 two by two; 5–9 three by
 *   three; more, 9 a page), a screen share in the main area with the tiles in a strip, the note-taker tile while notes are
 *   on, the controls, and a polite live region for joins and leaves. From 5 minutes before the 4-hour cap, a quiet alert.
 * - Ended: who, when, how long and how it ended, Brenda's recap panel (brenda_notes), "Call again" and "Message". Someone
 *   who reads the thread but was not on the call sees only the summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Mic, MicOff, MonitorX, Phone, PhoneMissed, Settings2, Video, VideoOff, Volume2 } from "lucide-react";
import { RoomContext, VideoTrack, isTrackReference, useConnectionQualityIndicator, useIsMuted, useIsSpeaking, useMediaDeviceSelect, useParticipants, useTracks, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import { Alert, EmptyState } from "@/components/ui/states";
import { CallTile, QualityBars } from "@/components/app/call-tile";
import { CallControls, callToggleClass } from "@/components/app/call-controls";
import { CallButton } from "@/components/app/call-button";
import { useCallClock } from "@/components/app/call-dock";
import { useCall } from "@/components/app/call-host";
import { CallNotesBanner, CallNotesToggle, CallRecapPanel, NoteTakerTile } from "@/components/app/call-notes";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { Track, canShareScreen, tokenMetadataOf, type Participant, type Room } from "@/lib/call-engine";
import { CALL_LIMITS, CALL_WORDS, callClock, callDurationLabel, type CallParticipantView, type CallView } from "@/lib/calls";
import { NOTES_WORDS, type NotesAvailability } from "@/lib/call-notes";
import type { AssistantProfile } from "@/lib/assistant-look";
import { CALL_EVENT_TABLES, assistantRingColour, callErrorWords, callTitle, callWhen, callsApi, gridShape, otherCallOf, pageOf, skewOf } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

export type CallStageProps = {
  orgSlug: string;
  initial: CallView;
  availability: NotesAvailability;
  workspaceAssistant: AssistantProfile;
  from?: string | null;
  impersonated?: boolean;
  timeZone?: string;
};

const NARROW = "(max-width: 640px)";
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const LIVE = (s: string) => s === "connected" || s === "reconnecting" || s === "connecting";

export function CallStage({ orgSlug, initial, availability, workspaceAssistant, from = null, impersonated = false, timeZone }: CallStageProps) {
  const host = useCall();
  const calls = useMemo(() => callsApi(orgSlug), [orgSlug]);
  const [call, setCall] = useState<CallView>(initial);
  const callRef = useRef(call);
  useEffect(() => { callRef.current = call; }, [call]);
  const newer = useCallback((v: CallView) => { if (v.id === callRef.current.id && Date.parse(v.serverNow) >= Date.parse(callRef.current.serverNow)) setCall(v); }, []);

  // Refetch on the calls tables' events (debounced 300 ms).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const table = (e as CustomEvent<ChangeEvent>).detail?.table;
      if (!table || !CALL_EVENT_TABLES.has(table)) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; calls.view(callRef.current.id).then(({ call: v }) => newer(v), () => {}); }, 300);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { if (t) clearTimeout(t); window.removeEventListener(CHANGE_EVENT, onChange); };
  }, [calls, newer]);
  // The host's view of the call it is connected to (it refetches on joins, leaves and an `ended` heartbeat).
  const hostView = host?.view ?? null;
  useEffect(() => { if (hostView) newer(hostView); }, [hostView, newer]);
  const onChanged = useCallback((v: CallView) => { newer(v); host?.setView(v); }, [newer, host]);

  if (!host) return <EmptyState icon={PhoneMissed} title={CALL_WORDS.errors.notFound} />;
  const here = host.callId === call.id;
  const connectedHere = here && LIVE(host.state);
  const room = host.room as Room | null;

  if (call.state === "ended") return <EndedCall orgSlug={orgSlug} call={call} workspaceAssistant={workspaceAssistant} impersonated={impersonated} timeZone={timeZone} />;
  if (connectedHere && room) {
    return (
      <RoomContext.Provider value={room}>
        <LiveCall orgSlug={orgSlug} call={call} availability={availability} workspaceAssistant={workspaceAssistant} onChanged={onChanged} />
      </RoomContext.Provider>
    );
  }
  if (connectedHere) return <Connecting call={call} />;
  return <NotConnected orgSlug={orgSlug} call={call} from={from} onChanged={onChanged} />;
}

// ---- Not connected in this tab ----

function Connecting({ call }: { call: CallView }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" aria-busy>
      <Faces people={call.participants.filter((p) => p.inRoom)} size={48} />
      <p className="text-sm font-medium text-secondary" role="status">{CALL_WORDS.stage.connecting}</p>
    </div>
  );
}

/** Pre-join, another device, left, failed. */
function NotConnected({ orgSlug, call, from, onChanged }: { orgSlug: string; call: CallView; from: string | null; onChanged: (v: CallView) => void }) {
  const host = useCall()!;
  const here = host.callId === call.id;
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noDevices, setNoDevices] = useState(false);
  const fromNotch = from === "notch";
  const acceptedElsewhere = call.me.state === "joined";
  const otherDevice = !fromNotch && (here && host.state === "replaced" || (host.active?.id === call.id && acceptedElsewhere));

  // Accepted in the notch: keep the person in while they look at this panel (the 90-second connect grace).
  const holdPreJoin = host.holdPreJoin;
  useEffect(() => {
    if (!(fromNotch && acceptedElsewhere)) return;
    holdPreJoin(call.id);
    return () => holdPreJoin(null);
  }, [fromNotch, acceptedElsewhere, call.id, holdPreJoin]);

  // Whether the browser has (or allows) a microphone or camera at all: if not, joining receive-only is offered.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = (name: string) => navigator.permissions?.query({ name: name as PermissionName }).then((r) => r.state, () => "prompt");
        const [m, c] = await Promise.all([q("microphone"), q("camera")]);
        const devices = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
        const hasMic = devices.some((d) => d.kind === "audioinput"), hasCam = devices.some((d) => d.kind === "videoinput");
        if (!cancelled) setNoDevices((m === "denied" || !hasMic) && (c === "denied" || !hasCam));
      } catch { /* leave the choice as it is */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const join = async (o: { mic: boolean; camera: boolean; leaveOther?: boolean }) => {
    setBusy(true); setError(null);
    try { await host.join(call.id, { ...o, leaveOther: o.leaveOther ?? false }); }
    catch (err) {
      const other = otherCallOf(err);
      setError(other ? CALL_WORDS.stage.inAnotherCall(other.where?.name ?? "another call") : callErrorWords(err));
      callsApi(orgSlug).view(call.id).then(({ call: v }) => onChanged(v), () => {});
    } finally { setBusy(false); }
  };
  const leaveOther = !!call.me.elsewhere && call.me.elsewhere.callId !== call.id;
  // The screen's one orange is Join, unless another call is ringing: then its card's Accept is (fix review, 10 October
  // 2026: two orange buttons), and Join is white.
  const accent = host.ringing.some((r) => r.id !== call.id) ? "primary" : "accent";
  const joinButton = (label: string, o: { mic: boolean; camera: boolean }) => leaveOther ? (
    <ConfirmButton variant={accent} tone="primary" title={CALL_WORDS.stage.inAnotherCall(call.me.elsewhere?.where.name ?? "another call")} confirmLabel={label} onConfirm={() => join({ ...o, leaveOther: true })} loading={busy}>{label}</ConfirmButton>
  ) : <Button variant={accent} onClick={() => void join(o)} loading={busy}><Phone aria-hidden />{label}</Button>;

  const inRoom = call.participants.filter((p) => p.inRoom);
  const title = callTitle(call.where);
  const left = here && host.state === "ended";
  const failed = here && host.state === "failed";

  let body: React.ReactNode;
  if (otherDevice) {
    body = <><p className="text-sm font-normal text-secondary">{CALL_WORDS.stage.otherDevice}</p><div className="mt-5">{joinButton(CALL_WORDS.joinHere, { mic: true, camera: false })}</div></>;
  } else if (!call.me.canJoin) {
    body = <p className="text-sm font-normal text-secondary">{call.inRoom >= CALL_LIMITS.maxParticipants ? CALL_WORDS.stage.full : CALL_WORDS.errors.notFound}</p>;
  } else {
    body = (
      <>
        {left && host.error ? <p className="text-sm font-medium text-foreground" role="status">{host.error}</p> : null}
        {failed ? <Alert tone="danger" className="text-left">{host.error ?? CALL_WORDS.stage.couldNotConnect}</Alert> : null}
        {/* The same toggles as on the call (fix review, 10 October 2026): "Mute" pressed while muted, "Camera off" pressed
            while the camera is off, drawn inverted while pressed. */}
        <div className="mt-5 flex items-center justify-center gap-3" role="group" aria-label={CALL_WORDS.stage.beforeYouJoin}>
          <IconButton variant="round" className={callToggleClass(!mic)} aria-label={CALL_WORDS.mic.mute} data-tip={mic ? CALL_WORDS.mic.mute : CALL_WORDS.mic.unmute} aria-pressed={!mic} onClick={() => setMic((v) => !v)}>{mic ? <Mic aria-hidden /> : <MicOff aria-hidden />}</IconButton>
          <IconButton variant="round" className={callToggleClass(!camera)} aria-label={CALL_WORDS.camera.toggle} data-tip={camera ? CALL_WORDS.camera.off : CALL_WORDS.camera.on} aria-pressed={!camera} onClick={() => setCamera((v) => !v)}>{camera ? <Video aria-hidden /> : <VideoOff aria-hidden />}</IconButton>
        </div>
        <div className="mt-5 flex flex-col items-center gap-2">
          {joinButton(left || failed ? CALL_WORDS.stage.rejoin : CALL_WORDS.joinCall, { mic, camera })}
          {noDevices ? <Button variant="ghost" size="sm" onClick={() => void join({ mic: false, camera: false })} disabled={busy}>{CALL_WORDS.stage.noDevices}</Button> : null}
        </div>
      </>
    );
  }
  // A column, so Back sits at the top left while the rest is centred (fix review, 10 October 2026).
  return (
    <div className="flex flex-1 items-center justify-center p-5">
      <section aria-labelledby="call-prejoin-title" className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-border bg-fill-0 p-6 text-center">
        {call.where.href ? <Link href={call.where.href} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-ml-2 mb-3 self-start")}><ArrowLeft aria-hidden />{CALL_WORDS.stage.back}</Link> : null}
        <Faces people={inRoom.length ? inRoom : [call.startedBy]} size={48} />
        <h1 id="call-prejoin-title" className="type-section-title mb-0 mt-4">{title}</h1>
        <p className="mt-1 text-meta font-normal text-secondary">{CALL_WORDS.stage.inIt(inRoom)}</p>
        <div className="mt-4 w-full">{body}</div>
        {error ? <p role="alert" className="mt-3 w-full text-meta font-normal text-danger">{error}</p> : null}
      </section>
    </div>
  );
}

// ---- Live ----

type Who = { membershipId: string; name: string; profileId: string; avatarKey: string | null; assistant: Pick<AssistantProfile, "colour"> | null };

function whoOf(p: Participant, call: CallView): Who {
  const v = call.participants.find((x) => x.membershipId === p.identity);
  if (v) return { membershipId: v.membershipId, name: v.name, profileId: v.profileId, avatarKey: v.avatarKey, assistant: v.assistant };
  const m = tokenMetadataOf(p);
  return { membershipId: p.identity, name: m?.name ?? (p.name || "Someone"), profileId: m?.profileId ?? p.identity, avatarKey: m?.avatarKey ?? null, assistant: m ? { colour: m.assistant.colour as AssistantProfile["colour"] } : null };
}

function LiveCall({ orgSlug, call, availability, workspaceAssistant, onChanged }: { orgSlug: string; call: CallView; availability: NotesAvailability; workspaceAssistant: AssistantProfile; onChanged: (v: CallView) => void }) {
  const host = useCall()!;
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [page, setPage] = useState(0);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const participants = useParticipants();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const shares = useTracks([Track.Source.ScreenShare]);
  const share = shares.find(isTrackReference) ?? null;
  const seconds = useCallClock(call.answeredAt, call.serverNow);
  const local = participants.find((p) => p.isLocal);
  const { quality } = useConnectionQualityIndicator({ participant: local });
  const slot = { orgSlug, call, availability, workspaceAssistant, onChanged };

  // Joins and leaves, announced politely (never yourself).
  const [announce, setAnnounce] = useState("");
  const [seenPeople, setSeenPeople] = useState(call.participants);
  if (seenPeople !== call.participants) {
    const inRoom = (list: CallParticipantView[]) => new Map(list.filter((p) => p.inRoom && !p.you).map((p) => [p.membershipId, p.name]));
    const before = inRoom(seenPeople), nowIn = inRoom(call.participants);
    const words: string[] = [];
    for (const [id, name] of nowIn) if (!before.has(id)) words.push(CALL_WORDS.stage.joined(name));
    for (const [id, name] of before) if (!nowIn.has(id)) words.push(CALL_WORDS.stage.left(name));
    setSeenPeople(call.participants);
    if (words.length) setAnnounce(words.join(". "));
  }

  // The 4-hour cap: a quiet alert from 5 minutes before.
  const [capSoon, setCapSoon] = useState(false);
  useEffect(() => {
    const skew = skewOf(call.serverNow, Date.now());
    const at = Date.parse(call.endsAt) - CALL_LIMITS.capWarningMs - skew - Date.now();
    const t = setTimeout(() => setCapSoon(true), Math.max(0, Math.min(at, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [call.endsAt, call.serverNow]);

  const outgoing = call.state === "ringing" && call.me.role === "caller";
  const tiles: React.ReactNode[] = cameras.map((ref) => <LiveTile key={ref.participant.identity} trackRef={ref} who={whoOf(ref.participant, call)} compact={!!share} />);
  // The note-taker fills its grid cell like a person's tile, or takes the strip's 16:9 beside a share (fix review,
  // 10 October 2026: it kept its own 16:9 in the grid).
  const noteTaker = call.notes.state === "on" ? <NoteTakerTile key="note-taker" {...slot} /> : null;
  if (noteTaker) tiles.push(<div key="note-taker" className={cn("min-h-0 min-w-0", share ? "aspect-video" : "h-full")}>{noteTaker}</div>);
  const shape = gridShape(tiles.length, narrow);
  const paged = pageOf(tiles, page, shape.perPage);
  const peopleCount = call.inRoom || participants.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        {call.where.href ? <Link href={call.where.href} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={CALL_WORDS.stage.backToThread}><ArrowLeft aria-hidden /></Link> : null}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{callTitle(call.where)}</h1>
        {host.state === "reconnecting" ? <span className="text-xs font-medium text-warning" role="status">{CALL_WORDS.stage.reconnecting}</span> : null}
        {seconds !== null ? <span className="font-mono text-sm tabular-nums text-accent-text" aria-label={CALL_WORDS.stage.callTime(callClock(seconds))}>{callClock(seconds)}</span> : null}
        <QualityBars quality={quality} className="mx-1" />
        <DeviceMenu />
      </header>
      <div className="grid shrink-0 gap-2 px-3 pt-3 empty:hidden md:px-5">
        <CallNotesBanner {...slot} />
        {capSoon ? <Alert tone="warning">{CALL_WORDS.stage.capSoon}</Alert> : null}
        {!host.canPlayAudio ? <div className="flex justify-center"><Button variant="secondary" size="sm" onClick={() => void host.startAudio()}><Volume2 aria-hidden />{CALL_WORDS.stage.startAudio}</Button></div> : null}
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-5">
        {outgoing ? <Outgoing call={call} orgSlug={orgSlug} /> : share ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
            <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-2xl bg-fill-1">
              {share.participant.isLocal ? (
                <div className="grid place-items-center gap-3 p-6 text-center">
                  <p className="text-sm font-medium text-foreground">{CALL_WORDS.screen.you}</p>
                  <Button variant="secondary" size="sm" onClick={() => void host.toggleScreen()}><MonitorX aria-hidden />{CALL_WORDS.screen.stop}</Button>
                </div>
              ) : (
                <>
                  <VideoTrack trackRef={share} className="h-full w-full object-contain" />
                  <p className="absolute bottom-2 left-2 rounded-lg bg-[color-mix(in_srgb,var(--background)_72%,transparent)] px-2 py-0.5 text-xs font-medium text-foreground">{CALL_WORDS.screen.sharing(whoOf(share.participant, call).name)}</p>
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden [&>*]:w-40 [&>*]:shrink-0 lg:[&>*]:w-full" aria-label={CALL_WORDS.stage.peopleOnCall}>{tiles}</div>
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }} aria-label={CALL_WORDS.stage.peopleOnCall}>{paged.items}</div>
            {paged.pages > 1 ? (
              <div className="flex items-center justify-center gap-2">
                <IconButton aria-label={CALL_WORDS.stage.previousPeople} onClick={() => setPage(paged.page - 1)} disabled={paged.page === 0}><ChevronLeft aria-hidden /></IconButton>
                <span className="text-xs font-medium tabular-nums text-secondary">{CALL_WORDS.stage.pageOf(paged.page + 1, paged.pages)}</span>
                <IconButton aria-label={CALL_WORDS.stage.nextPeople} onClick={() => setPage(paged.page + 1)} disabled={paged.page >= paged.pages - 1}><ChevronRight aria-hidden /></IconButton>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="sticky bottom-0 shrink-0 border-t border-border bg-background px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <CallControls micOn={host.micOn} cameraOn={host.cameraOn} sharing={host.sharing} canShare={canShareScreen()}
          onMic={() => void host.toggleMic()} onCamera={() => void host.toggleCamera()} onScreen={() => void host.toggleScreen()}
          onPeople={() => setPeopleOpen(true)} peopleCount={peopleCount}
          canEnd={call.kind === "group" && call.me.canEnd} onLeave={() => void host.leave()} onEnd={() => host.end()}
          notes={<CallNotesToggle {...slot} />} problem={host.deviceProblem} />
      </div>
      <PeopleSheet open={peopleOpen} onClose={() => setPeopleOpen(false)} call={call} />
    </div>
  );
}

/** One live tile: the camera (or the face), muted, speaking and the connection, from LiveKit's own state. */
function LiveTile({ trackRef, who, compact }: { trackRef: TrackReferenceOrPlaceholder; who: Who; compact: boolean }) {
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const { quality } = useConnectionQualityIndicator({ participant: p });
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const camMuted = useIsMuted(trackRef);
  const cameraOn = isTrackReference(trackRef) && !camMuted;
  const micOn = !micMuted && !!p.getTrackPublication(Track.Source.Microphone);
  return (
    <CallTile name={who.name} you={p.isLocal} profileId={who.profileId} avatarKey={who.avatarKey} assistant={who.assistant} micOn={micOn} cameraOn={cameraOn}
      speaking={speaking} sharing={p.isScreenShareEnabled} quality={quality} compact={compact}
      video={isTrackReference(trackRef) ? <VideoTrack trackRef={trackRef} style={p.isLocal ? { transform: "scaleX(-1)" } : undefined} /> : null} />
  );
}

/** The microphone and camera in use, once the browser has allowed them. */
function DeviceMenu() {
  const mics = useMediaDeviceSelect({ kind: "audioinput" });
  const cams = useMediaDeviceSelect({ kind: "videoinput" });
  const named = (d: MediaDeviceInfo[]) => d.filter((x) => x.label);
  if (!named(mics.devices).length && !named(cams.devices).length) return null;
  return (
    <Menu label={CALL_WORDS.stage.deviceMenu} align="end" trigger={<IconButton aria-label={CALL_WORDS.stage.deviceMenu}><Settings2 aria-hidden /></IconButton>}>
      {named(mics.devices).length ? <MenuLabel>{CALL_WORDS.stage.microphone}</MenuLabel> : null}
      {named(mics.devices).map((d) => <MenuItem key={`m-${d.deviceId}`} checked={d.deviceId === mics.activeDeviceId} onSelect={() => void mics.setActiveMediaDevice(d.deviceId)}>{d.label}</MenuItem>)}
      {named(mics.devices).length && named(cams.devices).length ? <MenuSeparator /> : null}
      {named(cams.devices).length ? <MenuLabel>{CALL_WORDS.stage.camera}</MenuLabel> : null}
      {named(cams.devices).map((d) => <MenuItem key={`c-${d.deviceId}`} checked={d.deviceId === cams.activeDeviceId} onSelect={() => void cams.setActiveMediaDevice(d.deviceId)}>{d.label}</MenuItem>)}
    </Menu>
  );
}

/** You started it and nobody has answered yet: who you are calling and how each ring is going; Cancel leaves. */
function Outgoing({ call, orgSlug }: { call: CallView; orgSlug: string }) {
  const host = useCall()!;
  const others = call.participants.filter((p) => !p.you);
  const rung = others.filter((p) => p.role === "invitee");
  const lineOf = (p: CallParticipantView) => {
    switch (p.state) {
      case "ringing": return call.kind === "direct" ? CALL_WORDS.outgoing.ringing(p.name) : null;
      case "declined": return CALL_WORDS.outgoing.declined(p.name);
      case "missed": return CALL_WORDS.outgoing.noAnswer(p.name);
      case "invited": return CALL_WORDS.outgoing.notRung(p.name);
      default: return null;
    }
  };
  const lines = rung.map((p) => ({ p, line: lineOf(p) })).filter((x) => x.line);
  void orgSlug;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status" aria-live="polite">
      <Faces people={rung.length ? rung : others} size={64} pulse />
      <p className="text-base font-semibold text-foreground">
        {call.kind === "group" ? (rung.length === 0 ? CALL_WORDS.outgoing.nobodyRung : CALL_WORDS.outgoing.ringingGroup(call.where.name ?? "the channel")) : rung[0] ? CALL_WORDS.outgoing.ringing(rung[0].name) : CALL_WORDS.stage.waiting}
      </p>
      {lines.length && (call.kind === "group" || lines[0].p.state !== "ringing") ? (
        <ul className="grid gap-1 text-meta font-normal text-secondary">
          {lines.filter((x) => call.kind === "group" ? x.p.state !== "ringing" : true).map(({ p, line }) => (
            <li key={p.membershipId}>{line}{p.state === "declined" && call.where.href ? <> <Link className="link-inline" href={call.where.kind === "direct" ? call.where.href : `/app/${orgSlug}/messages?to=${p.membershipId}`}>{CALL_WORDS.message}</Link></> : null}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="secondary" onClick={() => void host.leave()}>{CALL_WORDS.stage.cancel}</Button>
    </div>
  );
}

/** Everyone on the call: in the room, ringing, declined, missed; notes only as "Included" for a yes. */
function PeopleSheet({ open, onClose, call }: { open: boolean; onClose: () => void; call: CallView }) {
  const STATE = CALL_WORDS.people.states;
  return (
    <Sheet open={open} onClose={onClose} title={CALL_WORDS.people.title} description={CALL_WORDS.people.inCall(call.inRoom)} size="sm">
      <ul className="-mx-2 grid gap-0.5">
        {call.participants.map((p) => (
          <li key={p.membershipId} className="flex min-h-11 items-center gap-2.5 px-2 py-1.5">
            <Avatar profileId={p.profileId} name={p.name} avatarKey={p.avatarKey} size={28} ring={assistantRingColour(p.assistant)} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.name}{p.you ? <span className="font-normal text-secondary"> {CALL_WORDS.people.you}</span> : null}</span><span className="block truncate text-xs font-medium text-subtle">{p.inRoom ? STATE.joined : STATE[p.state] ?? p.state}</span></span>
            {p.consent === "yes" ? <Badge size="sm">{CALL_WORDS.people.included}</Badge> : null}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Up to four faces, overlapping, each with their assistant's ring. */
function Faces({ people, size, pulse = false }: { people: { membershipId: string; name: string; profileId: string; avatarKey: string | null; assistant: Pick<AssistantProfile, "colour"> }[]; size: number; pulse?: boolean }) {
  const shown = people.slice(0, 4);
  return (
    <span className="inline-flex items-center" aria-hidden>
      {shown.map((p, i) => (
        <span key={p.membershipId} className={cn("relative inline-flex rounded-full", i > 0 && "-ml-2")} style={{ zIndex: shown.length - i }}>
          {pulse ? <span className="avatar-ping absolute -inset-1 rounded-full border-2 motion-reduce:hidden" style={{ borderColor: assistantRingColour(p.assistant) }} /> : null}
          <Avatar profileId={p.profileId} name={p.name} avatarKey={p.avatarKey} size={size} ring={assistantRingColour(p.assistant)} className="ring-2 ring-background" />
        </span>
      ))}
      {people.length > 4 ? <span className="ml-2 text-xs font-medium tabular-nums text-secondary">+{people.length - 4}</span> : null}
    </span>
  );
}

// ---- Ended ----

const END_WORDS = CALL_WORDS.stage.endReasons;

function EndedCall({ orgSlug, call, workspaceAssistant, impersonated, timeZone }: { orgSlug: string; call: CallView; workspaceAssistant: AssistantProfile; impersonated: boolean; timeZone?: string }) {
  const host = useCall();
  const joined = call.participants.filter((p) => p.firstJoinedAt);
  const other = call.kind === "direct" ? call.participants.find((p) => !p.you) ?? null : null;
  const reason = call.endReason ?? "completed";
  const outcome = other && call.me.role === "caller" && reason === "declined" ? CALL_WORDS.outgoing.declined(other.name)
    : other && call.me.role === "caller" && reason === "missed" ? CALL_WORDS.outgoing.noAnswer(other.name)
      : call.me.state === "missed" ? CALL_WORDS.thread.missed(call.startedBy.name) : END_WORDS[reason] ?? CALL_WORDS.stage.ended;
  const participant = call.me.access === "participant";
  const target = call.kind === "direct" ? (other ? { kind: "person" as const, membershipId: other.membershipId, name: other.name } : null) : { kind: "conversation" as const, conversationId: call.where.conversationId, label: call.where.name ?? "the channel" };
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <section aria-labelledby="call-ended-title" className="rounded-3xl border border-border bg-fill-0 p-6">
          {call.where.href ? <Link href={call.where.href} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-ml-2 mb-3")}><ArrowLeft aria-hidden />{CALL_WORDS.stage.back}</Link> : null}
          <div className="flex flex-wrap items-center gap-4">
            <Faces people={joined.length ? joined : [call.startedBy]} size={40} />
            <div className="min-w-0 flex-1">
              <h1 id="call-ended-title" className="type-section-title mb-0">{callTitle(call.where)}</h1>
              <p className="text-meta font-normal text-secondary">{[callWhen(call.startedAt, new Date(), timeZone), call.durationSeconds !== null ? callDurationLabel(call.durationSeconds) : null, joined.length > 1 ? CALL_WORDS.stage.peopleCount(joined.length) : null].filter(Boolean).join(", ")}</p>
            </div>
            <Badge tone={reason === "missed" && call.me.state === "missed" ? "danger" : "neutral"}>{outcome}</Badge>
          </div>
          {joined.length ? <p className="mt-4 text-meta font-normal text-secondary">{CALL_WORDS.stage.onTheCall(joined.map((p) => (p.you ? CALL_WORDS.stage.you : p.name)))}</p> : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {target && host ? <CallButton orgSlug={orgSlug} target={target} live={null} available={host.available} variant="primary" label={other && call.me.state === "missed" ? CALL_WORDS.callBack : CALL_WORDS.callAgain} /> : null}
            {call.where.href ? <Link href={call.where.href} className={buttonVariants({ variant: "secondary" })}>{CALL_WORDS.message}</Link> : null}
          </div>
        </section>
        {participant ? <CallRecapPanel orgSlug={orgSlug} callId={call.id} recapState={call.notes.recap} wasOn={!!call.participants.find((p) => p.you)?.firstJoinedAt} impersonated={impersonated} workspaceAssistant={workspaceAssistant} />
          : <p className="text-meta font-normal text-secondary">{NOTES_WORDS.recap.onlyParticipants}</p>}
      </div>
    </div>
  );
}

export default CallStage;
