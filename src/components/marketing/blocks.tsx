import { Check, X } from "lucide-react";
import { formatDate } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * Building blocks for the public pages' long-form text (owner request, 17 October 2026: SEO analysis), for use inside
 * Prose / ArticleBody or on their own. Design system v4: hairline boxes on fill-0 (r16), the secondary grey for text, the
 * foreground for what matters, no orange (nothing here is live or chosen). Server components; CopyBlock (copy-block.tsx)
 * is the one with a button.
 */

const BOX = "rounded-2xl border border-border bg-fill-0 p-5 sm:p-6";

/**
 * The definition box in the first 100 words (a featured snippet can lift it whole): the term in the foreground, then
 * the one-sentence definition.
 *
 *   <Definition term="An end-of-day report">is a short note, written at the end of the working day, that …</Definition>
 */
export function Definition({ term, label = "Definition", children, className }: { term: string; label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(BOX, className)}>
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className="mt-2 text-[17px] leading-7 text-foreground"><dfn className="font-semibold not-italic">{term}</dfn> {children}</p>
    </div>
  );
}

/** A note in a hairline box, with an optional title (a tip, a caveat, "what this is not"). */
export function Callout({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(BOX, className)}>
      {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
      <div className={cn("text-[15px] leading-6 text-secondary [&>*+*]:mt-3", title && "mt-1.5")}>{children}</div>
    </div>
  );
}

/**
 * A pull quote: one line set large in the display face between hairlines. For the site's own lines (the positioning
 * line), not someone else's words; a quotation needs `cite` and a source link beside it.
 */
export function PullQuote({ children, cite, className }: { children: React.ReactNode; cite?: React.ReactNode; className?: string }) {
  return (
    <figure className={cn("border-y border-border py-8 sm:py-10", className)}>
      <p className="font-display text-[24px] font-normal leading-8 tracking-[-0.02em] text-balance text-foreground sm:text-[28px] sm:leading-9">{children}</p>
      {cite ? <figcaption className="mt-4 text-meta font-normal text-secondary">{cite}</figcaption> : null}
    </figure>
  );
}

/**
 * A list with a tick or a cross before each item: what something does, and (with `negative`) what it never does. The
 * marks are icons beside words, so the list reads the same without them.
 */
export function CheckList({ items, negative = false, className }: { items: readonly React.ReactNode[]; negative?: boolean; className?: string }) {
  const Icon = negative ? X : Check;
  return (
    <ul data-plain className={cn("space-y-2.5", className)}>
      {items.map((item, i) => (
        <li key={i} data-plain className="flex gap-3">
          <Icon aria-hidden className={cn("mt-1 size-4 shrink-0", negative ? "text-subtle" : "text-foreground")} />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Numbered steps (a setup, a how-to). Each step's title is a heading when `headings` is set (an outline that calls for
 * "H3: Step 1 …"), otherwise bold text.
 */
export function Steps({ items, headings = false, className }: { items: readonly { title: string; body: React.ReactNode; id?: string }[]; headings?: boolean; className?: string }) {
  return (
    <ol data-plain className={cn("space-y-6", className)}>
      {items.map((step, i) => (
        <li key={step.title} data-plain className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
          <span aria-hidden className="grid size-7 place-items-center rounded-full bg-fill-1 text-xs font-semibold tabular-nums text-foreground">{i + 1}</span>
          <div className="min-w-0">
            {headings ? <h3 id={step.id} data-plain className="mt-0.5 text-base font-semibold text-foreground">{step.title}</h3> : <p className="mt-0.5 font-semibold text-foreground">{step.title}</p>}
            <div className="mt-1.5 [&>*+*]:mt-3">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A table that scrolls sideways on its own on a narrow screen (never the page), keyboard-scrollable and named. Put a
 * plain <table> inside, with a <caption> and <th scope="col">/<th scope="row"> headers.
 */
export function ScrollTable({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto rounded-[20px] border border-border bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_table]:min-w-[36rem] [&_caption]:px-4 [&_caption]:pt-4", className)}>
      {children}
    </div>
  );
}

/**
 * A product picture: a coded mock (src/components/landing/mocks.tsx …) with a caption. Pass `label` when the mock is
 * not named already: the picture is then role="img" with that description and its insides are hidden from assistive
 * technology (the landing mocks name themselves; leave `label` out for those).
 */
export function Figure({ label, caption, children, className }: { label?: string; caption?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <figure className={className}>
      {label ? <div role="img" aria-label={label}><div aria-hidden>{children}</div></div> : children}
      {caption ? <figcaption className="mt-3 text-meta font-normal text-secondary">{caption}</figcaption> : null}
    </figure>
  );
}

export type Source = {
  /** The page or report's own title. */
  title: string;
  /** Who published it (the vendor, the institution). */
  publisher: string;
  url: string;
  /** ISO date the fact was read ("2026-10-17"), shown as "as of 17 October 2026". */
  asOf: string;
  /** The source's own date, when it has one ("March 2025"). */
  published?: string;
  note?: string;
};

/**
 * Where the facts about others came from: each source a visible link with its publisher and an "as of" date (the
 * analysis's rule for comparisons and statistics: nothing unsourced, nothing undated).
 */
export function Sources({ items, className }: { items: readonly Source[]; className?: string }) {
  return (
    <ol className={cn("space-y-2 text-[14px] leading-6", className)}>
      {items.map((s) => (
        <li key={s.url + s.title}>
          <a href={s.url}>{s.title}</a>, {s.publisher}{s.published ? `, ${s.published}` : ""}. As of {formatDate(s.asOf)}.{s.note ? ` ${s.note}` : ""}
        </li>
      ))}
    </ol>
  );
}

/** "As of 17 October 2026" for a fact about someone else, next to the fact. */
export function AsOf({ date, className }: { date: string; className?: string }) {
  return <span className={cn("text-meta text-secondary", className)}>As of <time dateTime={date}>{formatDate(date)}</time></span>;
}
