import { LogoArt } from "@/components/logo";
import { Skeleton } from "@/components/ui/states";

/**
 * The skeleton shown while a workspace page renders, v4: the same frame as the page, so nothing jumps. The workspace
 * layout passes children straight through and every page draws its own shell, so this stands in for all of it: the
 * sidebar (a 56px rail when the person collapsed it, read from the <html data-sidebar> the real one uses) with the
 * logo and the nav rows, the 50px top bar with the breadcrumb, the search and the icons, then a page header with its
 * tabs, three stat cards and an analytics card, each where the page will put them.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex min-h-dvh" role="status">
      <span className="sr-only">Loading</span>
      <aside aria-hidden className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar md:flex [[data-sidebar=collapsed]_&]:w-14">
        <div className="flex h-[50px] shrink-0 items-center pl-[18px] in-data-[sidebar=collapsed]:justify-center in-data-[sidebar=collapsed]:pl-0">
          <LogoArt height={16} className="in-data-[sidebar=collapsed]:hidden" />
          <LogoArt variant="mark" height={18} className="hidden in-data-[sidebar=collapsed]:inline-flex" />
        </div>
        <div className="space-y-1 px-3 pt-1">
          {["w-16", "w-[88px]", "w-[72px]", "w-24"].map((w) => <NavRow key={w} width={w} />)}
          <Skeleton className="mb-1 ml-1.5 mt-5 h-3.5 w-12 in-data-[sidebar=collapsed]:hidden" />
          {["w-14", "w-20", "w-12", "w-[76px]"].map((w) => <NavRow key={w} width={w} />)}
        </div>
        <div className="mt-auto p-3">
          <div className="flex h-8 items-center gap-2 px-2 in-data-[sidebar=collapsed]:px-1.5"><Skeleton className="size-5 shrink-0 rounded-full" /><Skeleton className="h-3.5 w-24 in-data-[sidebar=collapsed]:hidden" /></div>
        </div>
      </aside>
      <div aria-hidden className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-[var(--z-sticky)] grid h-[50px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex items-center gap-2"><Skeleton className="size-8 rounded-[10px]" /><Skeleton className="h-3.5 w-28" /></div>
          <Skeleton className="hidden h-8 w-[230px] rounded-xl lg:block" />
          <div className="flex items-center justify-end gap-1"><Skeleton className="size-8 rounded-[10px]" /><Skeleton className="size-8 rounded-[10px]" /><Skeleton className="ml-1 size-8 rounded-full" /></div>
        </div>
        <div className="w-full flex-1 px-5 pb-16 pt-6">
          <div className="flex min-h-9 items-center"><Skeleton className="h-6 w-48 max-w-full" /></div>
          <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
          <div className="mb-8 mt-5 flex gap-6 border-b border-border pb-2.5">{["w-16", "w-[52px]", "w-[76px]"].map((w) => <Skeleton key={w} className={`h-3.5 ${w}`} />)}</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card-stat"><Skeleton className="h-3.5 w-24" /><Skeleton className="mt-2.5 h-6 w-20" /></div>)}
          </div>
          <div className="card-panel mt-3 overflow-hidden p-0">
            <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-fill-0 p-4 max-sm:[&:nth-child(n+3)]:hidden"><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-5 w-14" /></div>)}
            </div>
            <div className="p-5"><Skeleton className="h-56 w-full rounded-xl" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavRow({ width }: { width: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 in-data-[sidebar=collapsed]:w-8 in-data-[sidebar=collapsed]:px-[7px]">
      <Skeleton className="size-[18px] shrink-0 rounded-md" />
      <Skeleton className={`h-3.5 ${width} in-data-[sidebar=collapsed]:hidden`} />
    </div>
  );
}
