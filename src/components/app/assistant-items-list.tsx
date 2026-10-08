"use client";

/**
 * The lists on "Between assistants" (owner decision, 8 October 2026: personal assistants, phase 6): what the person's
 * assistant sent for them ("Sent": messages, requests and notes for the team report, each with where it stands) and
 * what other people's assistants brought them ("Received": messages, requests and replies), newest first, one compact
 * row each (assistant-item-card) that opens into the whole card in place.
 *
 * The page renders the first page on the server, and the workspace's change stream refreshes it as items change (its
 * copy always wins over the same item fetched here). "Show more" appends older pages from
 * `GET /api/orgs/{org}/assistant-items?box=…` by their `before` cursor; when the change stream names one of those older
 * items (`CHANGE_EVENT`, table `assistant_items`), it is read again (300 ms after the last change), so a reply or an
 * answer shows on a row fetched here too. A polite status says how many show after "Show more"; nothing else is
 * announced.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { AssistantItemCard } from "@/components/app/assistant-item-card";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { api, isApiFailure } from "@/lib/api-client";
import type { AssistantItemKind, AssistantItemView } from "@/lib/assistant-items";

const LOAD_FAILED = "Could not load more. Check your connection and try again.";
const PAGE = 20;
const DEBOUNCE_MS = 300;

/** Newest first, as the server lists them (created_at DESC, id DESC). */
const newestFirst = (a: AssistantItemView, b: AssistantItemView) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** The server's first page, then the older pages fetched here, without repeats (the server's copy wins). */
function merged(first: AssistantItemView[], older: AssistantItemView[]): AssistantItemView[] {
  const seen = new Set(first.map((x) => x.id));
  return [...first, ...older.filter((x) => !seen.has(x.id)).sort(newestFirst)];
}

export function AssistantItemsList({ orgSlug, box, kind = null, status = "all", timeZone, now, initial, highlight = null }: {
  orgSlug: string; box: "sent" | "received" | "waiting";
  kind?: AssistantItemKind | null; status?: "open" | "done" | "all";
  timeZone: string; now: number;
  initial: { items: AssistantItemView[]; nextBefore: string | null };
  /** An item to mark (a 1px orange border). */ highlight?: string | null;
}) {
  const [older, setOlder] = useState<AssistantItemView[]>([]);
  // Undefined until a page has been fetched here: until then the server's own cursor (which moves on refresh) is the one.
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  /**
   * Where the rows fetched here begin (the first page's cursor when "Show more" was first pressed). When a new item
   * pushes the server's first page down, its cursor moves past this and the rows in between belong to neither list:
   * they are fetched into `older` (correctness review, 8 October 2026).
   */
  const [from, setFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const next = cursor === undefined ? initial.nextBefore : cursor;
  const items = merged(initial.items, older);
  const olderIds = useRef(new Set<string>());
  useEffect(() => { olderIds.current = new Set(older.map((x) => x.id)); }, [older]);

  async function load() {
    if (!next || loading) return;
    setLoading(true); setFailure(null);
    try {
      const q = new URLSearchParams({ box, status, before: next, limit: String(PAGE) });
      if (kind) q.set("kind", kind);
      const r = await api<{ ready: boolean; items: AssistantItemView[]; nextBefore: string | null }>(`/api/orgs/${orgSlug}/assistant-items?${q}`, { retries: 1 });
      setOlder((cur) => merged(cur, r.items));
      setCursor(r.nextBefore);
      setFrom((f) => f ?? next);
    } catch (err) {
      setFailure(isApiFailure(err) && err.error.status < 500 ? err.error.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }

  // The first page moved down (something new arrived): fetch the rows between it and the ones fetched here.
  const firstCursor = initial.nextBefore;
  useEffect(() => {
    if (!from || !firstCursor || Date.parse(firstCursor) <= Date.parse(from)) return;
    let gone = false;
    void (async () => {
      let before = firstCursor;
      for (let i = 0; i < 3 && !gone; i++) {
        const q = new URLSearchParams({ box, status, before, limit: String(PAGE) });
        if (kind) q.set("kind", kind);
        const r = await api<{ ready: boolean; items: AssistantItemView[]; nextBefore: string | null }>(`/api/orgs/${orgSlug}/assistant-items?${q}`).catch(() => null);
        if (!r || gone) return;
        const gap = r.items.filter((x) => Date.parse(x.createdAt) >= Date.parse(from));
        setOlder((cur) => merged(cur, gap));
        // The whole gap fetched (the page reached the rows fetched here, or there is nothing older).
        if (gap.length < r.items.length || !r.nextBefore) break;
        before = r.nextBefore;
      }
      if (!gone) setFrom(firstCursor);
    })();
    return () => { gone = true; };
  }, [firstCursor, from, box, status, kind, orgSlug]);

  // An older row fetched here changed: read it again. (The first page is the server's, refreshed with the page.)
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChangeEvent>).detail;
      if (!d || d.table !== "assistant_items" || !olderIds.current.has(d.id)) return;
      pending.add(d.id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const ids = [...pending];
        pending.clear();
        for (const id of ids) {
          void api<{ item: AssistantItemView }>(`/api/orgs/${orgSlug}/assistant-items/${id}`).then(
            (r) => setOlder((cur) => cur.map((x) => (x.id === id ? r.item : x))),
            () => { /* the row keeps what it has */ },
          );
        }
      }, DEBOUNCE_MS);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { window.removeEventListener(CHANGE_EVENT, onChange); if (timer) clearTimeout(timer); };
  }, [orgSlug]);

  return (
    <div className="space-y-4">
      <ul className="-mx-2 space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <AssistantItemCard orgSlug={orgSlug} item={item} timeZone={timeZone} now={now} compact highlight={highlight === item.id}
              onChange={(v) => setOlder((cur) => (cur.some((x) => x.id === v.id) ? cur.map((x) => (x.id === v.id ? v : x)) : cur))} />
          </li>
        ))}
      </ul>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {next ? <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>Show more</Button> : null}
      <p role="status" aria-live="polite" className="sr-only">{older.length ? `Showing ${items.length}` : ""}</p>
    </div>
  );
}
