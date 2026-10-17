import { PauseMotion } from "@/components/landing/pause-motion";
import { CtaBand } from "@/components/marketing/cta-band";
import { VisualStage } from "@/components/marketing/hero-visual";
import { PlansStrip } from "@/components/marketing/plans-strip";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { Section } from "@/components/marketing/section";
import type { MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * Shared parts of the product pages: features, solutions and use cases (owner feedback, 17 October 2026: pages v2: "like
 * actual product pages, like the homepage"). Thin wrappers over the kit so the eight pages say the same things the same
 * way: the mid-page call to action, the pricing section with the live plans, and a moving picture with its Pause button.
 */

/** The hero's and the call to action's second button, unless a page passes its own. */
export const SEE_PRICING = { href: "/pricing", label: "See pricing" } as const;

/**
 * The page's one mid-page call to action (where the old CtaRow sat): a CtaBand with the launch-aware white primary and,
 * by default, See pricing (the same link and words the old row carried). Words are the page's: true and short.
 */
export function ProductCta({ title, sub, visual, secondary = SEE_PRICING, label = "Get started" }: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  visual?: React.ReactNode;
  secondary?: { href: string; label: string };
  label?: React.ReactNode;
}) {
  return <CtaBand id="get-started" label={label} title={title} sub={sub} visual={visual} actions={<PrimaryCta secondary={secondary} />} />;
}

/**
 * A product page's pricing section: the head, the live plans as compact cards (PlansStrip, with its one link in the
 * page's own words), then the page's own pricing lines under them (`children`, e.g. a two-card CardGrid).
 */
export function PricingSection({ id = "pricing", title = "Pricing", label = "Plans", sub, link, tone, children }: {
  id?: string;
  title?: React.ReactNode;
  label?: React.ReactNode;
  sub?: React.ReactNode;
  link: { href: MarketingPath; label: string };
  tone?: "plain" | "tint";
  children?: React.ReactNode;
}) {
  return (
    <Section id={id} label={label} title={title} sub={sub} tone={tone}>
      <PlansStrip link={link} />
      {children ? <div className="mt-10">{children}</div> : null}
    </Section>
  );
}

/**
 * A picture that moves on its own (the cycling ChangesCard, a ticking call clock) on its tray, with the Pause button and
 * an optional caption under it (WCAG 2.2.2). Pass it to a SplitSection with `bare`.
 */
export function MovingPicture({ children, caption, className }: { children: React.ReactNode; caption?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <VisualStage>{children}</VisualStage>
      <div className={cn("mt-3 flex flex-wrap items-start gap-x-3 gap-y-1", caption ? "justify-between" : "justify-end")}>
        {caption ? <p className="min-w-0 flex-1 text-meta font-normal text-secondary">{caption}</p> : null}
        <PauseMotion />
      </div>
    </div>
  );
}

/** A short block of text beside or under a table or grid: an h3 and its paragraphs, in a readable column. */
export function TextBlock({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-16", className)}>
      <h3 className="text-base font-semibold text-foreground text-pretty">{title}</h3>
      <div className="lp-text mk-links [&>*+*]:mt-3">{children}</div>
    </div>
  );
}
