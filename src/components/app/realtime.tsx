"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export type ChangeEvent = { table: string; op: string; id: string; at: string };
export const CHANGE_EVENT = "boredroom:change";

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
    // Never refresh while the person is typing in a form; retry shortly after. Forms marked data-refresh-safe
    // (the message composer) keep their own state across a refresh, so they do not hold it back.
    const editing = () => { const el = document.activeElement; return !!el && !!el.closest("form:not([data-refresh-safe]), [role=dialog]:not([data-refresh-safe])"); };
    const schedule = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (editing()) { schedule(); return; }
        router.refresh();
      }, editing() ? 2000 : 400);
    };
    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/orgs/${orgSlug}/events`);
      es.onmessage = (e) => {
        backoff = 1000;
        try { const payload = JSON.parse(e.data) as ChangeEvent; window.dispatchEvent(new CustomEvent<ChangeEvent>(CHANGE_EVENT, { detail: payload })); } catch { /* keepalive or malformed */ }
        schedule();
      };
      es.onopen = () => { backoff = 1000; };
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(() => { connect(); schedule(); }, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
    };
    connect();
    return () => { closed = true; es?.close(); if (timer.current) clearTimeout(timer.current); };
  }, [orgSlug, router]);
  return null;
}
