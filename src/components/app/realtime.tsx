"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribes to the workspace event stream and refreshes server components when
 * something changes. Reconnect triggers a full authoritative refetch (router.refresh).
 */
export function RealtimeRefresher({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let backoff = 1000;
    const schedule = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; router.refresh(); }, 400);
    };
    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/orgs/${orgSlug}/events`);
      es.onmessage = () => { backoff = 1000; schedule(); };
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
