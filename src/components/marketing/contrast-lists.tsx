import { CheckList } from "@/components/marketing/blocks";
import { cn } from "@/lib/utils";

/**
 * Two lists side by side (owner feedback, 17 October 2026: pages v2; the reference's "in balance" cards): "Choose X if…"
 * and "Choose Boredroom if…", "Who it is for", "What each requires". Two r20 hairline cards on fill-0 (stacked below
 * 768px), an h3 title, a CheckList (`tone: "never"` uses the crossed list). The same weight on both sides. Tables that
 * were tables for a reason (records / never records) stay tables (ComparisonTable): AI answers cite tables.
 *
 *   <ContrastLists lists={[{ title: "Choose ActivTrak if…", items: [...] }, { title: "Choose Boredroom if…", items: [...] }]} />
 */
export function ContrastLists({ lists, headingLevel = "h3", className }: {
  lists: readonly { title: string; items: readonly React.ReactNode[]; tone?: "does" | "never"; intro?: React.ReactNode; footer?: React.ReactNode }[];
  headingLevel?: "h3" | "h4";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div className={cn("grid gap-3 md:grid-cols-2", className)}>
      {lists.map((l) => (
        <div key={l.title} className="lp-reveal min-w-0 rounded-[20px] border border-border bg-fill-0 p-6 sm:p-7">
          <Heading className="lp-h3">{l.title}</Heading>
          {l.intro ? <div className="lp-text mk-links mt-2">{l.intro}</div> : null}
          <CheckList items={l.items} negative={l.tone === "never"} className="lp-text mk-links mt-5" />
          {l.footer ? <div className="mk-links mt-5 text-sm text-secondary">{l.footer}</div> : null}
        </div>
      ))}
    </div>
  );
}
