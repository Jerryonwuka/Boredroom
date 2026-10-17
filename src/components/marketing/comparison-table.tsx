import { isValidElement } from "react";
import { Check, Minus, X } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A fact about a cell, never a verdict: "No screenshots" is a `no` even when it favours Boredroom. */
export type Mark = "yes" | "no" | "partial";
export type MarkCell = { mark?: Mark; /** The partial mark's word ("Add-on", "Optional", "Partly"); "Partly" by default. */ markLabel?: string; text?: React.ReactNode };
export type Cell = React.ReactNode | MarkCell;
export type ComparisonColumn = { key: string; label: string; /** Boredroom's own column: on fill-0 with the mark, neutral (never orange). */ ours?: boolean };
export type ComparisonRow = { label?: React.ReactNode; cells: Record<string, Cell> };

const isMarkCell = (c: Cell): c is MarkCell =>
  !!c && typeof c === "object" && !isValidElement(c) && !Array.isArray(c) && ("mark" in c || "text" in c || "markLabel" in c);

const MARK_WORD: Record<Exclude<Mark, "partial">, string> = { yes: "Yes", no: "No" };

/** A cell's content: the mark (an icon with its word for assistive technology, or a neutral badge), then the text. */
function CellBody({ cell }: { cell: Cell }) {
  if (!isMarkCell(cell)) return <>{cell}</>;
  const { mark, markLabel, text } = cell;
  const hasText = text !== undefined && text !== null && text !== "";
  const markEl = !mark ? null
    : mark === "partial" ? <Badge className="mr-1.5 align-[1px]">{markLabel ?? "Partly"}</Badge>
    : (
      <span className="mr-1.5 inline-flex items-center gap-1 align-[-3px]">
        {mark === "yes" ? <Check aria-hidden className="size-4 shrink-0 text-foreground" strokeWidth={2.25} /> : <Minus aria-hidden className="size-4 shrink-0 text-subtle" strokeWidth={2.25} />}
        {/* A word beside every mark: visible when the cell has no text of its own, read out either way. */}
        <span className={hasText ? "sr-only" : "text-foreground"}>{MARK_WORD[mark]}{hasText ? ": " : ""}</span>
      </span>
    );
  return <>{markEl}{hasText ? text : null}</>;
}

/** A cell as a list item (the phone version of a two-list table): the mark as a check or a cross, then the text. */
function ListCell({ cell }: { cell: Cell }) {
  if (!isMarkCell(cell) || cell.mark === "partial" || !cell.mark) return <li data-plain className="text-sm leading-5 text-foreground"><CellBody cell={cell} /></li>;
  const Icon = cell.mark === "yes" ? Check : X;
  const hasText = cell.text !== undefined && cell.text !== null && cell.text !== "";
  return (
    <li data-plain className="flex gap-3 text-sm leading-5 text-foreground">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", cell.mark === "yes" ? "text-foreground" : "text-subtle")} strokeWidth={2.25} />
      <span className="min-w-0">{hasText ? cell.text : MARK_WORD[cell.mark]}</span>
    </li>
  );
}

function OursHead({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex"><LogoArt variant="mark" height={14} alt="Boredroom" loading="lazy" /></span>
      {label}
    </span>
  );
}

const TH = "border-b border-border bg-fill-0 px-4 py-3 text-left align-bottom text-[13px] font-medium leading-5 text-foreground";

/**
 * A comparison table (owner feedback, 17 October 2026: pages v2; the reference's capability table and comparison
 * matrix in Boredroom's look): a real <table> with a visible caption and scoped headers in a named region that scrolls
 * on its own (keyboard too), never the page. An r20 hairline card, the header row on fill-0, rows split by hairlines,
 * figures in tabular numbers. Boredroom's column (`ours`) sits on fill-0 with the mark: neutral, it is ours, not
 * "chosen". Cells are text, or `{ mark, text }` for a yes / no / partly fact (an icon with its word, neutral).
 *
 * `layout="matrix"`: any number of columns; scrolls inside its region, the first column held at the left. `minWidth`
 * sets the table's width before it scrolls ("78rem" for the category's six tools).
 * `layout="versus"`: two subjects side by side (14/20 cells); below 640px the table gives way to a stacked list (a card
 * per row with "Boredroom: …" and "ActivTrak: …"), and only one of the two is ever exposed.
 * `rowHeader={null}`: no row-header column (a records / never-records table); with `versus`, phones get the columns
 * as two lists, each under its label (the check / crossed-list styling), not cards that pair unrelated items.
 * The scroll region is `relative`, so the marks' absolutely placed sr-only words stay inside it and are clipped.
 * Facts about others keep their `<AsOf>` (in the caption) and the page keeps its `Sources`.
 */
export function ComparisonTable({ label, caption, rowHeader = "Question", columns, rows, layout = "matrix", minWidth, footnote, className }: {
  /** The scroll region's accessible name ("Boredroom vs ActivTrak comparison table"). */
  label: string;
  caption?: React.ReactNode;
  /** The first column's heading; null for no row-header column. */
  rowHeader?: string | null;
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  layout?: "matrix" | "versus";
  /** The table's minimum width before it scrolls (matrix), e.g. "78rem". */
  minWidth?: string;
  /** Under the card in the secondary grey (notes, a source line). */
  footnote?: React.ReactNode;
  className?: string;
}) {
  const versus = layout === "versus";
  const hasRowHead = rowHeader !== null;
  const TD = cn("border-b border-border px-4 py-3.5 align-top text-secondary", versus ? "text-sm leading-5" : "text-[13px] leading-5");
  const table = (
    <div role="region" aria-label={label} tabIndex={0}
      className={cn("relative overflow-x-auto rounded-[20px] border border-border bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", versus && "max-sm:hidden")}>
      <table className="w-full border-collapse tabular-nums [&_tbody_tr:last-child>*]:border-b-0" style={minWidth ? { minWidth } : versus ? undefined : { minWidth: "40rem" }}>
        {caption ? <caption className="mk-links px-4 pb-3 pt-4 text-left text-[13px] leading-5 text-secondary">{caption}</caption> : null}
        <thead>
          <tr>
            {hasRowHead ? <th scope="col" className={cn(TH, "sticky left-0 z-[1] bg-background shadow-[inset_0_0_0_100vmax_var(--fill-0)]", versus ? "w-[26%]" : "w-44")}>{rowHeader}</th> : null}
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(TH, c.ours && "bg-fill-1")}>{c.ours ? <OursHead label={c.label} /> : c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {hasRowHead ? (
                <th scope="row" className={cn("sticky left-0 z-[1] border-b border-border bg-background px-4 py-3.5 text-left align-top font-medium text-foreground", versus ? "text-sm leading-5" : "text-[13px] leading-5")}>{r.label}</th>
              ) : null}
              {columns.map((c) => (
                <td key={c.key} className={cn(TD, c.ours && "bg-fill-0")}><CellBody cell={r.cells[c.key]} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className={cn("min-w-0", className)}>
      {table}
      {versus && !hasRowHead ? (
        // Phones, two separate lists (does / never does): each column as its own list under its label, so no item reads
        // as the reverse of the one beside it (review fix, 17 October 2026). The table above is hidden there.
        <div className="sm:hidden">
          {caption ? <p className="mk-links mb-3 text-[13px] leading-5 text-secondary">{caption}</p> : null}
          <div className="space-y-2">
            {columns.map((c) => (
              <div key={c.key} className={cn("rounded-2xl border border-border p-4", c.ours ? "bg-fill-0" : "bg-background")}>
                <p className="text-sm font-semibold text-foreground">{c.label}</p>
                <ul aria-label={c.label} data-plain className="mt-3 space-y-2.5">
                  {rows.map((r, i) => <ListCell key={i} cell={r.cells[c.key]} />)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : versus ? (
        // Phones: the same facts as a list of small cards (the table above is hidden there, so only one is exposed).
        <div className="sm:hidden">
          {caption ? <p className="mk-links mb-3 text-[13px] leading-5 text-secondary">{caption}</p> : null}
          <ul aria-label={label} className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="rounded-2xl border border-border bg-background p-4">
                {hasRowHead && r.label ? <p className="text-sm font-semibold text-foreground">{r.label}</p> : null}
                <dl className={cn("space-y-2.5", hasRowHead && r.label && "mt-2.5")}>
                  {columns.map((c) => (
                    <div key={c.key} className={cn(c.ours && "-mx-2 rounded-xl bg-fill-0 px-2 py-1.5")}>
                      <dt className="text-xs font-medium text-secondary">{c.label}</dt>
                      <dd className="mt-0.5 text-sm leading-5 text-foreground"><CellBody cell={r.cells[c.key]} /></dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {footnote ? <div className="mk-links mt-3 text-meta font-normal text-secondary">{footnote}</div> : null}
    </div>
  );
}
