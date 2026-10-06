import { cn, formatDateTime } from "@/lib/utils";

/**
 * Due dates, v4 polish (6 October 2026): an overdue date is never red text. The date keeps the colour of the text it
 * sits in, and a small red dot marks it overdue, always beside the word (a "Overdue" label, a column, or the words
 * "overdue since"), so colour never carries the meaning alone. Where the word itself should stand out, put a
 * `Badge tone="danger"` "Overdue" beside it instead.
 *
 * - `OverdueDot`: the 6px red dot, for a line that already says "overdue".
 * - `DueDate`: the date, with the dot before it when overdue; says "Overdue" to screen readers unless `srLabel={false}`
 *   (the label beside it already says so).
 */
export function OverdueDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full bg-danger align-middle", className)} />;
}

export function DueDate({ iso, timeZone, overdue = false, srLabel = true, className }: { iso: string; timeZone: string; overdue?: boolean; srLabel?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", className)}>
      {overdue ? <><OverdueDot />{srLabel ? <span className="sr-only">Overdue, due </span> : null}</> : null}
      {formatDateTime(iso, timeZone)}
    </span>
  );
}
