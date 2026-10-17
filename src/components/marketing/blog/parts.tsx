import Link from "next/link";
import type { MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * Small parts for the blog's long-form pages (owner request, 17 October 2026: SEO analysis; the blog group's own folder).
 * Server components, tokens only, no orange: nothing here is live or chosen.
 */

/**
 * An in-text link to another public page. The href is typed to the registry, so a link to a page that does not exist is
 * a type error; the anchor text is the caller's words (descriptive, varied: the build spec's link rules).
 */
export function PageLink({ href, children }: { href: MarketingPath; children: React.ReactNode }) {
  return <Link href={href}>{children}</Link>;
}

/** An outside source cited in the text: a plain link to the primary page, opened in the same tab. */
export function Cite({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} rel="noopener">{children}</a>;
}

export type ReportLine = { text: string; note?: string };

/**
 * A report shown as a document: a hairline card on the canvas with a small kind line ("Sample", "Before"), the title,
 * and the report's lines in the mono face, wrapped (never sideways scroll). With notes, each line carries its margin
 * note: beside it from 1024px up, under it below that. The lines are real text (copyable, read by screen readers).
 *
 *   <SampleReport kind="Sample" title="Engineering" lines={[{ text: "Needs a decision: …", note: "Decisions first …" }]} />
 */
export function SampleReport({ kind = "Sample", title, lines, footer, className }: {
  kind?: string;
  title: string;
  lines: readonly ReportLine[];
  footer?: React.ReactNode;
  className?: string;
}) {
  const annotated = lines.some((l) => l.note);
  return (
    <div data-plain className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-natural-xs", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border bg-fill-0 px-4 py-2.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs font-medium text-secondary">{kind}</p>
      </div>
      <ol data-plain className="divide-y divide-border">
        {lines.map((l, i) => (
          <li key={i} data-plain className={cn("px-4 py-3", annotated && "lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-6")}>
            <p className="whitespace-pre-wrap break-words font-mono text-[13.6px] leading-[21px] text-foreground">{l.text}</p>
            {l.note ? <p className="mt-1.5 text-[14px] leading-[21px] text-secondary lg:mt-0"><span className="sr-only">Note: </span>{l.note}</p> : null}
          </li>
        ))}
      </ol>
      {footer ? <div className="border-t border-border px-4 py-3 text-[14px] leading-[21px] text-secondary">{footer}</div> : null}
    </div>
  );
}

/** "Why it works" / "What to cut" under a sample: a short list of points, each a bold lead and its reason. */
export function Points({ items }: { items: readonly [string, React.ReactNode][] }) {
  return (
    <ul>
      {items.map(([lead, body]) => <li key={lead}><strong>{lead}</strong> {body}</li>)}
    </ul>
  );
}
