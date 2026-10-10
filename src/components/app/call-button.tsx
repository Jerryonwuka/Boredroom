"use client";

/**
 * Call buttons (owner decisions, 8 October 2026: phase 8, calls; contract D.7): on a direct thread's header (one-to-one),
 * a team or named channel's header (the group call; a team channel's call is the team call), a person's card, the
 * Workroom's person page and the Calls page's rows. Anyone may call the people they can already message; never Everyone
 * nor an archived channel (D1: the page leaves the button out there).
 *
 * - Hidden when calls are not available (before migration 0054, or without LiveKit).
 * - A call already running in that conversation: "Join (3)" with the live dot (outline). Otherwise "Call" (ghost, the
 *   phone; the word hides below 640px, the accessible name stays "Call Ada" / "Start a call in #Design").
 * - Pressing it while on another call asks first ("You're on a call in #Design. Leave it and join this one?", or "…
 *   Leave it and start this one?" for a new call) and leaves that call on yes. Then it starts the call (an `existing`
 *   answer joins the call already running there) and opens the call's page.
 * - Its accessible name always says who or where (fix review, 10 October 2026: a list of identical "Call back" buttons):
 *   "Call back Ada", "Call again with Ada", "Call again in #Design", "Join the call in #Design, 3 people in it"; each
 *   starts with the words on the button.
 * - For a conversation it refetches GET /calls/live?conversation= on the calls tables' events (debounced 1 s), so
 *   "Join (n)" stays right without a page refresh.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { StatusDot } from "@/components/ui/status-dot";
import { notify } from "@/components/ui/toast";
import { useCall, type CallTarget } from "@/components/app/call-host";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { CALL_WORDS, callHref, type LiveCallSummary } from "@/lib/calls";
import { CALL_EVENT_TABLES, callErrorWords, callsApi } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

export type CallButtonProps = {
  orgSlug: string;
  target: CallTarget;
  /** The call running in the conversation now (the page's first render); the button keeps it fresh itself. */
  live: LiveCallSummary | null;
  available: boolean;
  size?: "xs" | "sm" | "md";
  variant?: "ghost" | "secondary" | "primary";
  /** The word on the button ("Call again", "Call back"); "Call" by default. */
  label?: string;
  className?: string;
};

export function CallButton({ orgSlug, target, live: initialLive, available, size = "sm", variant = "ghost", label, className }: CallButtonProps) {
  const host = useCall();
  const router = useRouter();
  const calls = useMemo(() => callsApi(orgSlug), [orgSlug]);
  const [live, setLive] = useState<LiveCallSummary | null>(initialLive);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const conversationId = target.kind === "conversation" ? target.conversationId : null;
  const ok = available && (host ? host.available || !host.me : true);

  // A new first render (the page refreshed) brings a newer live call: take it.
  const [seed, setSeed] = useState(initialLive);
  if (seed !== initialLive) { setSeed(initialLive); setLive(initialLive); }
  useEffect(() => {
    if (!conversationId || !ok) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const table = (e as CustomEvent<ChangeEvent>).detail?.table;
      if (!table || !CALL_EVENT_TABLES.has(table)) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; calls.live(conversationId).then((r) => setLive(r.live[0] ?? null), () => {}); }, 1000);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { if (t) clearTimeout(t); window.removeEventListener(CHANGE_EVENT, onChange); };
  }, [calls, conversationId, ok]);

  if (!ok || !host) return null;
  const name = target.kind === "person"
    ? label === CALL_WORDS.callBack ? CALL_WORDS.names.callBack(target.name) : label === CALL_WORDS.callAgain ? CALL_WORDS.names.callAgainWith(target.name) : CALL_WORDS.callPerson(target.name)
    : label === CALL_WORDS.callAgain ? CALL_WORDS.names.callAgainIn(target.label) : CALL_WORDS.callIn(target.label);
  const elsewhere = host.active && host.active.id !== live?.id ? host.active : null;

  const go = async () => {
    setBusy(true);
    try {
      if (live) {
        if (live.youAreIn && host.callId === live.id) { router.push(live.href); return; }
        await host.join(live.id, { leaveOther: !!elsewhere });
        router.push(live.href);
        return;
      }
      if (elsewhere) {
        // Leave the other call first: this tab's connection, or the call on another device.
        if (host.callId === elsewhere.id) await host.leave();
        else await calls.leave(elsewhere.id).catch(() => null);
      }
      const r = await host.start(target);
      if (r) router.push(r.href ?? callHref(orgSlug, r.callId));
    } catch (err) {
      notify(callErrorWords(err), { tone: "danger" });
    } finally { setBusy(false); }
  };
  const press = () => { if (elsewhere) setConfirm(true); else void go(); };

  const joining = !!live && !live.youAreIn;
  return (
    <>
      {joining ? (
        <Button variant="secondary" size={size} className={className} onClick={press} loading={busy} aria-label={CALL_WORDS.names.join(live.where, live.inRoom)}>
          {busy ? null : <StatusDot tone="live" />}{CALL_WORDS.joinCount(live.inRoom)}
        </Button>
      ) : (
        <Button variant={variant} size={size} className={className} onClick={press} loading={busy} aria-label={live?.youAreIn ? CALL_WORDS.backToCall : name}>
          {busy ? null : <Phone aria-hidden />}<span className={cn(!label && "max-sm:sr-only")}>{label ?? (live?.youAreIn ? CALL_WORDS.backToCall : CALL_WORDS.call)}</span>
        </Button>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary"
        title={live ? CALL_WORDS.stage.inAnotherCall(elsewhere?.where.name ?? "another call") : CALL_WORDS.stage.leaveAndStart(elsewhere?.where.name ?? "another call")}
        confirmLabel={live ? CALL_WORDS.join : CALL_WORDS.call}
        onConfirm={async () => { setConfirm(false); await go(); }} />
    </>
  );
}
