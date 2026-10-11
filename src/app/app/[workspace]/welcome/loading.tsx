import { LogoArt } from "@/components/logo";
import { Skeleton } from "@/components/ui/states";

/**
 * The welcome's own skeleton (owner request, 11 October 2026: the first-run welcome; contract 4.1): the workspace's one
 * draws a sidebar, which the welcome has not got. The 56px top bar with the logo, the stage (a quiet panel with her round
 * place in the middle; a band on phones) and the card (step line, title, two lines of lede, a button), where the page will
 * put them, so nothing jumps.
 */
export default function WelcomeLoading() {
  return (
    <div className="min-h-dvh bg-background" role="status">
      <span className="sr-only">Loading</span>
      <div aria-hidden className="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-4 sm:px-5">
        <LogoArt height={16} />
        <Skeleton className="mx-auto h-1 w-full max-w-[240px] rounded-full min-[860px]:max-w-[880px]" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <div aria-hidden className="flex flex-col px-4 pb-5 pt-4 sm:px-5 min-[860px]:grid min-[860px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] min-[860px]:gap-6">
        <div className="flex min-w-0 flex-col pt-6 min-[860px]:order-2 min-[860px]:min-h-[calc(100dvh-92px)] min-[860px]:justify-center min-[860px]:py-10 min-[860px]:pl-[8%]">
          <div className="w-full max-w-[500px]">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-2 h-9 w-72 max-w-full" />
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-3/4" />
            <Skeleton className="mt-8 h-10 w-40 rounded-xl" />
          </div>
        </div>
        <div className="order-first flex items-center gap-4 rounded-[22px] border border-border bg-sidebar p-4 min-[860px]:sticky min-[860px]:top-[72px] min-[860px]:h-[calc(100dvh-92px)] min-[860px]:min-h-[520px] min-[860px]:flex-col min-[860px]:justify-center">
          <Skeleton className="size-[88px] shrink-0 rounded-full min-[860px]:size-[120px]" />
          <div className="grid flex-1 gap-2 min-[860px]:hidden"><Skeleton className="h-6 w-24" /><Skeleton className="h-10 w-full rounded-2xl" /></div>
        </div>
      </div>
    </div>
  );
}
