"use client";

/**
 * Loads the call stage on the client only (owner decisions, 8 October 2026: phase 8, calls; contract D.6): the stage draws
 * LiveKit's room, which belongs to the browser, so it is never rendered on the server (`ssr: false` is only allowed in a
 * Client Component, hence this file). A skeleton holds its place meanwhile.
 */
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/states";
import type { CallStageProps } from "@/components/app/call-stage";

const CallStage = dynamic(() => import("@/components/app/call-stage").then((m) => m.CallStage), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center p-5" aria-busy aria-label="Loading the call">
      <div className="grid w-full max-w-sm justify-items-center gap-3 rounded-3xl border border-border p-6">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-9 w-28 rounded-[10px]" />
      </div>
    </div>
  ),
});

export function CallStageLoader(props: CallStageProps) {
  return <CallStage {...props} />;
}
