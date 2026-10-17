import { WRAP, arrive } from "@/components/landing/parts";
import { SectionLinks } from "@/components/landing/section-links";
import { SectionHead } from "@/components/marketing/section";
import { VisualStage } from "@/components/marketing/hero-visual";
import type { MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

export type SplitPoint = { title: string; body: React.ReactNode };

/**
 * A two-column section (owner feedback, 17 October 2026: pages v2; the home page's text-and-sticky-picture sections,
 * generalised): the head (label, h2, sub), points as h3 + text split by hairlines (each arriving as it scrolls in),
 * optional extra blocks, links to the pages that cover it in full; beside it the picture on a tray, holding under the
 * nav from 768px while the text scrolls past (globals.css "Sticky pictures"). Stacked below 768px, text first.
 *
 *   <SplitSection id="attendance" label="Attendance" title="…" sub="…" points={[{ title, body }]} visual={<AttendanceMock />}
 *     links={[{ href: "/free-tools/work-hours-calculator", label: "…" }]} />
 *
 * `visual` is put on a VisualStage (mocks that bring their own card); pass `bare` for a picture that has its own stage
 * (BrendaHomePanel, DashboardPeek). `visualSide="left"` puts the picture first on wide screens.
 */
export function SplitSection({ id, label, labelIcon, title, sub, points, visual, visualCaption, visualSide = "right", bare = false, links, tone = "plain", children, className }: {
  id: string;
  label?: React.ReactNode;
  labelIcon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  points?: readonly SplitPoint[];
  visual: React.ReactNode;
  visualCaption?: React.ReactNode;
  visualSide?: "left" | "right";
  bare?: boolean;
  links?: readonly { href: MarketingPath; label: string }[];
  tone?: "plain" | "tint";
  /** Extra blocks under the points (a CopyBlock, a small table …). */
  children?: React.ReactNode;
  className?: string;
}) {
  const left = visualSide === "left";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-20 sm:py-28", tone === "tint" && "border-y border-border bg-fill-0", className)}>
      <div className={cn(WRAP, "grid items-start gap-12 md:grid-cols-2 lg:gap-16")}>
        <div className={cn("min-w-0", left && "md:order-2")}>
          <SectionHead id={`${id}-title`} label={label} labelIcon={labelIcon} title={title} sub={sub} />
          {points?.length ? (
            <ul className="mt-8 max-w-xl divide-y divide-border border-t border-border">
              {points.map((p, i) => (
                <li key={p.title} className="py-5">
                  <div data-lp-arrive className="lp-item" style={arrive(i)}>
                    <h3 className="text-base font-semibold text-foreground">{p.title}</h3>
                    <div className="lp-text mk-links mt-1.5 [&>*+*]:mt-3">{p.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {children ? <div className="mt-8 max-w-xl">{children}</div> : null}
          {links?.length ? <SectionLinks align="left" className="mt-6" links={links} /> : null}
        </div>
        <div className={cn("lp-sticky-col min-w-0", left && "md:order-1")}>
          <figure className="lp-sticky">
            {bare ? visual : <VisualStage>{visual}</VisualStage>}
            {visualCaption ? <figcaption className="mt-3 text-meta font-normal text-secondary">{visualCaption}</figcaption> : null}
          </figure>
        </div>
      </div>
    </section>
  );
}
