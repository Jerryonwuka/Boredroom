"use client";

/**
 * DEVELOPMENT ONLY (owner decisions, 8 October 2026: phase 8, calls; contract D.12): the call stage against a real
 * LiveKit Cloud room before migration 0054 is applied anywhere. 404 in production. It provides its own calls host
 * (`CallContext`) built on the real engine (`call-engine.ts`): Join fetches a token from /api/dev/call-token (a
 * `dev-<12 hex>` room, the signed-in person as `dev-<profile id>`) and connects; the server's steps (heartbeats, leave,
 * end) are no-ops. The stage, tiles and controls are the real ones, drawn from a call view made up from the room's
 * participants. "Simulate an incoming call" shows the incoming-call card with a made-up ring, and the dock shows while
 * connected (this page is not the call's own page). A scratch participant (@livekit/rtc-node, in the scratchpad) can
 * join the same room by its name; delete the room afterwards. Nothing here touches the database.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CallContext, type CallHostValue } from "@/components/app/call-host";
import { CallStageLoader } from "@/components/app/call-stage-loader";
import { IncomingCall } from "@/components/app/incoming-call";
import { CallDock } from "@/components/app/call-dock";
import { api } from "@/lib/api-client";
import { DEFAULT_ASSISTANT, PALETTE } from "@/lib/assistant-look";
import { CALL_LIMITS, type CallConnection, type CallParticipantView, type CallPerson, type CallView, type RingingCall } from "@/lib/calls";
import type { CallEngine } from "@/lib/call-engine";

type Token = { room: string; connection: CallConnection; profileId: string; name: string; avatarKey: string | null };
const DEV_CALL = "00000000-0000-4000-8000-000000000de0";
const ROOM = /^dev-[0-9a-f]{12}$/;

function person(identity: string, name: string, profileId: string, avatarKey: string | null = null): CallPerson {
  return { membershipId: identity, name, firstName: name.split(/\s+/)[0] || name, profileId, avatarKey, assistant: { ...DEFAULT_ASSISTANT, face: PALETTE.white.face } };
}

/** A call view made up from the room's participants (the stage draws tiles from LiveKit; this only names them). */
function fakeView(e: CallEngine | null, me: Token | null, startedAt: string, connected: boolean): CallView {
  const now = new Date().toISOString();
  const self = me ? person(me.connection.identity, me.name, me.profileId, me.avatarKey) : person("dev-me", "You", "dev-me");
  const others = e ? [...e.room.remoteParticipants.values()].map((p) => {
    let m: { name?: string; profileId?: string } = {};
    try { m = JSON.parse(p.metadata || "{}"); } catch { /* a test participant without metadata */ }
    return person(p.identity, m.name ?? p.name ?? p.identity, m.profileId ?? p.identity);
  }) : [];
  const row = (p: CallPerson, you: boolean): CallParticipantView => ({ ...p, role: you ? "caller" : "joiner", state: "joined", you, inRoom: true, rangAt: null, firstJoinedAt: startedAt, joinedAt: startedAt, leftAt: null, consent: null });
  const participants = [...(connected ? [row(self, true)] : []), ...others.map((p) => row(p, false))];
  return {
    id: DEV_CALL, kind: "group", state: "active", where: { conversationId: "00000000-0000-4000-8000-000000000000", kind: "channel", name: "#Dev room", href: null }, room: me?.room ?? "dev",
    startedBy: self, startedAt, answeredAt: startedAt, endedAt: null, endReason: null, durationSeconds: null,
    endsAt: new Date(Date.parse(startedAt) + CALL_LIMITS.maxCallMs).toISOString(), participants, inRoom: participants.length,
    me: { membershipId: self.membershipId, state: connected ? "joined" : null, role: "caller", access: "participant", canJoin: true, canDecline: false, canLeave: true, canEnd: false, elsewhere: null },
    notes: { state: "off", everOn: false, onBy: null, onAt: null, offAt: null, myConsent: null, included: [], pendingCount: 0, recap: "none" },
    serverNow: now,
  };
}

export default function DevCallsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}

function Harness() {
  const engine = useRef<CallEngine | null>(null);
  const sink = useRef<HTMLDivElement>(null);
  const [roomName, setRoomName] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [state, setState] = useState<CallHostValue["state"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState({ micOn: false, cameraOn: false, sharing: false, canPlayAudio: true, micTrack: null as MediaStreamTrack | null, problem: null as string | null });
  const [room, setRoom] = useState<unknown>(null);
  const [startedAt] = useState(() => new Date().toISOString());
  const [view, setView] = useState<CallView>(() => fakeView(null, null, startedAt, false));
  const [ringing, setRinging] = useState<RingingCall[]>([]);
  const [silenced, setSilenced] = useState<ReadonlySet<string>>(() => new Set());

  const rebuild = useCallback(() => {
    const e = engine.current;
    setView(fakeView(e, token, startedAt, !!e && e.room.state === "connected"));
    if (e) setLocal((l) => ({ ...l, micOn: e.micOn, cameraOn: e.cameraOn, sharing: e.sharing, micTrack: e.micTrack }));
  }, [token, startedAt]);
  useEffect(() => { const t = setInterval(rebuild, 2000); return () => clearInterval(t); }, [rebuild]);

  const join = useCallback(async (_id: string, o: { mic?: boolean; camera?: boolean } = {}) => {
    setError(null);
    const q = ROOM.test(roomName) ? `?room=${roomName}` : "";
    const t = await api<Token>(`/api/dev/call-token${q}`);
    setToken(t); setRoomName(t.room);
    const mod = await import("@/lib/call-engine");
    await engine.current?.disconnect().catch(() => {});
    const e = new mod.CallEngine({
      state: (s) => setState(s === "disconnected" ? "ended" : s),
      ended: (why) => { setState(why === "replaced" ? "replaced" : why === "failed" ? "failed" : "ended"); setRoom(null); },
      local: () => setLocal((l) => ({ ...l, micOn: e.micOn, cameraOn: e.cameraOn, sharing: e.sharing, micTrack: e.micTrack })),
      people: () => setView(fakeView(e, t, startedAt, true)),
      audio: (can) => setLocal((l) => ({ ...l, canPlayAudio: can })),
      device: (p) => setLocal((l) => ({ ...l, problem: `${p.kind}: ${p.failure}` })),
    }, sink.current ?? document.body);
    engine.current = e;
    setRoom(e.room);
    try {
      await e.connect(t.connection, { mic: o.mic ?? true, camera: o.camera ?? false });
      setView(fakeView(e, t, startedAt, true));
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't connect."); setState("failed"); return false; }
  }, [roomName, startedAt]);

  const leave = useCallback(async () => { await engine.current?.disconnect().catch(() => {}); engine.current = null; setRoom(null); setState("ended"); setView(fakeView(null, token, startedAt, false)); }, [token, startedAt]);

  const value: CallHostValue = useMemo(() => ({
    orgSlug: "dev", ready: true, available: true, me: token?.connection.identity ?? "dev-me", ringing, active: null, // a silenced ring stays listed (the card says "Ring silenced"), as in CallHost
    ringsOnDesktop: false,
    view, callId: state === "idle" ? null : DEV_CALL, state, error, micOn: local.micOn, cameraOn: local.cameraOn, sharing: local.sharing,
    startedAt: null, canPlayAudio: local.canPlayAudio, micTrack: local.micTrack, deviceProblem: local.problem, room, silenced,
    silence: (id) => setSilenced((s) => new Set(s).add(id)), refresh: () => rebuild(), setView: () => {}, holdPreJoin: () => {},
    start: async () => null, join: (id, o) => join(id, o ?? {}), accept: async (id) => { setRinging([]); return join(id, {}); },
    decline: async (id) => { setRinging((r) => r.filter((x) => x.id !== id)); return true; }, leave, end: leave,
    toggleMic: async () => { const e = engine.current; if (e) await e.setMic(!e.micOn); },
    toggleCamera: async () => { const e = engine.current; if (e) await e.setCamera(!e.cameraOn); },
    toggleScreen: async () => { const e = engine.current; if (e) await e.setScreen(!e.sharing); },
    startAudio: async () => { await engine.current?.startAudio(); },
  }), [token, ringing, silenced, view, state, error, local, room, rebuild, join, leave]);

  const simulate = () => {
    const at = new Date().toISOString();
    setSilenced(new Set());
    setRinging([{ id: `ring-${Date.now()}`, kind: "group", caller: { ...person("dev-ada", "Ada Lovelace", "dev-ada"), assistant: { name: "Max", colour: "orange", visor: "band", eyes: "round", face: PALETTE.orange.face } },
      where: { conversationId: "00000000-0000-4000-8000-000000000000", kind: "channel", name: "#Design", href: null }, rangAt: at, expiresAt: new Date(Date.now() + CALL_LIMITS.ringMs).toISOString(), href: "/dev/calls", inAnotherCall: state === "connected" }]);
  };
  useEffect(() => () => { void engine.current?.disconnect(); }, []);

  return (
    <CallContext.Provider value={value}>
      <main className="flex min-h-dvh flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <h1 className="text-sm font-semibold">Calls harness (development only)</h1>
          <label className="sr-only" htmlFor="dev-room">Room</label>
          <Input id="dev-room" fieldSize="sm" className="w-48 font-mono" placeholder="dev-… (empty: a new room)" value={roomName} onChange={(e) => setRoomName(e.target.value.trim())} disabled={state === "connected"} />
          <Button size="sm" variant="secondary" onClick={simulate}>Simulate an incoming call</Button>
          <Button size="sm" variant="ghost" onClick={() => setRinging([])}>Stop ringing</Button>
          {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
          <p className="ml-auto text-xs text-subtle">State: {state}{token ? `, room ${token.room}` : ""}</p>
        </header>
        <div className="flex min-h-[640px] flex-1 flex-col">
          <CallStageLoader orgSlug="dev" initial={view} availability={{ available: false, reason: "not_ready" }} workspaceAssistant={DEFAULT_ASSISTANT} />
        </div>
      </main>
      <CallDock pathname="/dev/calls" />
      <IncomingCall />
      <div ref={sink} hidden aria-hidden />
    </CallContext.Provider>
  );
}
