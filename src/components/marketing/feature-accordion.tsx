import { Plus } from "lucide-react";
import { WRAP } from "@/components/landing/parts";
import { AccordionSync } from "@/components/marketing/feature-accordion-sync";
import { VisualStage } from "@/components/marketing/hero-visual";
import { SectionHead } from "@/components/marketing/section";
import { cn } from "@/lib/utils";

export type AccordionItem = {
  /** Unique within the accordion (an anchor-safe slug). */
  id: string;
  title: string;
  /** The row's text and links (all of it is in the server HTML, open or not). */
  body: React.ReactNode;
  /** The picture shown beside the list while this row is open; a row without one keeps the previous row's. */
  visual?: React.ReactNode;
  caption?: React.ReactNode;
  icon?: React.ReactNode;
  /** A small chip before the title ("Morning"): a use case's moments. */
  kicker?: string;
  /** The visual is a picture that has its own stage (BrendaHomePanel): not put on a tray. */
  bare?: boolean;
};

/**
 * The feature accordion (owner feedback, 17 October 2026: pages v2; the reference's "how it works" list beside a
 * product picture). Native `<details name>` rows, so it works without script, only one row is open at a time, and
 * find-in-page opens a row; every row's words and links are in the HTML. The open row carries the 2px orange marker
 * (it is the chosen one: the accent rules); its picture sits beside the list on a tray that holds under the nav from
 * 1024px, and right under its row below that. The client sync (feature-accordion-sync.tsx) shows the open row's
 * picture; with every row closed the last picture stays beside the list from 1024px, and none shows below that. Opening animates the height where the browser can
 * (globals.css §6); reduced motion makes it instant.
 *
 * Use 3 to 6 rows; the first row needs a `visual`. Titles are h3 (inside the summary), so put it under an h2: pass
 * `title` (and `label`, `sub`) to give it its own section, or leave them out and place it inside a Section.
 *
 *   <FeatureAccordion id="does" label="What she does" title="What Brenda does" items={[{ id: "answers", title: "…",
 *     body: <p>…</p>, visual: <FollowUpMock /> }, …]} />
 */
export function FeatureAccordion({ id, items, label, labelIcon, title, sub, align = "left", tone = "plain", className }: {
  id: string;
  items: readonly AccordionItem[];
  label?: React.ReactNode;
  labelIcon?: React.ReactNode;
  /** With a title it renders its own <section> (h2 `${id}-title`); without, only the accordion (place it in a Section). */
  title?: React.ReactNode;
  sub?: React.ReactNode;
  align?: "left" | "center";
  tone?: "plain" | "tint";
  className?: string;
}) {
  const body = (
    <div data-acc={id} className="mk-acc grid gap-x-16 gap-y-2 lg:gap-y-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:[grid-template-rows:repeat(var(--n),auto)_1fr]"
      style={{ "--n": items.length } as React.CSSProperties}>
      {items.map((item, i) => {
        const first = i === 0, last = i === items.length - 1;
        return (
          <Row key={item.id} id={id} item={item} index={i} first={first} last={last} />
        );
      })}
      <AccordionSync id={id} />
    </div>
  );
  if (!title) return <div className={className}>{body}</div>;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-20 sm:py-28", tone === "tint" && "border-y border-border bg-fill-0", className)}>
      <div className={WRAP}>
        <SectionHead id={`${id}-title`} label={label} labelIcon={labelIcon} title={title} sub={sub} align={align} />
        <div className="mt-12">{body}</div>
      </div>
    </section>
  );
}

function Row({ id, item, index, first, last }: { id: string; item: AccordionItem; index: number; first: boolean; last: boolean }) {
  return (
    <>
      <details name={`acc-${id}`} open={first} id={`${id}-${item.id}`} data-acc-row={index}
        className={cn(
          // Below 1024px each row is its own card (its picture opens under it); from 1024px the rows join into one.
          "group relative scroll-mt-24 rounded-[20px] border border-border bg-background lg:col-start-1 lg:rounded-none lg:border-b-0",
          first && "lg:rounded-t-[20px]",
          last && "lg:rounded-b-[20px] lg:border-b",
          // The open row's 2px orange marker, level with its title (the chosen row: the accent rules).
          "after:pointer-events-none after:absolute after:left-[-1px] after:top-[18px] after:h-5 after:w-0.5 after:rounded-full after:bg-accent after:opacity-0 after:transition-opacity after:duration-150 open:after:opacity-100",
        )}>
        <summary className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[20px] px-5 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">
          {item.icon ? <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-secondary transition-colors duration-75 group-open:text-foreground [&_svg]:size-4">{item.icon}</span> : null}
          <span className="min-w-0 flex-1">
            {item.kicker ? <span className="mb-1 inline-flex h-6 items-center rounded-full bg-fill-1 px-2.5 text-xs font-medium text-secondary">{item.kicker}</span> : null}
            <h3 className="text-base font-semibold text-foreground text-pretty">{item.title}</h3>
          </span>
          <Plus aria-hidden className="mk-acc-plus size-4 shrink-0 text-secondary" />
        </summary>
        <div className={cn("lp-text mk-links px-5 pb-5 [&>*+*]:mt-3", item.icon && "sm:pl-[64px]")}>{item.body}</div>
      </details>
      {item.visual ? (
        <figure data-acc-visual={index} hidden={!first}
          className="mk-acc-fig mb-2 mt-1 min-w-0 lg:col-start-2 lg:my-0 lg:[grid-row:1/-1]">
          <div className="lp-sticky">
            {item.bare ? item.visual : <VisualStage>{item.visual}</VisualStage>}
            {item.caption ? <figcaption className="mt-3 text-meta font-normal text-secondary">{item.caption}</figcaption> : null}
          </div>
        </figure>
      ) : null}
    </>
  );
}
