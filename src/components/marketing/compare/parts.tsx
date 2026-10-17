import { WRAP } from "@/components/landing/parts";
import { Sources } from "@/components/marketing/blocks";
import { Section } from "@/components/marketing/section";
import { VersusStats } from "@/components/marketing/stat-band";
import { AS_OF, TOOLS, sourcesFor, type CriterionKey, type SourceKey, type ToolId } from "@/components/marketing/compare/data";
import { formatDate } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * Parts the comparison pages share (owner feedback, 17 October 2026: pages v2: "like actual product pages, like the
 * homepage", with the reference's head-to-head layout: logo vs name, "at a glance", the capability table, the reasons,
 * both sides in balance, FAQ, sources). Built on the kit; the words stay each page's own.
 */

/** The four questions a head-to-head's "at a glance" band answers, in a few words each (TOOLS[x].short). */
const GLANCE: readonly CriterionKey[] = ["score", "screen", "ai", "pricing"];
const GLANCE_LABEL: Record<CriterionKey, string> = {
  screen: "Screenshots", score: "Productivity score", calls: "Call recording", consent: "Consent", time: "Attendance",
  ai: "AI assistant", pricing: "Pricing model", free: "Free plan or trial", bestFor: "Best for",
};

/**
 * "At a glance": four of the nine questions, both answers at the same weight under each product's name (fair: neither
 * is the winner), from compare/data.ts's short cells, with where they come from and when.
 */
export function AtAGlance({ tool, id = "at-a-glance" }: { tool: Exclude<ToolId, "boredroom">; id?: string }) {
  const them = TOOLS[tool];
  const us = TOOLS.boredroom;
  return (
    <Section id={id} label="At a glance" title={`Boredroom and ${them.name} at a glance`} align="center" className="pt-4 sm:pt-6"
      sub={<p>Four of the nine questions in a few words, from {them.name}&apos;s own pages as of <time dateTime={AS_OF}>{formatDate(AS_OF)}</time>. The full answers are in the table below.</p>}>
      <VersusStats subjects={[us.name, them.name]} items={GLANCE.map((k) => ({ label: GLANCE_LABEL[k], values: [us.short[k], them.short[k]] as const }))} />
    </Section>
  );
}

/** Headed blocks of text in a column (h3 + paragraph), split by hairlines: the reasoning that stays prose. */
export function TextStack({ items, headingLevel = "h3", className }: {
  items: readonly { title: string; body: React.ReactNode }[];
  headingLevel?: "h3" | "h4";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div className={cn("divide-y divide-border border-y border-border", className)}>
      {items.map((it) => (
        <div key={it.title} className="py-6">
          <Heading className="text-base font-semibold text-foreground text-pretty">{it.title}</Heading>
          <div className="lp-text mk-links mt-2 [&>*+*]:mt-3">{it.body}</div>
        </div>
      ))}
    </div>
  );
}

/** A small heading inside a section (an h3 that heads a table or a grid), with an optional line under it. */
export function SubHead({ title, sub, id, className }: { title: string; sub?: React.ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <h3 id={id} className="lp-h3 text-balance">{title}</h3>
      {sub ? <div className="lp-text mk-links mt-2 [&>*+*]:mt-3">{sub}</div> : null}
    </div>
  );
}

/** A card holding prose: an r20 hairline on fill-0, an optional h3, the text. */
export function TextCard({ title, children, headingLevel = "h3", className }: { title?: string; children: React.ReactNode; headingLevel?: "h3" | "h4"; className?: string }) {
  const Heading = headingLevel;
  return (
    <div className={cn("lp-reveal min-w-0 rounded-[20px] border border-border bg-fill-0 p-6 sm:p-7", className)}>
      {title ? <Heading className="lp-h3 text-balance">{title}</Heading> : null}
      <div className={cn("lp-text mk-links [&>*+*]:mt-3", title && "mt-3")}>{children}</div>
    </div>
  );
}

/** The page's sources: the method line as the section's sub, the list in a hairline card. */
export function SourcesSection({ keys, intro, title = "Sources", id = "sources" }: { keys: readonly SourceKey[]; intro: React.ReactNode; title?: string; id?: string }) {
  return (
    <Section id={id} label="Method" title={title} width="text" sub={intro} className="pt-4 sm:pt-6">
      <div className="mk-links rounded-[20px] border border-border bg-fill-0 p-6 text-secondary sm:p-7">
        <Sources items={sourcesFor(keys)} />
      </div>
    </Section>
  );
}

/** A line of links under a section's content (the other head-to-heads), centred. */
export function LinkLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("lp-text mk-links mx-auto mt-8 max-w-2xl text-center", className)}>{children}</p>;
}

/** The full-width wrapper, for a block between sections. */
export const Wrap = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn(WRAP, className)}>{children}</div>;
