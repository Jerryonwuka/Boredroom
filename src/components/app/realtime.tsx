"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export type ChangeEvent = { table: string; op: string; id: string; at: string };
export const CHANGE_EVENT = "boredroom:change";
/** How long a tab stays in the background before it closes the event stream. */
const HIDDEN_CLOSE_MS = 10 * 60_000;
/** The calls tables whose changes the call components handle themselves (phase 8). */
export const CALL_TABLES: ReadonlySet<string> = new Set(["calls", "call_participants", "call_note_consents"]);

/**
 * Subscribes to the workspace event stream and refreshes server components when something changes. Reconnect
 * triggers a full authoritative refetch (router.refresh). Every payload is also re-broadcast on `window` as a
 * `boredroom:change` CustomEvent, so other components (the message toasts) can react without a second stream.
 */
export function RealtimeRefresher({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let backoff = 1000;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // A change that arrives while the tab is in the background is held until the person comes back: one refresh
    // then, instead of re-rendering a page nobody is looking at for every timer tick in the room.
    let held = false;
    // Never refresh while the person is typing in a form; retry shortly after. Forms marked data-refresh-safe
    // (the message composer) keep their own state across a refresh, so they do not hold it back.
    const editing = () => { const el = document.activeElement; return !!el && !!el.closest("form:not([data-refresh-safe]), [role=dialog]:not([data-refresh-safe])"); };
    const schedule = () => {
      if (closed || timer.current) return;
      if (document.visibilityState === "hidden") { held = true; return; }
      timer.current = setTimeout(() => {
        timer.current = null;
        if (editing()) { schedule(); return; }
        router.refresh();
      }, editing() ? 2000 : 400);
    };
    // A tab in the background for ten minutes lets go of the stream (owner, 29 October 2026: Vercel paused the site after
    // open tabs and the Mac's dashboard window kept a function provisioned around the clock). Coming back reconnects
    // and refreshes once, which catches up on whatever changed meanwhile.
    let sleep: ReturnType<typeof setTimeout> | null = null;
    let asleep = false;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        if (!sleep && !asleep) sleep = setTimeout(() => { sleep = null; asleep = true; es?.close(); es = null; if (retry) { clearTimeout(retry); retry = null; } }, HIDDEN_CLOSE_MS);
        return;
      }
      if (sleep) { clearTimeout(sleep); sleep = null; }
      if (asleep) { asleep = false; backoff = 1000; connect(); held = false; schedule(); return; }
      if (held) { held = false; schedule(); }
    };
    const connect = () => {
      if (closed || asleep) return;
      es = new EventSource(`/api/orgs/${orgSlug}/events`);
      es.onmessage = (e) => {
        backoff = 1000;
        let payload: ChangeEvent | null = null;
        try { payload = JSON.parse(e.data) as ChangeEvent; window.dispatchEvent(new CustomEvent<ChangeEvent>(CHANGE_EVENT, { detail: payload })); } catch { /* keepalive or malformed */ }
        // Calls (owner decisions, 8 October 2026: phase 8): the call components refresh themselves (CallHost, the
        // call stage, CallButton), so a call starting in one channel does not refresh everyone's page. Only the Calls
        // pages still refresh for these tables.
        if (payload && CALL_TABLES.has(payload.table) && !location.pathname.includes("/calls")) return;
        schedule();
      };
      es.onopen = () => { backoff = 1000; };
      es.onerror = () => {
        es?.close();
        if (!closed && !asleep) retry = setTimeout(() => { retry = null; connect(); schedule(); }, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
    };
    connect();
    document.addEventListener("visibilitychange", onVisible);
    if (document.visibilityState === "hidden") onVisible();
    return () => { closed = true; es?.close(); if (retry) clearTimeout(retry); if (sleep) clearTimeout(sleep); if (timer.current) clearTimeout(timer.current); timer.current = null; document.removeEventListener("visibilitychange", onVisible); };
  }, [orgSlug, router]);
  return null;
}
