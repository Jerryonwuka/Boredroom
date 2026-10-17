import { LogoArt } from "@/components/logo";
import { formatDate } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * "Boredroom vs …" as a lockup (owner feedback, 17 October 2026: pages v2; the reference's logo-vs-logo hero): our
 * wordmark, a round "vs", then the other product's **name** in an outline pill. No other company's logo (rights and
 * fairness). With `asOf`, the line under it says where the facts about them come from and when they were read.
 * `size="sm"` is the index card's small version (no caption).
 *
 *   <VersusLockup them="ActivTrak" asOf={AS_OF} />
 */
export function VersusLockup({ them, asOf, size = "md", align = "center", className }: { them: string; asOf?: string; size?: "sm" | "md"; /** "start" in a left-aligned section head. */ align?: "center" | "start"; className?: string }) {
  const sm = size === "sm";
  const start = align === "start";
  return (
    <div className={cn("flex flex-col", start ? "items-start" : "items-center text-center", className)}>
      <p className={cn("flex flex-wrap items-center", start ? "justify-start" : "justify-center", sm ? "gap-2" : "gap-3")}>
        <LogoArt height={sm ? 14 : 20} alt="Boredroom" loading={sm ? "lazy" : "eager"} />
        <span className={cn("grid shrink-0 place-items-center rounded-full border border-border font-medium text-secondary", sm ? "size-7 text-[11px]" : "size-9 text-xs")}>vs</span>
        <span className={cn("inline-flex items-center rounded-full border border-border-input font-medium text-foreground", sm ? "h-8 px-3 text-meta" : "h-10 px-4 text-sm")}>{them}</span>
      </p>
      {asOf && !sm ? <p className="mt-3 text-meta font-normal text-secondary">From {them}&apos;s own pricing and help pages, as of <time dateTime={asOf}>{formatDate(asOf)}</time>.</p> : null}
    </div>
  );
}
