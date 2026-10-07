"use client";

/**
 * Search everything, v4 (spec §6): the top bar's centred button (32px, 230px, r12, outline, "Search everything…" and
 * the ⌘ K keys) opens a command palette: a popover-surface dialog near the top of the screen, a field, then the
 * results in groups (Pages, Tasks, People, Projects, Teams) as 32px rows, and the keys along the bottom.
 *
 * Empty, it lists the workspace's pages. Typing filters the pages at once and asks the server for tasks, people,
 * projects and teams (from two letters, after a short pause). ↑ ↓ move through the results while the field keeps
 * focus (a combobox with aria-activedescendant), Enter opens one, Escape or a click outside closes and hands focus
 * back to the button that opened it. ⌘K (Ctrl+K elsewhere) opens it from anywhere. When nothing matches and Brenda is
 * on, the last row hands the question to her, under the name the person gave their own assistant (owner decision,
 * 7 October 2026: personal assistants; `useAssistant`).
 *
 * Controlled: the top bar owns `open`, so its phone search icon and the wide button open the same palette.
 *
 * Accent rules (6 October 2026): the button's keyboard focus ring is orange; in the palette the magnifier turns orange
 * while the field has focus, and the highlighted result (the one Enter opens) carries the 2px orange marker.
 *
 * Icons are animated (owner request, 7 October 2026; components/ui/animated-icons): the button's magnifier plays on
 * hover and keyboard focus; a result's icon plays when it becomes the highlighted one (by arrow keys or the pointer).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { AnimatedFolderKanban, AnimatedLayoutGrid, AnimatedListChecks, AnimatedSearch, AnimatedUser, AnimatedUsers } from "@/components/ui/animated-icons";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { useAssistant } from "@/components/app/assistant-context";
import { Kbd } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SearchHit, SearchResult } from "@/server/services/search";

type Kind = SearchHit["kind"] | "page" | "brenda";
type Hit = { kind: Kind; id: string; title: string; hint: string | null; href: string };
const ICON: Record<Kind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { page: AnimatedLayoutGrid, task: AnimatedListChecks, person: AnimatedUser, project: AnimatedFolderKanban, team: AnimatedUsers, brenda: BrendaGlyph };
// The "brenda" group is headed by the person's own assistant's name (WorkspaceSearch).
const GROUP: Record<Exclude<Kind, "brenda">, string> = { page: "Pages", task: "Tasks", person: "People", project: "Projects", team: "Teams" };
const FIELD_NAME = "Search pages, tasks, people, projects and teams";
export const SEARCH_DIALOG_ID = "workspace-search";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
const noSubscribe = () => () => {};
/** The modifier key's symbol: ⌘ on Apple devices, Ctrl elsewhere (⌘ while the page hydrates). */
function useModKey() {
  return useSyncExternalStore(noSubscribe, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘");
}

/** The top bar's search button: 32px, 230px, r12, outline, the 13px prompt and the shortcut's keys. */
export function SearchTrigger({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const mod = useModKey();
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-controls={SEARCH_DIALOG_ID} aria-keyshortcuts={mod === "⌘" ? "Meta+K" : "Control+K"}
      className={cn("flex h-8 w-[230px] items-center gap-2 rounded-xl border border-border-input bg-background pl-3 pr-1.5 text-meta font-normal text-secondary transition-colors duration-75 hover:border-border-input-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", className)}>
      <AnimatedSearch className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">Search everything…</span>
      <span className="flex shrink-0 gap-1" aria-hidden><Kbd>{mod}</Kbd><Kbd>K</Kbd></span>
    </button>
  );
}

export function WorkspaceSearch({ orgSlug, pages, brenda = false, open, onOpenChange }: {
  orgSlug: string; pages: { label: string; href: string; group?: string }[];
  /** Brenda is on for this workspace: a search that finds nothing offers to hand the question to her. */ brenda?: boolean;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { name } = useAssistant().personal;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  // Results are kept with the term they answer, so stale answers never show and nothing is reset in an effect.
  const [remote, setRemote] = useState<{ term: string; hits: SearchHit[] }>({ term: "", hits: [] });
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const listId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try { const r = await api<SearchResult>(`/api/orgs/${orgSlug}/search?q=${encodeURIComponent(term)}`); if (id === seq.current) setRemote({ term, hits: r.hits }); }
      catch { if (id === seq.current) setRemote({ term, hits: [] }); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, orgSlug]);

  // ⌘K / Ctrl+K: opens the palette, or puts the cursor back in its field when it is already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (dialog.current?.open) input.current?.select(); else onOpenChange(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const term = q.trim();
  const lower = term.toLowerCase();
  const remoteHits = term.length >= 2 && remote.term === term ? remote.hits : [];
  const busy = term.length >= 2 && remote.term !== term;
  const pageHits: Hit[] = (lower ? pages.filter((p) => p.label.toLowerCase().includes(lower)).slice(0, 5) : pages)
    .map((p) => ({ kind: "page", id: p.href, title: p.label, hint: p.group ?? null, href: p.href }));
  const found: Hit[] = [...pageHits, ...remoteHits];
  const nothing = !busy && term.length >= 2 && found.length === 0;
  const hits: Hit[] = nothing && brenda
    ? [{ kind: "brenda", id: "ask", title: `Ask ${name} to find “${term}”`, hint: null, href: `/app/${orgSlug}/home?ask=${encodeURIComponent(`Find “${term}” in this workspace and tell me where it is.`)}` }]
    : found;
  const at = Math.min(active, hits.length - 1);
  const optionId = (i: number) => `${listId}-o${i}`;
  const status = !term ? "" : busy && !found.length ? "Searching…" : term.length < 2 && !found.length ? "Keep typing." : nothing ? `Nothing matches “${term}”.` : `${found.length} result${found.length === 1 ? "" : "s"}`;

  const close = () => { onOpenChange(false); setQ(""); setActive(0); };
  const go = (h: Hit) => { close(); router.push(h.href); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hits[at]) { e.preventDefault(); go(hits[at]); return; }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length) {
      e.preventDefault();
      const next = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      setActive(next);
      requestAnimationFrame(() => document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" }));
    }
  };

  // Consecutive hits of a kind make a group.
  const groups: { kind: Kind; items: { hit: Hit; index: number }[] }[] = [];
  hits.forEach((hit, index) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === hit.kind) last.items.push({ hit, index }); else groups.push({ kind: hit.kind, items: [{ hit, index }] });
  });

  return (
    <dialog ref={dialog} id={SEARCH_DIALOG_ID} aria-label="Search"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClose={() => { if (open) close(); }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}
      className="popover-surface fixed inset-x-0 bottom-auto top-[min(12dvh,120px)] m-0 mx-auto h-fit max-h-[min(560px,calc(100dvh-24px))] w-[min(640px,calc(100vw-24px))] max-w-none overflow-hidden border-0 p-0 text-foreground backdrop:bg-overlay open:flex open:animate-[pop-in_var(--duration-menu)_var(--ease-out)_both] open:flex-col">
      {open ? (
        <>
          <div className="group/field flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-secondary transition-colors duration-75 group-focus-within/field:text-accent" aria-hidden />
            <input ref={input} autoFocus type="text" role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant={hits[at] ? optionId(at) : undefined}
              aria-label={FIELD_NAME} placeholder="Search pages, tasks, people…" autoComplete="off" spellCheck={false} enterKeyHint="go"
              value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
              className="h-full min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-subtle sm:text-sm" />
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </div>
          <p role="status" className="sr-only">{status}</p>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1">
            {nothing ? <p className="px-2 py-2 text-sm font-normal text-secondary">{`Nothing matches “${term}”.`}</p> : null}
            {term && term.length < 2 && !found.length ? <p className="px-2 py-2 text-sm font-normal text-secondary">Keep typing.</p> : null}
            <div role="listbox" id={listId} aria-label="Results">
              {groups.map((g) => (
                <div key={`${g.kind}-${g.items[0].index}`} role="group" aria-labelledby={`${listId}-g${g.items[0].index}`}>
                  <div id={`${listId}-g${g.items[0].index}`} className="menu-label">{g.kind === "brenda" ? name : GROUP[g.kind]}</div>
                  {g.items.map(({ hit, index }) => {
                    const Icon = ICON[hit.kind];
                    return (
                      <div key={`${hit.kind}-${hit.id}`} id={optionId(index)} role="option" aria-selected={index === at} data-active={index === at ? "" : undefined}
                        onMouseMove={() => { if (index !== at) setActive(index); }} onClick={() => go(hit)} className={cn("menu-item", index === at && "selected-marker")}>
                        <Icon aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                        {hit.hint ? <span className="ml-3 max-w-[45%] shrink-0 truncate text-meta font-normal text-secondary">{hit.hint}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {busy ? <p className="px-2 pb-1.5 pt-2 text-xs text-subtle">Searching…</p> : null}
          </div>
          <div className="hidden shrink-0 items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-subtle sm:flex" aria-hidden>
            <span className="flex items-center gap-1.5"><span className="flex gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>to move</span>
            <span className="flex items-center gap-1.5"><Kbd>↵</Kbd>to open</span>
            <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd>to close</span>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
