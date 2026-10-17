import { Stage } from "@/components/landing/parts";
import { DashboardBody } from "@/components/landing/dashboard-demo";

/** The dashboard's description (the home page's scroll card names the same picture). */
const LABEL = "The Boredroom dashboard for Company A on Friday 9 October: 11 of 12 people clocked in with 1 late, 9 working now, 52 hours 40 minutes of confirmed time today and 6 tasks done, then the month's attendance by day. No productivity score.";

/**
 * A look at the dashboard (owner feedback, 17 October 2026: pages v2): the home page's dashboard page
 * (landing/dashboard-demo DashboardBody, laid out by its own container queries) on a Stage, cut at about 440px with a
 * soft fade at the foot (a mask on the content, `.mk-peek`). A picture: role="img" with its description, its insides
 * hidden. Too tall for a card: use it in a hero or a section.
 */
export function DashboardPeek({ height = 440, reveal = false, className }: { height?: number; reveal?: boolean; className?: string }) {
  return (
    <Stage reveal={reveal} className={className}>
      <div role="img" aria-label={LABEL} className="mk-peek overflow-hidden" style={{ maxHeight: height, "--peek-h": `${height}px` } as React.CSSProperties}>
        <div aria-hidden inert className="text-left">
          <DashboardBody fitTabs />
        </div>
      </div>
    </Stage>
  );
}
