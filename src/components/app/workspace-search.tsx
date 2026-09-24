"use client";

/**
 * Top-bar search on Aceternity's gooey input: pages by name at once, then tasks, people, projects and teams from the
 * server as you type. Enter opens the first result; Escape closes.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, User, FolderKanban, Users, LayoutGrid } from "lucide-react";
import { GooeyInput } from "@/components/aceternity/gooey-input";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SearchHit, SearchResult } from "@/server/services/search";

type Hit = SearchHit | { kind: "page"; id: string; title: string; hint: string | null; href: string };
const ICON: Record<Hit["kind"], typeof ListChecks> = { page: LayoutGrid, task: ListChecks, person: User, project: FolderKanban, team: Users };
const SURFACE = "border border-border bg-[linear-gradient(180deg,var(--btn-top),var(--btn-bottom))] text-fg shadow-[inset_0_1px_0_var(--highlight)] ring-0";

export function WorkspaceSearch({ orgSlug, pages, className }: { orgSlug: string; pages: { label: string; href: string }[]; className?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // Results are kept with the term they answer, so stale answers never show and nothing is reset in an effect.
  const [remote, setRemote] = useState<{ term: string; hits: SearchHit[] }>({ term: "", hits: [] });
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const term = q.trim().toLowerCase();
  const remoteHits = q.trim().length >= 2 && remote.term === q.trim() ? remote.hits : [];
  const busy = q.trim().length >= 2 && remote.term !== q.trim();
  const pageHits: Hit[] = term ? pages.filter((p) => p.label.toLowerCase().includes(term)).slice(0, 4).map((p) => ({ kind: "page", id: p.href, title: p.label, hint: "Page", href: p.href })) : [];
  const hits: Hit[] = [...pageHits, ...remoteHits];
  const showList = open && term.length > 0;

  return (
    <div ref={ref} className={cn("relative", className)} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQ(""); } if (e.key === "Enter" && hits[0]) { e.preventDefault(); setOpen(false); setQ(""); router.push(hits[0].href); } }}>
      <GooeyInput placeholder="Search tasks, people…" value={q} onValueChange={setQ} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }} collapsedWidth={44} expandedWidth={260} expandedOffset={48}
        classNames={{ trigger: cn(SURFACE, "px-3"), input: "text-fg placeholder:text-fg-subtle", bubbleSurface: SURFACE }} />
      {showList ? (
        <div role="listbox" aria-label="Search results" className="tile absolute right-0 top-[calc(100%+8px)] z-[var(--z-dropdown)] w-[22rem] max-w-[calc(100vw-2rem)] p-1.5">
          {hits.length === 0 ? <p className="px-3 py-3 text-sm text-fg-muted">{busy ? "Searching…" : term.length < 2 ? "Keep typing." : `Nothing matches “${q.trim()}”.`}</p> : (
            <ul className="max-h-[22rem] overflow-y-auto">
              {hits.map((h) => { const Icon = ICON[h.kind]; return (
                <li key={`${h.kind}-${h.id}`}>
                  <Link role="option" aria-selected={false} href={h.href} onClick={() => { setOpen(false); setQ(""); }} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 hover:bg-wash">
                    <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.title}</span>{h.hint ? <span className="block truncate text-xs text-fg-subtle">{h.hint}</span> : null}</span>
                  </Link>
                </li>
              ); })}
            </ul>
          )}
          {busy && hits.length ? <p className="px-3 pb-1 pt-1.5 text-[11px] text-fg-subtle">Searching…</p> : null}
        </div>
      ) : null}
    </div>
  );
}
