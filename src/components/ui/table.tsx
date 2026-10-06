import { cn } from "@/lib/utils";

/**
 * A table, v4 (spec §7 Tables; styles on `table.data` in globals.css): no outer border, a 36px head row with a hairline
 * under it, headers 14/20 medium in the secondary grey, 48px rows of 14/20 regular with no lines and no hover fill,
 * the first column flush left. The wrapper scrolls sideways when the columns need more room than the page has.
 * In a padded card the first column lines up with the card's content; in a card with no padding (Card variant="plain",
 * or anything with `data-flush`) the outer columns take 20px. Put a ghost "…" IconButton (or a Menu) in the last cell for row actions, and Switches inline.
 * `fit`: the table fills its box and long cells truncate instead of scrolling (give the cells `truncate`).
 */
export function DataTable({ children, className, caption, fit = false }: { children: React.ReactNode; className?: string; caption?: string; fit?: boolean }) {
  return (
    // `relative` keeps absolutely positioned bits in the cells (the sr-only "Actions" header) inside the scroller;
    // without it they escape to the page and widen it on a phone.
    <div className={cn("relative min-w-0 overflow-x-auto", fit && "data-fit", className)}>
      <table className="data">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
