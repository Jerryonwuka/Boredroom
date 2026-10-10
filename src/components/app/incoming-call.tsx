"use client";

/**
 * Someone is calling (owner decisions, 8 October 2026: phase 8, calls; contract D.4). A card on every workspace page for
 * the newest ring ("+1 more calling" when there are more): top right under the top bar on a wide screen (360px), along
 * the bottom on a phone (full width less 16px a side). Inside an open modal dialog it mounts in that dialog and lifts
 * into the top layer, so it stays clickable.
 *
 * The caller's face with a 2px ring in their assistant's colour and a gentle pulse that stays inside the card (none under
 * reduced motion), "Ada is calling", "Call" or "Call in #Design", and, when already on a call, "You're on another call.
 * Accepting leaves it.". Decline (outline), Message (ghost: "Decline with a message", three quick messages or "Write your
 * own", each sent as the person's own message, then declined; D7) and Accept (the card's one orange). Accept joins the
 * call and opens its page.
 *
 * Fix review, 10 October 2026:
 * - Its surface is opaque (`popover-surface`): the toast's translucent fill let the page show through its message options.
 * - It never takes the focus (a person typing must not answer by accident), so Alt+Shift+A moves the focus to Accept
 *   (Enter then answers), and the assertive live region says so: "Ada is calling. Press Alt Shift A, then Enter, to
 *   answer." Accept's tooltip names the shortcut too.
 * - Esc silences the ring only when it is meant for the card: the focus is in it, or nothing else is open (a dialog, a
 *   menu or a popover) and the key was not taken by a field or by something else first. A Silence button does the same,
 *   and "Ring silenced" says it happened. Neither ever declines. Neither shows while the notch rings for the person (the
 *   browser is silent then: one ringer).
 * - The quick messages are a labelled group, "Decline with a message", so each press's effect is said before it.
 * The card goes at the ring's 30 s or when the ring leaves /calls/now. Marked `data-refresh-safe` so a page refresh never
 * waits on it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MessageSquare, Phone, PhoneOff, VolumeX } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { liftToTopLayer, popoverHost } from "@/components/ui/top-layer";
import { useCall } from "@/components/app/call-host";
import { CALL_LIMITS, CALL_WORDS, type RingingCall } from "@/lib/calls";
import { assistantRingColour, callErrorWords, escSilencesRing, isRingShortcut, messageCounter, ringLines } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

/** The card itself, without placement (the gallery and the dev page show it in place). */
export function IncomingCallCard({ ring, more = 0, onAccept, onDecline, busy = null, error = null, silenced = false, onSilence, acceptRef, className }: {
  ring: RingingCall; more?: number; onAccept: () => void; onDecline: (message?: string) => void; busy?: "accept" | "decline" | null; error?: string | null;
  /** The ring was silenced (Esc, or the Silence button): say so. */
  silenced?: boolean;
  /** Silences the ring here (never declines); left out when this browser does not ring (the notch does). */
  onSilence?: () => void;
  acceptRef?: React.Ref<HTMLButtonElement>;
  className?: string;
}) {
  const titleId = useId();
  const lineId = useId();
  const [composing, setComposing] = useState(false);
  const [own, setOwn] = useState("");
  const lines = ringLines(ring);
  const counter = messageCounter(own);
  const caller = ring.caller;
  return (
    <div role="alertdialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={lineId} data-refresh-safe data-incoming-call
      className={cn("popover-surface w-full rounded-2xl p-4 text-left", className)}>
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 inline-flex shrink-0">
          <span aria-hidden className="avatar-ping absolute -inset-1 rounded-full border-2 motion-reduce:hidden" style={{ borderColor: assistantRingColour(caller.assistant) }} />
          <Avatar profileId={caller.profileId} name={caller.name} avatarKey={caller.avatarKey} size={40} ring={assistantRingColour(caller.assistant)} />
        </span>
        <div className="min-w-0 flex-1">
          <p id={titleId} className="truncate text-sm font-semibold text-foreground">{CALL_WORDS.incoming.title(caller.name)}</p>
          <div id={lineId}>
            {lines.map((l, i) => <p key={i} className={cn("text-meta font-normal", i === 0 ? "truncate text-secondary" : "mt-0.5 text-foreground")}>{l}</p>)}
            {more > 0 ? <p className="mt-0.5 text-meta font-normal text-secondary">{CALL_WORDS.incoming.more(more)}</p> : null}
            {silenced ? <p className="mt-0.5 text-meta font-normal text-subtle" role="status">{CALL_WORDS.incoming.silenced}</p> : null}
          </div>
        </div>
        {onSilence && !silenced ? (
          <IconButton size="xs" aria-label={CALL_WORDS.incoming.silence} className="-mr-1 -mt-0.5" onClick={onSilence}><VolumeX aria-hidden /></IconButton>
        ) : null}
      </div>
      {composing ? (
        <div role="group" aria-labelledby={`${titleId}-msgs`} className="mt-3 grid gap-1.5">
          <p id={`${titleId}-msgs`} className="text-meta font-medium text-secondary">{CALL_WORDS.declineWithMessage}</p>
          {CALL_WORDS.quickMessages.map((m) => (
            <Button key={m} variant="subtle" size="sm" className="h-auto min-h-8 justify-start whitespace-normal py-1.5 text-left" disabled={busy !== null} onClick={() => onDecline(m)}>{m}</Button>
          ))}
          <form className="mt-1 grid gap-1.5" onSubmit={(e) => { e.preventDefault(); if (own.trim()) onDecline(own.trim()); }}>
            <label className="sr-only" htmlFor={`${titleId}-own`}>{CALL_WORDS.ownMessage}</label>
            <Input id={`${titleId}-own`} fieldSize="sm" placeholder={CALL_WORDS.ownMessage} value={own} maxLength={CALL_LIMITS.declineMessageMax} onChange={(e) => setOwn(e.target.value)} aria-describedby={counter ? `${titleId}-count` : undefined} />
            <div className="flex items-center justify-between gap-2">
              <span id={`${titleId}-count`} className="text-xs font-medium tabular-nums text-subtle" aria-live="polite">{counter}</span>
              <Button type="submit" variant="secondary" size="sm" disabled={!own.trim() || busy !== null} loading={busy === "decline"}>{CALL_WORDS.sendAndDecline}</Button>
            </div>
          </form>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-meta font-normal text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onDecline()} disabled={busy !== null} loading={busy === "decline" && !composing}><PhoneOff aria-hidden />{CALL_WORDS.decline}</Button>
        <Button variant="ghost" size="sm" aria-expanded={composing} onClick={() => setComposing((v) => !v)} disabled={busy !== null}><MessageSquare aria-hidden />{CALL_WORDS.message}</Button>
        <Button ref={acceptRef} variant="accent" size="sm" data-tip={CALL_WORDS.incoming.acceptTip} onClick={onAccept} disabled={busy !== null} loading={busy === "accept"}><Phone aria-hidden />{CALL_WORDS.accept}</Button>
      </div>
    </div>
  );
}

/** The placed card for the host's newest ring. */
export function IncomingCall() {
  const host = useCall();
  const router = useRouter();
  const ring = host?.ringing[0] ?? null;
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [announced, setAnnounced] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  // Follow any modal dialog that opens or closes while the card shows (its contents are the only clickable part then).
  useEffect(() => {
    if (!ring) return;
    const place = () => setMount(popoverHost(document.querySelector("dialog[open]")));
    place();
    const mo = new MutationObserver(place);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
    return () => mo.disconnect();
  }, [ring]);
  // A new ring clears the last one's state (its key changes; React keeps this component).
  const ringId = ring?.id ?? null;
  const [seenRing, setSeenRing] = useState(ringId);
  if (seenRing !== ringId) { setSeenRing(ringId); setBusy(null); setError(null); }
  useEffect(() => { if (ring && announced !== ring.id) { const t = setTimeout(() => setAnnounced(ring.id), 50); return () => clearTimeout(t); } }, [ring, announced]);

  // The keys while a ring shows (fix review, 10 October 2026): Alt+Shift+A moves the focus to Accept; Esc silences the
  // ring when it is meant for the card (escSilencesRing), never declining it.
  const silence = host?.silence;
  const ringingIds = (host?.ringing ?? []).map((r) => r.id).join(",");
  useEffect(() => {
    if (!ringingIds || !silence) return;
    const onKey = (e: KeyboardEvent) => {
      if (isRingShortcut(e)) {
        e.preventDefault();
        acceptRef.current?.focus();
        return;
      }
      if (e.key !== "Escape") return;
      const card = box.current;
      const target = e.target instanceof Element ? e.target : null;
      const inCard = !!card && !!target && card.contains(target);
      if (!escSilencesRing({ defaultPrevented: e.defaultPrevented, inCard, openElsewhere: somethingElseOpen(card), editable: !!target && isEditable(target) })) return;
      // Pressed in the card: it is the card's Esc, not a dialog's underneath it.
      if (inCard) e.preventDefault();
      ringingIds.split(",").forEach((id) => silence(id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ringingIds, silence]);

  if (!host || !ring || !mount) return null;
  const more = host.ringing.length - 1;
  const accept = async () => {
    setBusy("accept"); setError(null);
    try {
      await host.accept(ring.id, { leaveOther: ring.inAnotherCall });
      router.push(ring.href);
    } catch (err) { setError(callErrorWords(err)); setBusy(null); }
  };
  const decline = async (message?: string) => {
    setBusy("decline"); setError(null);
    const ok = await host.decline(ring.id, message ?? null);
    if (!ok) { setError(CALL_WORDS.incoming.declineFailed); setBusy(null); }
  };
  const inDialog = mount !== document.body;
  const silenced = host.silenced.has(ring.id);
  return createPortal(
    <div ref={(el) => { box.current = el; if (inDialog && el) liftToTopLayer(el); }} data-refresh-safe
      className={cn(inDialog && "top-pop", "fixed z-[var(--z-toast)] w-[360px] max-w-[calc(100vw-2rem)]", "right-4 top-[calc(var(--header-height)+var(--shell-banners,0px)+12px)]",
        "max-sm:inset-x-4 max-sm:bottom-[max(16px,env(safe-area-inset-bottom))] max-sm:top-auto max-sm:w-auto max-sm:max-w-none")}>
      <IncomingCallCard key={ring.id} ring={ring} more={more} busy={busy} error={error} onAccept={() => void accept()} onDecline={(m) => void decline(m)}
        silenced={!host.ringsOnDesktop && silenced} onSilence={host.ringsOnDesktop ? undefined : () => host.silence(ring.id)} acceptRef={acceptRef} className="shadow-toast" />
      <p className="sr-only" aria-live="assertive">{announced === ring.id ? CALL_WORDS.incoming.announce(ring.caller.name) : ""}</p>
    </div>,
    mount,
  );
}

/** A dialog, a sheet, a menu or a popover is open, other than the card (and tooltips): Esc is theirs then. */
function somethingElseOpen(card: HTMLElement | null): boolean {
  let nodes: Element[];
  try { nodes = [...document.querySelectorAll("dialog[open], [role='dialog'], [role='menu'], :popover-open")]; }
  catch { nodes = [...document.querySelectorAll("dialog[open], [role='dialog'], [role='menu']")]; } // no :popover-open here
  return nodes.some((n) => n.getAttribute("role") !== "tooltip" && !(card && (n === card || card.contains(n))));
}

function isEditable(el: Element): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}
