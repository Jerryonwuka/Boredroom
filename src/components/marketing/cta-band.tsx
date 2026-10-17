import { WRAP, arrive } from "@/components/landing/parts";
import { SectionLabel } from "@/components/marketing/section";
import { cn } from "@/lib/utils";

/**
 * The mid-page call to action (owner feedback, 17 October 2026: pages v2; replaces CtaRow, and is the blog's product
 * band): an r28 tray on fill-0, the text on the left (a label, an h2 in the display face, a line, the white buttons)
 * and, with `visual`, a product picture on the right (under the text on a phone). One per page; white buttons only (the
 * site-wide close in the layout keeps the waitlist form). The words are the page's: true and short.
 *
 *   <CtaBand id="get-started" label="Get started" title="…" sub="…" visual={<EndOfDayReportMock />}
 *     actions={<PrimaryCta secondary={{ href: "/features/ai-assistant", label: "…" }} />} />
 */
export function CtaBand({ id = "cta", label, title, sub, actions, visual, className }: {
  id?: string;
  label?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  /** A mock that brings its own card (a Pane). */
  visual?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-12 sm:py-16", className)}>
      <div className={WRAP}>
        <div className={cn("overflow-hidden rounded-[22px] border border-border bg-fill-0 p-6 sm:rounded-[28px] sm:p-12", visual && "grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-14")}>
          <div data-lp-arrive className="min-w-0">
            {label ? <div className="lp-item mb-5" style={arrive(0)}><SectionLabel className="bg-fill-150">{label}</SectionLabel></div> : null}
            <h2 id={`${id}-title`} className="lp-item font-display text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-balance text-foreground sm:text-[32px] sm:leading-[38px]" style={arrive(1)}>{title}</h2>
            {sub ? <div className="lp-sub lp-item mk-links mt-4 max-w-xl [&>*+*]:mt-3" style={arrive(2)}>{sub}</div> : null}
            {actions ? <div className="lp-item mt-8 flex flex-wrap items-center gap-3" style={arrive(3)}>{actions}</div> : null}
          </div>
          {/* A tall picture is cut at 420px with a soft fade (the band stays a band, not a second page). */}
          {visual ? <div className="mk-peek max-h-[420px] min-w-0 overflow-hidden [--peek-h:420px]">{visual}</div> : null}
        </div>
      </div>
    </section>
  );
}
