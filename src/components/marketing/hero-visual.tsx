import { PauseMotion } from "@/components/landing/pause-motion";
import { HeroBrenda } from "@/components/marketing/hero-brenda";
import type { AssistantColour } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/**
 * The tray a product picture sits on (owner feedback, 17 October 2026: pages v2): the home page's Stage look (a fill-0
 * tray, a hairline, r28; r22 on a phone) holding a coded mock that brings its own canvas card (a `Pane`: the landing
 * mocks, the blog's report and standup, the timesheet). Unlike `Stage` it adds no inner card and no arrival of its own,
 * so a mock that acts out its story as it arrives (`data-lp-arrive`) is never nested in another trigger. For a picture
 * without its own card (Brenda's home, the dashboard) use `Stage` from landing/parts.
 */
export function VisualStage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-[22px] border border-border bg-fill-0 p-2.5 sm:rounded-[28px] sm:p-4", className)}>{children}</div>;
}

/**
 * A hero's picture (owner feedback, 17 October 2026: pages v2: "a live-looking product panel on the right"): `primary`
 * on a tray; `secondary`, a second picture overlapping its lower-left corner from 1024px (about 58% wide, raised with
 * the chart shadow; in the flow, so the column keeps room for it and nothing is clipped) and stacked under it below;
 * `brenda`, one hero Brenda perched on the tray's top edge (reserved space, loaded after paint); `pause`, the Pause
 * button under it all (required when anything in it moves on its own: WCAG 2.2.2); `caption`, a line under it.
 *
 *   <HeroCluster primary={<FollowUpMock />} secondary={<CommitmentMock />} brenda="teal" pause />
 */
export function HeroCluster({ primary, secondary, brenda, caption, pause = false, className }: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** The colour of the Brenda perched on the tray (her mood follows the home carousel's for that colour). */
  brenda?: AssistantColour;
  caption?: React.ReactNode;
  pause?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0", brenda && "pt-[96px]", className)}>
      {brenda ? <HeroBrenda colour={brenda} size={112} className="absolute right-8 top-0 z-[var(--z-raised)] sm:right-12" /> : null}
      <VisualStage>{primary}</VisualStage>
      {secondary ? (
        <div className="relative z-[var(--z-raised)] mt-3 min-w-0 lg:-ml-8 lg:-mt-20 lg:w-[58%] lg:rounded-2xl lg:shadow-chart">{secondary}</div>
      ) : null}
      {caption || pause ? (
        <div className={cn("mt-3 flex flex-wrap items-center gap-x-3 gap-y-1", caption ? "justify-between" : "justify-end")}>
          {caption ? <div className="min-w-0 text-meta font-normal text-secondary">{caption}</div> : null}
          {pause ? <PauseMotion /> : null}
        </div>
      ) : null}
    </div>
  );
}
