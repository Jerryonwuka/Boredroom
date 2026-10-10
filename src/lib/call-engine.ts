/**
 * The call's media engine in the browser (owner decisions, 8 October 2026: phase 8, calls; video goes through LiveKit
 * Cloud). The ONE module that imports `livekit-client`: CallHost imports it dynamically the first time a call starts or
 * is joined (`await import("@/lib/call-engine")`), never at page load, so the overlay and the dock never pull the SDK into
 * every page. Client only.
 *
 * It owns one LiveKit `Room` per connection (adaptive stream, dynacast, simulcast, echo cancellation, noise suppression,
 * 720p camera), maps the room's events to a few typed callbacks, plays every remote voice through hidden audio elements
 * in a container the host owns (so sound carries on across pages), and exposes the published microphone track (the call's
 * own echo-cancelled track) for Brenda's notes runner. Disconnect reasons (LiveKit's numbers): 1 left, 2 replaced (the
 * same person joined from another tab or device), 4 removed, 5 and 10 room gone (the call ended), 14 timeout and 15
 * media failure ("Couldn't connect. Try again."). It never logs a token.
 */
import { DisconnectReason, isBrowserSupported, MediaDeviceFailure, Room, RoomEvent, Track, VideoPresets, type Participant, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import type { CallConnection } from "@/lib/calls";

export { Track };
export type { Room, Participant };

export type EngineState = "connecting" | "connected" | "reconnecting" | "disconnected";
/** Why the room went away, in the host's words. */
export type EngineEnd = "left" | "replaced" | "removed" | "ended" | "failed";
export type DeviceProblem = { kind: "mic" | "camera" | "screen"; failure: "blocked" | "none" | "in_use" | "other" | "unsupported" };

export type EngineEvents = {
  state: (s: EngineState) => void;
  ended: (why: EngineEnd, reason: number | null) => void;
  /** Something about the local tracks changed (mic, camera, screen, the mic track itself). */
  local: () => void;
  /** Someone joined or left (identity, name), for the polite live region. */
  people: (change: "joined" | "left", who: { identity: string; name: string }) => void;
  /** Whether the browser lets remote audio play yet (autoplay); false shows "Turn on sound". */
  audio: (canPlay: boolean) => void;
  device: (problem: DeviceProblem) => void;
};

/** The disconnect reasons (LiveKit's `DisconnectReason`) as the host reads them. Pure, unit-tested via the host. */
export function endOf(reason: number | null | undefined): EngineEnd {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED: return "left";
    case DisconnectReason.DUPLICATE_IDENTITY: return "replaced";
    case DisconnectReason.PARTICIPANT_REMOVED: return "removed";
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED: return "ended";
    default: return "failed";
  }
}

function failureOf(err: unknown): DeviceProblem["failure"] {
  switch (MediaDeviceFailure.getFailure(err)) {
    case MediaDeviceFailure.PermissionDenied: return "blocked";
    case MediaDeviceFailure.NotFound: return "none";
    case MediaDeviceFailure.DeviceInUse: return "in_use";
    default: return "other";
  }
}

export function browserSupported(): boolean {
  try { return isBrowserSupported(); } catch { return false; }
}
export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export class CallEngine {
  readonly room: Room;
  private readonly sink: HTMLElement;
  private readonly on: EngineEvents;
  private readonly audioEls = new Map<string, HTMLMediaElement>();
  private leaving = false;

  constructor(events: EngineEvents, audioSink: HTMLElement) {
    this.on = events;
    this.sink = audioSink;
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // A closed tab drops its media at once; a reload does not leave the call (the 45-second rule decides, D5).
      disconnectOnPageLeave: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: { simulcast: true },
    });
    const r = this.room;
    r.on(RoomEvent.Connected, () => this.on.state("connected"));
    r.on(RoomEvent.Reconnecting, () => this.on.state("reconnecting"));
    r.on(RoomEvent.SignalReconnecting, () => this.on.state("reconnecting"));
    r.on(RoomEvent.Reconnected, () => this.on.state("connected"));
    r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      this.detachAll();
      this.on.state("disconnected");
      this.on.ended(this.leaving ? "left" : endOf(reason ?? null), reason ?? null);
    });
    r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.on.people("joined", who(p)));
    r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => this.on.people("left", who(p)));
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.dataset.callAudio = pub.trackSid;
      this.sink.appendChild(el);
      this.audioEls.set(pub.trackSid, el);
    });
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Audio) return;
      track.detach().forEach((el) => el.remove());
      this.audioEls.get(pub.trackSid)?.remove();
      this.audioEls.delete(pub.trackSid);
    });
    const local = () => this.on.local();
    r.on(RoomEvent.LocalTrackPublished, local);
    r.on(RoomEvent.LocalTrackUnpublished, local);
    r.on(RoomEvent.TrackMuted, (_pub, p: Participant) => { if (p.isLocal) local(); });
    r.on(RoomEvent.TrackUnmuted, (_pub, p: Participant) => { if (p.isLocal) local(); });
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => this.on.audio(r.canPlaybackAudio));
    r.on(RoomEvent.MediaDevicesError, (err: Error, kind?: MediaDeviceKind) => {
      this.on.device({ kind: kind === "videoinput" ? "camera" : "mic", failure: failureOf(err) });
    });
  }

  /** Connects, then turns the microphone and camera on as chosen. A device that fails leaves the call receive-only. */
  async connect(conn: CallConnection, o: { mic: boolean; camera: boolean }): Promise<void> {
    this.on.state("connecting");
    try { await this.room.prepareConnection(conn.url, conn.token); } catch { /* only a head start */ }
    await this.room.connect(conn.url, conn.token, { autoSubscribe: true });
    // Autoplay: after a click (Join, Accept) this starts the sound; otherwise the host shows "Turn on sound".
    try { await this.room.startAudio(); } catch { /* blocked until a click */ }
    this.on.audio(this.room.canPlaybackAudio);
    if (o.mic) await this.setMic(true);
    if (o.camera) await this.setCamera(true);
    this.on.local();
  }

  async disconnect(): Promise<void> {
    this.leaving = true;
    try { await this.room.disconnect(true); } finally { this.detachAll(); }
  }

  get micOn() { return this.room.localParticipant.isMicrophoneEnabled; }
  get cameraOn() { return this.room.localParticipant.isCameraEnabled; }
  get sharing() { return this.room.localParticipant.isScreenShareEnabled; }
  get canPlayAudio() { return this.room.canPlaybackAudio; }

  /** The published microphone's track, or null while it is muted or not published (Brenda's notes runner, E.7). */
  get micTrack(): MediaStreamTrack | null {
    const pub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub || pub.isMuted || !pub.track) return null;
    return pub.track.mediaStreamTrack ?? null;
  }

  async setMic(on: boolean): Promise<boolean> {
    try { await this.room.localParticipant.setMicrophoneEnabled(on); return true; }
    catch (err) { this.on.device({ kind: "mic", failure: failureOf(err) }); return false; }
    finally { this.on.local(); }
  }
  async setCamera(on: boolean): Promise<boolean> {
    try { await this.room.localParticipant.setCameraEnabled(on); return true; }
    catch (err) { this.on.device({ kind: "camera", failure: failureOf(err) }); return false; }
    finally { this.on.local(); }
  }
  async setScreen(on: boolean): Promise<boolean> {
    if (on && !canShareScreen()) { this.on.device({ kind: "screen", failure: "unsupported" }); return false; }
    try {
      await this.room.localParticipant.setScreenShareEnabled(on, on ? { audio: true, selfBrowserSurface: "exclude", surfaceSwitching: "include", systemAudio: "include" } : undefined);
      return true;
    } catch (err) {
      // Pressing Cancel in the browser's picker is not a problem worth a message.
      if (err instanceof Error && err.name === "NotAllowedError" && /permission denied by user|cancel/i.test(err.message)) return false;
      this.on.device({ kind: "screen", failure: failureOf(err) });
      return false;
    } finally { this.on.local(); }
  }
  async startAudio(): Promise<void> {
    try { await this.room.startAudio(); } finally { this.on.audio(this.room.canPlaybackAudio); }
  }

  private detachAll() {
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
  }
}

function who(p: Participant) {
  return { identity: p.identity, name: p.name || "Someone" };
}

/** The participant metadata the server put in the token (contract C.1), or null when it cannot be read. */
export function tokenMetadataOf(p: Participant): { name: string; profileId: string; avatarKey: string | null; assistant: { name: string; colour: string; visor: string; eyes: string } } | null {
  try {
    const m = JSON.parse(p.metadata || "null") as { v?: number; name?: string; profileId?: string; avatarKey?: string | null; assistant?: { name: string; colour: string; visor: string; eyes: string } } | null;
    return m && m.v === 1 && typeof m.name === "string" && typeof m.profileId === "string" && m.assistant ? { name: m.name, profileId: m.profileId, avatarKey: m.avatarKey ?? null, assistant: m.assistant } : null;
  } catch { return null; }
}
