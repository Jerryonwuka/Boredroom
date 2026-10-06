"use client";

/**
 * Docs, the library (owner decision, 5 October 2026): every document the person can see, pinned ones first. v4: a
 * folder sub-nav on the left (32px items, the chosen one on fill-1; a row of pills on a phone), a search box in the
 * toolbar that narrows as you type (it lives in ?q= so a search can be shared or reloaded), and the documents as rows:
 * a 40px square, the title 14/20 semibold, a line of the text, who can see it and when it changed. One button opens a
 * fresh document in the editor. Brenda writes here too, so the empty state points at her.
 *
 * Accent rules (owner decision, 6 October 2026): "New document" is the screen's one orange button; the chosen folder
 * has the 2px orange marker. The empty library offers Brenda and writing one yourself as two outline buttons, so the
 * page never shows two primaries (polish, 6 October 2026).
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Folder, Globe, Lock, Pin, Plus, Search, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, CountPill } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { InputAdorned } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { ToolSquare } from "@/components/ui/tool-tile";
import { BrendaFace } from "@/components/app/brenda-face";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { api, isApiFailure } from "@/lib/api-client";
import { cn, relativeTime } from "@/lib/utils";
import type { DocSummary } from "@/server/services/docs";

type Visibility = DocSummary["visibility"];

/** How a document's audience reads in a row and in the editor: a lock, a team, or the whole organisation. */
export function VisibilityBadge({ visibility, teamName, className }: { visibility: Visibility; teamName?: string | null; className?: string }) {
  const Icon = visibility === "private" ? Lock : visibility === "team" ? Users : Globe;
  const text = visibility === "private" ? "Private" : visibility === "team" ? (teamName ?? "Team") : "Everyone";
  return <Badge className={cn("max-w-full", className)}><Icon className="size-3 shrink-0" aria-hidden /><span className="truncate"><span className="sr-only">Shared with: </span>{text}</span></Badge>;
}

/** "5m ago" for the last week, then the date: a document's age reads at a glance either way. */
export function updatedLabel(iso: string, now: number) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  if (now - t < 7 * 86_400_000) return relativeTime(iso, now);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" }).format(t);
}

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** The library's header (PageHeader draws settled from the first paint in v4; kept as its own name for callers). */
export function DocsHeader(props: React.ComponentProps<typeof PageHeader>) {
  return <PageHeader {...props} />;
}

/** Creates a blank document (in the folder being looked at, if any) and opens it in the editor. */
export function NewDocButton({ orgSlug, folder = null, variant = "accent", size = "sm", label = "New document" }: { orgSlug: string; folder?: string | null; variant?: "accent" | "primary" | "outline"; size?: "sm" | "md"; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant={variant} size={size} loading={pending} onClick={async () => {
        setPending(true); setError(null);
        try {
          const doc = await api<{ id: string }>(`/api/orgs/${orgSlug}/docs`, { method: "POST", body: { title: "Untitled document", ...(folder ? { folder } : {}) } });
          router.push(`/app/${orgSlug}/docs/${doc.id}?new=1`);
        } catch (err) {
          setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection and try again.");
          setPending(false);
        }
      }}>
        {pending ? null : <Plus aria-hidden />}{pending ? "Creating…" : label}
      </Button>
      {error ? <p role="alert" className="max-w-xs text-meta font-medium text-danger">{error}</p> : null}
    </div>
  );
}

export function DocsLibrary({ orgSlug, docs, folders, q, folder, now, viewerMembershipId }: {
  orgSlug: string; docs: DocSummary[]; folders: { name: string; count: number }[]; q: string; folder: string | null;
  /** The server's clock when the page rendered, so relative times match between the server and the browser. */
  now: number; viewerMembershipId: string;
}) {
  const router = useRouter();
  const base = `/app/${orgSlug}`;
  const [query, setQuery] = useState(q);
  const [pending, startTransition] = useTransition();
  // `sent` is the last search this box put in the address; `shown` the one the page last rendered. When the page
  // arrives with a search the box did not send (the Docs link in the sidebar, Back, Clear search), the box follows it;
  // a page answering the box's own search never pulls back what has been typed since.
  const [sent, setSent] = useState(q);
  const [shown, setShown] = useState(q);
  if (q !== shown) {
    setShown(q);
    if (q !== sent) { setSent(q); setQuery(q); }
  }

  const hrefFor = (next: { q?: string; folder?: string | null }) => {
    const params = new URLSearchParams();
    const nq = (next.q ?? query).trim();
    const nf = next.folder === undefined ? folder : next.folder;
    if (nq) params.set("q", nq);
    if (nf) params.set("folder", nf);
    const s = params.toString();
    return `${base}/docs${s ? `?${s}` : ""}`;
  };

  // Search as you type, a beat after the last key. Compared with what was last sent rather than the address bar, which
  // only changes once a navigation lands, so clearing the box while a search is still loading is not lost.
  useEffect(() => {
    const next = query.trim();
    if (next === sent) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (next) params.set("q", next); else params.delete("q");
      const s = params.toString();
      setSent(next);
      startTransition(() => router.replace(`${base}/docs${s ? `?${s}` : ""}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [query, sent, base, router]);

  // The server already puts pinned documents first when there is no search; a search keeps its ranking.
  const ordered = q ? docs : [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const activeFolderListed = !folder || folders.some((f) => f.name === folder);
  const folderList = activeFolderListed ? folders : [...folders, { name: folder, count: 0 }];
  const nothingAtAll = docs.length === 0 && !q && !folder;

  if (nothingAtAll) {
    return (
      <section aria-labelledby="docs-empty-heading" className="card-section flex flex-col items-center px-6 py-14 text-center">
        <BrendaFace size="lg" mood="happy" />
        <h2 id="docs-empty-heading" className="type-section-title mt-6">Nothing written yet</h2>
        <p className="mt-1 max-w-md text-balance text-sm font-normal text-secondary">Start a document yourself, or let Brenda draft it. She writes handbooks, checklists and meeting notes, and files them here for you.</p>
        <div className="mt-6 flex flex-wrap items-start justify-center gap-2">
          <Link href={`${base}/home?ask=${encodeURIComponent("Write our onboarding checklist for new starters and save it in Docs.")}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <BrendaGlyph aria-hidden />Ask Brenda to write your onboarding checklist
          </Link>
          <NewDocButton orgSlug={orgSlug} variant="outline" label="Write one yourself" />
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Folders" className="min-w-0">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0"><FolderLink href={hrefFor({ folder: null })} active={!folder} label="All documents" all /></li>
          {folderList.map((f) => <li key={f.name} className="shrink-0"><FolderLink href={hrefFor({ folder: f.name })} active={folder === f.name} label={f.name} count={f.count} /></li>)}
        </ul>
      </nav>

      <section aria-labelledby="docs-list-heading" aria-busy={pending} className="min-w-0">
        <h2 id="docs-list-heading" className="sr-only">{q ? `Documents matching ${q}` : folder ? `Documents in ${folder}` : "Documents"}</h2>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <form role="search" className="w-full sm:max-w-sm" onSubmit={(e) => e.preventDefault()} data-refresh-safe>
            <InputAdorned fieldSize="lg" type="search" autoComplete="off" enterKeyHint="search" maxLength={200} aria-label="Search documents"
              placeholder="Search titles and text" value={query} prefix={<Search aria-hidden />}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }} />
          </form>
          <p className="ml-auto text-meta font-normal tabular-nums text-secondary" aria-live="polite">
            {q ? `${docs.length} ${docs.length === 1 ? "document matches" : "documents match"} your search` : `${docs.length} ${docs.length === 1 ? "document" : "documents"}`}
          </p>
        </div>

        <div className={cn("transition-opacity duration-150", pending && "opacity-60")}>
          {docs.length === 0 ? (
            q ? (
              <EmptyState icon={Search} title={`Nothing matches “${q}”`} description={folder ? `Nothing in ${folder} uses those words. Try other words, or search every folder.` : "Try other words, or ask Brenda: she can find and summarise any document you can see."}
                action={<Link href={folder ? hrefFor({ folder: null }) : hrefFor({ q: "" })} onClick={() => { if (!folder) setQuery(""); }} className={buttonVariants({ variant: "secondary", size: "sm" })}>{folder ? "Search every folder" : "Clear search"}</Link>} />
            ) : (
              <EmptyState icon={Folder} title={`${folder} is empty`} description="Documents filed in this folder appear here. Set a document's folder in its editor."
                action={<Link href={hrefFor({ folder: null })} className={buttonVariants({ variant: "secondary", size: "sm" })}>All documents</Link>} />
            )
          ) : (
            <>
              <div aria-hidden className="hidden h-9 items-center gap-3 border-b border-border px-2 text-sm font-medium text-secondary md:flex">
                <span className="min-w-0 flex-1 pl-[52px]">Name</span><span className="w-36">Shared with</span><span className="w-28 text-right">Updated</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {ordered.map((d) => <DocRow key={d.id} doc={d} base={base} now={now} mine={d.createdBy.membershipId === viewerMembershipId} />)}
              </ul>
              {q ? <p className="mt-4 text-meta font-normal text-secondary"><Link href={hrefFor({ q: "" })} onClick={() => setQuery("")} className="link-inline">Clear search</Link></p> : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** A folder in the sub-nav: 32px, r8; the chosen one on fill-1 in the foreground with the orange marker (a pill on a phone). */
function FolderLink({ href, active, label, count, all = false }: { href: string; active: boolean; label: string; count?: number; all?: boolean }) {
  const Icon = all ? FileText : Folder;
  return (
    <Link href={href} scroll={false} aria-current={active ? "page" : undefined}
      className={cn("flex h-8 max-w-[16rem] items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors duration-75 pointer-coarse:h-10 md:max-w-none [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "selected-marker bg-fill-1 text-foreground" : "text-secondary hover:bg-fill-0 hover:text-foreground")}>
      <Icon aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <CountPill count={count} /> : null}
    </Link>
  );
}

function DocRow({ doc, base, now, mine }: { doc: DocSummary; base: string; now: number; mine: boolean }) {
  const updated = toIso(doc.updatedAt);
  return (
    <li>
      <Link href={`${base}/docs/${doc.id}`} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3 transition-colors duration-75 hover:bg-fill-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">
        <ToolSquare><FileText /></ToolSquare>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{doc.title}</span>
            {doc.pinned ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-secondary"><Pin className="size-3.5" aria-hidden />Pinned</span> : null}
          </span>
          <span className="block truncate text-meta font-normal text-secondary">{doc.excerpt || "Nothing written yet."}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta font-normal text-secondary md:hidden">
            <VisibilityBadge visibility={doc.visibility} teamName={doc.teamName} />
            <span className="truncate">{mine ? "You" : doc.createdBy.name}, <time dateTime={updated} suppressHydrationWarning>{updatedLabel(updated, now)}</time></span>
          </span>
          {doc.folder ? <span className="sr-only">Folder: {doc.folder}.</span> : null}
        </span>
        <span className="hidden w-36 shrink-0 md:block"><VisibilityBadge visibility={doc.visibility} teamName={doc.teamName} /></span>
        <span className="hidden w-28 shrink-0 text-right text-meta font-normal text-secondary md:block">
          <time dateTime={updated} suppressHydrationWarning className="block tabular-nums">{updatedLabel(updated, now)}</time>
          <span className="block truncate">{mine ? "You" : doc.createdBy.name}</span>
        </span>
      </Link>
    </li>
  );
}
