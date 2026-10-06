import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { ToolSquare } from "@/components/ui/tool-tile";
import { PauseMotion } from "@/components/landing/pause-motion";

/**
 * Three columns of the week's moments sliding past, like a wall of testimonials, except every card is something the
 * product records. v4 rows: a 40px tool square with the line icon, the moment 14/20 medium, its detail 13px secondary,
 * on the canvas colour with a hairline (r12). Pure CSS (globals.css §6 `.lp-mq-y`): pauses on hover or with the Pause
 * button under it, still under reduced motion. Decorative repetition, so hidden from assistive technology as before.
 */
const COLS: { icon: Icon3DName; text: string; meta: string }[][] = [
  [
    { icon: "clock-in", text: "Ada clocked in at 08:58", meta: "On time, Design" },
    { icon: "stopwatch", text: "Homepage design started", meta: "Estimate 2h 30m" },
    { icon: "screen-record", text: "Ben pressed Record screen", meta: "Shares one window" },
    { icon: "card-check", text: "Revision 2 sent for a check", meta: "Figma link attached" },
    { icon: "shield-check", text: "David approved it", meta: "Both revisions kept" },
    { icon: "clock-out", text: "Ben clocked out at 17:31", meta: "7h 40m confirmed" },
  ],
  [
    { icon: "flag-alert", text: "Chidi is blocked", meta: "Waiting on client copy" },
    { icon: "chat", text: "How far with the deck?", meta: "Task attached, Graphics thread" },
    { icon: "focus-target", text: "Switched to Client kickoff", meta: "Old session closed" },
    { icon: "calendar-clock", text: "Mary was late by 12 minutes", meta: "Grace is 10" },
    { icon: "doc-link-check", text: "Correction requested", meta: "Interval 13:00 to 15:40" },
    { icon: "eye-checklist", text: "Owner opened the Workroom", meta: "9 working, 2 paused" },
  ],
  [
    { icon: "day-checklist", text: "3 to-dos from a voice note", meta: "Assistant, confirmed by Chidi" },
    { icon: "people", text: "Graphics team created", meta: "Ben is the lead" },
    { icon: "video-people", text: "Segment 2 ready to watch", meta: "24 minutes, David can view" },
    { icon: "box-doc-check", text: "Deliverable scanned and clean", meta: "logo-pack.zip" },
    { icon: "chart-ring", text: "Weekly timesheets exported", meta: "CSV, formula safe" },
    { icon: "person-laptop", text: "Connection lost for 12 minutes", meta: "Marked uncertain, asked about" },
  ],
];

export function Moments() {
  return (
    <div>
      <div className="lp-mq-y grid h-[480px] gap-3 overflow-hidden sm:grid-cols-2 md:grid-cols-3" aria-hidden>
        {COLS.map((col, c) => (
          <div key={c} className={c === 2 ? "hidden md:block" : c === 1 ? "hidden sm:block" : undefined}>
            <ul className={`lp-mq-y-track space-y-3 pb-3 ${c === 1 ? "reverse" : ""}`} style={{ "--marquee-duration": `${34 + c * 6}s` } as React.CSSProperties}>
              {[...col, ...col].map((m, i) => {
                const Icon = LINE_ICON[m.icon];
                return (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-natural-xs">
                    <ToolSquare><Icon /></ToolSquare>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{m.text}</span>
                      <span className="block truncate text-meta font-normal text-secondary">{m.meta}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-end"><PauseMotion /></div>
    </div>
  );
}
