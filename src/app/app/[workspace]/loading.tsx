import { Skeleton } from "@/components/ui/states";

/** Structural skeleton shown while a workspace page renders: same shape as the page, so nothing jumps. */
export default function WorkspaceLoading() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
      <aside className="hidden w-64 shrink-0 border-r border-border px-4 py-5 md:block">
        <Skeleton className="mb-6 h-6 w-32" />
        <Skeleton className="mb-5 h-12 w-full" />
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="mb-3 h-9 w-72" />
        <Skeleton className="mb-8 h-4 w-96 max-w-full" />
        <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
        <Skeleton className="mt-6 h-64 w-full" />
      </main>
    </div>
  );
}
