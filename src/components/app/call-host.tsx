"use client";

/**
 * Calls in the workspace (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, calls; contract D.3).
 * Mounted by the workspace layout, which persists across client navigation, so a call carries on while the person opens
 * other pages (owner default: the "On a call" dock). It renders the page, the incoming-call card, the dock and a hidden
 * container the remote voices play from, and holds:
 *
 * - `now` (GET /calls/now): who is ringing this person and the call they are in. Fetched on mount, on the calls tables'
 *   change events (debounced 300 ms, one request in flight), on focus and when the tab comes back into view, every 60 s
 *   while in view and every 5 minutes while hidden. A 401 or 404 leaves it idle: only the page renders.
 * - the connection of THIS tab: the LiveKit engine (`call-engine.ts`, imported dynamically the first time a call starts
 *   or is joined, never at load), its state, the microphone, camera and screen, and the actions every call screen uses.
 * - heartbeats (POST /calls/:id/heartbeat every 15 s) while connected or reconnecting, and while this tab shows the
 *   pre-join panel of a call the person already accepted elsewhere (the notch's Accept), so the 90-second connect grace
 *   never drops them before they press Join. NO leave on page unload: a reload must not end a one-to-one call (D5);
 *   LiveKit drops the media and the 45-second rule does the rest.
 * - the ring: while someone is calling, the ring sound every 2.5 s for at most 30 s, only in the tab in view (or, with
 *   none in view, the one most recently in view; `shouldThisTabRing`); one soft `attention` instead while already on a
 *   call. Esc or the card's Silence button silences it (never declines; the card handles both). The card always shows
 *   too, since a browser may block sound before a click. These are the call's own sounds (`playCallSound`): turning
 *   Brenda's chimes off does not silence a call (fix review, 10 October 2026). One ringer (same review): while the
 *   person's notch rings aloud on this network (`now.ringsOnDesktop`), the browser shows the card and stays silent.
 * - Brenda's notes runner (brenda_notes' `CallNotesRunner`) while connected, so notes keep being written on other pages.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { IncomingCall } from "@/components/app/incoming-call";
import { CallDock } from "@/components/app/call-dock";
import { CallNotesRunner } from "@/components/app/call-notes";
import { playCallSound } from "@/lib/brenda-sound";
import { isApiFailure } from "@/lib/api-client";
import { CALL_LIMITS, CALL_WORDS, callHref, type ActiveCall, type CallConnection, type CallsNow, type CallView, type RingingCall } from "@/lib/calls";
import { CALL_EVENT_TABLES, LAST_VISIBLE_KEY, RING_EVERY_MS, STAMP_EVERY_MS, callsApi, readStamp, ringStillDue, shouldThisTabRing, skewOf } from "@/lib/calls-client";
import type { CallEngine, DeviceProblem, EngineEnd } from "@/lib/call-engine";

export type CallTarget = { kind: "conversation"; conversationId: string; label: string } | { kind: "person"; membershipId: string; name: string };
export type CallConnState = "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "replaced" | "failed";
export type JoinOptions = { leaveOther?: boolean; mic?: boolean; camera?: boolean };

export type CallHostValue = {
  orgSlug: string;
  /** GET /calls/now said so: migration 0054 is in (`ready`) and LiveKit is set up too (`available`). */
  ready: boolean;
  available: boolean;
  /** The viewer's membership id. */
  me: string | null;
  /** Calls ringing this person now (newest first), past their 30 s dropped. */
  ringing: RingingCall[];
  /** The person's notch rings these calls aloud on this network: this browser shows the card silently (one ringer). */
  ringsOnDesktop: boolean;
  /** The call this person is in (from any tab or device). */
  active: ActiveCall | null;
  /** The view of the call this tab is connected to (or connecting to). */
  view: CallView | null;
  /** The call this tab is connected to, or was last (for "You left the call" and "Join here instead"). */
  callId: string | null;
  state: CallConnState;
  error: string | null;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** When this tab connected (epoch ms). */
  startedAt: number | null;
  /** False until the browser lets remote voices play (autoplay): the dock and stage show "Turn on sound". */
  canPlayAudio: boolean;
  micTrack: MediaStreamTrack | null;
  /** The last microphone, camera or screen problem, in words (CALL_WORDS.mic/camera/screen). */
  deviceProblem: string | null;
  /** The LiveKit room, opaque here: the stage gives it to `RoomContext.Provider`. */
  room: unknown;
  /** The ring is silenced (Esc, or the card's Silence button) for these calls. */
  silenced: ReadonlySet<string>;
  silence(callId: string): void;
  refresh(): void;
  /** The stage hands over the newest view it read (the notes routes answer one). */
  setView(view: CallView): void;
  /** The stage's pre-join panel of a call this person already accepted elsewhere: heartbeat it until Join. */
  holdPreJoin(callId: string | null): void;
  start(target: CallTarget): Promise<{ callId: string; href: string; existing: boolean } | null>;
  join(callId: string, o?: JoinOptions): Promise<boolean>;
  accept(callId: string, o?: JoinOptions): Promise<boolean>;
  decline(callId: string, message?: string | null): Promise<boolean>;
  leave(): Promise<void>;
  end(): Promise<void>;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleScreen(): Promise<void>;
  startAudio(): Promise<void>;
};

export const CallContext = createContext<CallHostValue | null>(null);
/** The calls host, or null outside a workspace (the admin pages, the landing page). */
export function useCall(): CallHostValue | null {
  return useContext(CallContext);
}

type Conn = {
  callId: string | null;
  state: CallConnState;
  error: string | null;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  startedAt: number | null;
  canPlayAudio: boolean;
  micTrack: MediaStreamTrack | null;
  deviceProblem: string | null;
};
const IDLE: Conn = { callId: null, state: "idle", error: null, micOn: false, cameraOn: false, sharing: false, startedAt: null, canPlayAudio: true, micTrack: null, deviceProblem: null };

const COULD_NOT_CONNECT = CALL_WORDS.stage.couldNotConnect;
const UNSUPPORTED = CALL_WORDS.stage.unsupported;

function deviceWords(p: DeviceProblem): string {
  if (p.kind === "screen") return p.failure === "unsupported" ? CALL_WORDS.screen.unsupported : CALL_WORDS.screen.failed;
  const w = p.kind === "mic" ? CALL_WORDS.mic : CALL_WORDS.camera;
  if (p.failure === "blocked") return w.blocked;
  if (p.failure === "none") return w.none;
  return w.busy;
}

/** A stable id for this tab (the ring election). */
function tabId(): string {
  try {
    const k = "boredroom-tab-id";
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(k, id);
    return id;
  } catch { return "tab"; }
}

export function CallHost({ orgSlug, children }: { orgSlug: string; children: React.ReactNode }) {
  const calls = useMemo(() => callsApi(orgSlug), [orgSlug]);
  const pathname = usePathname();
  const [now, setNow] = useState<CallsNow | null>(null);
  const [skew, setSkew] = useState(0);
  const [conn, setConn] = useState<Conn>(IDLE);
  const [view, setViewState] = useState<CallView | null>(null);
  const [silenced, setSilenced] = useState<ReadonlySet<string>>(() => new Set());
  const [preJoin, setPreJoin] = useState<string | null>(null);
  const [room, setRoom] = useState<unknown>(null);
  // The local time the ring list was last judged at (set by fetches and the expiry timer, never read during render).
  const [clock, setClock] = useState(0);
  const engine = useRef<CallEngine | null>(null);
  const sink = useRef<HTMLDivElement>(null);
  const stopped = useRef(false);
  const callIdRef = useRef<string | null>(null);

  // ---- GET /calls/now ----
  const inFlight = useRef(false);
  const again = useRef(false);
  const fetchNow = useCallback(async () => {
    if (stopped.current) return;
    // One request in flight; anything asked meanwhile runs once more after it.
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        try {
          const n = await calls.now();
          const at = Date.now();
          setNow(n);
          setSkew(skewOf(n.serverNow, at));
          setClock(at);
        } catch (err) {
          // Signed out, or not a member of this workspace: stay idle and stop asking.
          if (isApiFailure(err) && (err.error.status === 401 || err.error.status === 404)) { stopped.current = true; setNow(null); }
        }
      } while (again.current && !stopped.current);
    } finally {
      inFlight.current = false;
    }
  }, [calls]);

  // ---- The connected call's view ----
  const fetchView = useCallback(async (id: string) => {
    try {
      const { call } = await calls.view(id);
      if (callIdRef.current === id) setViewState(call);
    } catch { /* the next event or heartbeat tries again */ }
  }, [calls]);

  useEffect(() => {
    void fetchNow();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const t = (e as CustomEvent<ChangeEvent>).detail?.table;
      if (!t || !CALL_EVENT_TABLES.has(t)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void fetchNow();
        if (callIdRef.current) void fetchView(callIdRef.current);
      }, 300);
    };
    const onFocus = () => void fetchNow();
    const onVisible = () => { if (document.visibilityState === "visible") void fetchNow(); };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    let poll: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      poll = setTimeout(() => { void fetchNow(); schedule(); }, document.visibilityState === "visible" ? 60_000 : 5 * 60_000);
    };
    schedule();
    return () => {
      if (debounce) clearTimeout(debounce);
      if (poll) clearTimeout(poll);
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchNow, fetchView]);

  // One-time cleanup (removal's request). The old screen recorder's unsent video chunks (phase 8: screen recording is
  // gone; nothing reads them).
  useEffect(() => {
    try { indexedDB.deleteDatabase("boredroom-capture"); } catch { /* private mode, or no IndexedDB */ }
  }, []);

  // ---- The engine ----
  const syncLocal = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    setConn((c) => ({ ...c, micOn: e.micOn, cameraOn: e.cameraOn, sharing: e.sharing, micTrack: e.micTrack }));
  }, []);

  const teardown = useCallback(async () => {
    const e = engine.current;
    engine.current = null;
    setRoom(null);
    if (e) { try { await e.disconnect(); } catch { /* already gone */ } }
  }, []);

  const onEnded = useCallback((id: string, why: EngineEnd) => {
    // Only the engine that is still current speaks; one we replaced or left on purpose says nothing.
    if (callIdRef.current !== id) return;
    engine.current = null;
    setRoom(null);
    if (why === "left") return;
    if (why === "replaced") { setConn((c) => ({ ...c, state: "replaced", micTrack: null, error: CALL_WORDS.stage.otherDevice })); return; }
    if (why === "ended") { playCallSound("hangup"); setConn((c) => ({ ...c, state: "ended", micTrack: null, error: null })); void fetchView(id); void fetchNow(); return; }
    if (why === "removed") { setConn((c) => ({ ...c, state: "ended", micTrack: null, error: null })); void fetchView(id); void fetchNow(); return; }
    setConn((c) => ({ ...c, state: "failed", micTrack: null, error: COULD_NOT_CONNECT }));
    void fetchNow();
  }, [fetchNow, fetchView]);

  const connectTo = useCallback(async (id: string, connection: CallConnection, call: CallView, o: { mic: boolean; camera: boolean }) => {
    const mod = await import("@/lib/call-engine");
    if (!mod.browserSupported()) { setConn({ ...IDLE, callId: id, state: "failed", error: UNSUPPORTED }); return false; }
    await teardown();
    callIdRef.current = id;
    setViewState(call);
    setPreJoin(null);
    setConn({ ...IDLE, callId: id, state: "connecting" });
    const host = sink.current ?? document.body;
    const e = new mod.CallEngine({
      state: (s) => setConn((c) => (callIdRef.current !== id ? c : s === "connected" ? { ...c, state: "connected", startedAt: c.startedAt ?? Date.now(), error: null } : s === "reconnecting" ? { ...c, state: "reconnecting" } : c)),
      ended: (why) => onEnded(id, why),
      local: () => { if (callIdRef.current === id) syncLocal(); },
      people: () => { void fetchView(id); },
      audio: (can) => setConn((c) => (callIdRef.current === id ? { ...c, canPlayAudio: can } : c)),
      device: (p) => setConn((c) => (callIdRef.current === id ? { ...c, deviceProblem: deviceWords(p) } : c)),
    }, host);
    engine.current = e;
    setRoom(e.room);
    try {
      await e.connect(connection, o);
      syncLocal();
      return true;
    } catch {
      if (engine.current === e) { engine.current = null; setRoom(null); }
      setConn((c) => ({ ...c, state: "failed", error: COULD_NOT_CONNECT }));
      return false;
    }
  }, [teardown, onEnded, syncLocal, fetchView]);

  // ---- Actions ----
  const join = useCallback(async (callId: string, o: JoinOptions = {}) => {
    try {
      // Joining another call from this tab: drop the current media first (the server leaves the other call itself).
      if (engine.current && callIdRef.current !== callId) await teardown();
      const { call, connection } = await calls.join(callId, { leaveOther: o.leaveOther });
      const ok = await connectTo(callId, connection, call, { mic: o.mic ?? true, camera: o.camera ?? false });
      void fetchNow();
      return ok;
    } catch (err) {
      // The caller shows the words (callErrorWords); a 409 IN_ANOTHER_CALL asks to leave the other call first.
      void fetchNow();
      throw err;
    }
  }, [calls, connectTo, fetchNow, teardown]);

  const start = useCallback(async (target: CallTarget) => {
    const answer = await calls.start(target.kind === "person" ? { to: target.membershipId } : { conversationId: target.conversationId });
    const id = answer.call.id;
    const href = callHref(orgSlug, id);
    if (answer.existing || !answer.connection) {
      // A call is already running there: join it instead.
      await join(id, {});
      return { callId: id, href, existing: true };
    }
    await connectTo(id, answer.connection, answer.call, { mic: true, camera: false });
    void fetchNow();
    return { callId: id, href, existing: false };
  }, [calls, connectTo, fetchNow, join, orgSlug]);

  const decline = useCallback(async (callId: string, message?: string | null) => {
    try { await calls.decline(callId, message ?? null); return true; }
    catch { return false; }
    finally { setSilenced((s) => new Set(s).add(callId)); void fetchNow(); }
  }, [calls, fetchNow]);

  const leave = useCallback(async () => {
    const id = callIdRef.current;
    await teardown();
    if (!id) return;
    playCallSound("hangup");
    setConn((c) => ({ ...c, state: "ended", micTrack: null, micOn: false, cameraOn: false, sharing: false, error: null }));
    try { const { call } = await calls.leave(id); if (callIdRef.current === id) setViewState(call); } catch { /* the 45-second rule ends it */ }
    void fetchNow();
  }, [calls, fetchNow, teardown]);

  const end = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    // The server ends it for everyone first (it may refuse: only the starter can); then this tab lets go.
    const { call } = await calls.end(id);
    await teardown();
    playCallSound("hangup");
    setViewState(call);
    setConn((c) => ({ ...c, state: "ended", micTrack: null, micOn: false, cameraOn: false, sharing: false, error: null }));
    void fetchNow();
  }, [calls, fetchNow, teardown]);

  const toggleMic = useCallback(async () => { const e = engine.current; if (e) { setConn((c) => ({ ...c, deviceProblem: null })); await e.setMic(!e.micOn); } }, []);
  const toggleCamera = useCallback(async () => { const e = engine.current; if (e) { setConn((c) => ({ ...c, deviceProblem: null })); await e.setCamera(!e.cameraOn); } }, []);
  const toggleScreen = useCallback(async () => { const e = engine.current; if (e) { setConn((c) => ({ ...c, deviceProblem: null })); await e.setScreen(!e.sharing); } }, []);
  const startAudio = useCallback(async () => { try { await engine.current?.startAudio(); } catch { /* still blocked */ } }, []);
  const silence = useCallback((callId: string) => setSilenced((s) => (s.has(callId) ? s : new Set(s).add(callId))), []);
  const setView = useCallback((v: CallView) => { if (callIdRef.current === v.id) setViewState(v); }, []);
  const holdPreJoin = useCallback((id: string | null) => setPreJoin(id), []);

  // ---- Heartbeats ----
  const beating = conn.state === "connected" || conn.state === "reconnecting" ? conn.callId : preJoin;
  useEffect(() => {
    if (!beating) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const { state } = await calls.heartbeat(beating);
        if (cancelled) return;
        if (state === "left" && callIdRef.current === beating && engine.current) {
          await teardown();
          setConn((c) => ({ ...c, state: "ended", micTrack: null, error: CALL_WORDS.stage.youLeft }));
          void fetchView(beating);
        } else if (state === "ended") {
          if (callIdRef.current === beating) {
            await teardown();
            playCallSound("hangup");
            setConn((c) => ({ ...c, state: "ended", micTrack: null, error: null }));
            void fetchView(beating);
          }
          setPreJoin((p) => (p === beating ? null : p));
          void fetchNow();
        }
      } catch { /* the next beat tries again */ }
    };
    void beat();
    const t = setInterval(() => void beat(), CALL_LIMITS.heartbeatMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [beating, calls, fetchNow, fetchView, teardown]);
  // One more look just after the last ring runs out (live check, 10 October 2026: the caller read "Calling Ben…" for up to
  // a heartbeat longer than the 30 s ring). Reading the call settles it on the server, so "didn't answer" shows on time.
  const ringEndsIn = useMemo(() => {
    const rang = (view && view.id === beating ? view.participants : []).filter((p) => p.state === "ringing" && p.rangAt).map((p) => Date.parse(p.rangAt!));
    return rang.length ? Math.max(...rang) + CALL_LIMITS.ringMs - skew : null;
  }, [view, beating, skew]);
  useEffect(() => {
    if (!beating || ringEndsIn === null) return;
    const t = setTimeout(() => { void fetchView(beating); void fetchNow(); }, Math.max(0, ringEndsIn - Date.now()) + 500);
    return () => clearTimeout(t);
  }, [beating, ringEndsIn, fetchView, fetchNow]);

  // ---- Ringing ----
  // The server only lists rings younger than 30 s; `clock` drops them locally when they pass it.
  const ringing = useMemo(() => (now?.ringing ?? []).filter((r) => r.id !== conn.callId && (!clock || ringStillDue(r.rangAt, clock, skew))), [now, conn.callId, skew, clock]);
  // Drop a ring at its expiry even if no event arrives.
  useEffect(() => {
    if (!ringing.length) return;
    const next = Math.min(...ringing.map((r) => Date.parse(r.expiresAt) - skew - Date.now()));
    const t = setTimeout(() => { setClock(Date.now()); void fetchNow(); }, Math.max(250, next + 50));
    return () => clearTimeout(t);
  }, [ringing, skew, fetchNow]);

  // Every tab stamps itself while in view, so a hidden tab knows whether to ring.
  const tab = useRef<string>("");
  useEffect(() => {
    tab.current = tabId();
    const stamp = () => { if (document.visibilityState === "visible") { try { localStorage.setItem(LAST_VISIBLE_KEY, JSON.stringify({ tab: tab.current, at: Date.now() })); } catch { /* private mode */ } } };
    stamp();
    const t = setInterval(stamp, STAMP_EVERY_MS);
    document.addEventListener("visibilitychange", stamp);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", stamp); };
  }, []);

  const ringingNow = ringing.filter((r) => !silenced.has(r.id));
  const ringKey = ringingNow.map((r) => r.id).join(",");
  const inCall = conn.state === "connected" || conn.state === "reconnecting";
  // The notch rings aloud for this person on this network: the card shows here, the sound is the notch's (one ringer).
  const ringsOnDesktop = now?.ringsOnDesktop === true;
  useEffect(() => {
    if (!ringKey || ringsOnDesktop) return;
    const first = ringingNow[0];
    const mayRing = () => {
      let stampRaw: string | null = null;
      try { stampRaw = localStorage.getItem(LAST_VISIBLE_KEY); } catch { /* private mode */ }
      return shouldThisTabRing({ visible: document.visibilityState === "visible", tab: tab.current, stamp: readStamp(stampRaw), now: Date.now() });
    };
    // Already on a call: one soft attention, no ring.
    if (inCall) { if (mayRing()) playCallSound("attention"); return; }
    const ring = () => { if (ringStillDue(first.rangAt, Date.now(), skew) && mayRing()) playCallSound("ring"); };
    ring();
    const t = setInterval(ring, RING_EVERY_MS);
    const stop = setTimeout(() => clearInterval(t), Math.max(0, Date.parse(first.rangAt) + CALL_LIMITS.ringMs - skew - Date.now()));
    return () => { clearInterval(t); clearTimeout(stop); };
    // ringingNow is derived from ringKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringKey, inCall, skew, ringsOnDesktop]);

  // Leaving the workspace (another workspace's layout) lets go of the media; a reload never calls leave (D5).
  useEffect(() => () => { void engine.current?.disconnect(); }, []);

  const value: CallHostValue = {
    orgSlug,
    ready: now?.ready ?? false,
    available: now?.available ?? false,
    me: now?.me ?? null,
    ringing,
    ringsOnDesktop,
    active: now?.active ?? null,
    view,
    callId: conn.callId,
    state: conn.state,
    error: conn.error,
    micOn: conn.micOn,
    cameraOn: conn.cameraOn,
    sharing: conn.sharing,
    startedAt: conn.startedAt,
    canPlayAudio: conn.canPlayAudio,
    micTrack: conn.micTrack,
    deviceProblem: conn.deviceProblem,
    room,
    silenced,
    silence,
    refresh: () => void fetchNow(),
    setView,
    holdPreJoin,
    start,
    join,
    accept: join,
    decline,
    leave,
    end,
    toggleMic,
    toggleCamera,
    toggleScreen,
    startAudio,
  };

  const connected = conn.state === "connected" || conn.state === "reconnecting";
  return (
    <CallContext.Provider value={value}>
      {children}
      {/* The card after the dock: on a phone both sit at the bottom, and a ring goes on top. */}
      <CallDock pathname={pathname} />
      <IncomingCall />
      <div ref={sink} hidden aria-hidden data-call-audio-sink />
      {connected ? <CallNotesRunner orgSlug={orgSlug} call={view} connected={conn.state === "connected"} micTrack={conn.micTrack} /> : null}
    </CallContext.Provider>
  );
}
