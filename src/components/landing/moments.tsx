import { FileText, Handshake, ListChecks, MessageSquareReply, Repeat, SquareCheckBig, Video, type LucideIcon } from "lucide-react";
import { LINE_ICON } from "@/components/ui/icon";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { ToolSquare } from "@/components/ui/tool-tile";
import { PauseMotion } from "@/components/landing/pause-motion";

/**
 * Three columns of the week's moments sliding past, like a wall of testimonials, except every card is something the
 * product records. v4 rows: a 40px tool square with the line icon, the moment 14/20 medium, its detail 13px secondary,
 * on the canvas colour with a hairline (r12). Pure CSS (globals.css §6 `.lp-mq-y`): pauses on hover or with the Pause
 * button under it, still under reduced motion. Decorative repetition, so hidden from assistive technology as before.
 * The assistants' moments (owner request, 10 October 2026): follow-ups, the standup, commitments, routines, call notes
 * and handed-on to-dos replace six of the old rows; icons are lucide (or her glyph) directly.
 */
type Glyph = LucideIcon | typeof BrendaGlyph;
const COLS: { icon: Glyph; text: string; meta: string }[][] = [
  [
    { icon: LINE_ICON["clock-in"], text: "Ada clocked in at 08:58", meta: "On time, Design" },
    { icon: LINE_ICON.stopwatch, text: "Homepage design started", meta: "Estimate 2h 30m" },
    { icon: MessageSquareReply, text: "Max asked Ben's Brenda about the deck", meta: "Answered from Ben's work" },
    { icon: Video, text: "Ben started a call in #Design", meta: "Ada and David joined" },
    { icon: LINE_ICON["card-check"], text: "Revision 2 sent for a check", meta: "Figma link attached" },
    { icon: FileText, text: "End-of-day report sent to David", meta: "2 decisions waiting on him" },
  ],
  [
    { icon: LINE_ICON["flag-alert"], text: "Chidi is blocked", meta: "Waiting on client copy" },
    { icon: BrendaGlyph, text: "Design standup: 5 of 6 posted", meta: "Rollup sent to David at 12:00" },
    { icon: LINE_ICON.chat, text: "How far with the deck?", meta: "Task attached, Graphics thread" },
    { icon: Handshake, text: "Brenda noted Ada's promise", meta: "Send the deck Thursday, accepted" },
    { icon: LINE_ICON["doc-link-check"], text: "Correction requested", meta: "Interval 13:00 to 15:40" },
    { icon: LINE_ICON["shield-check"], text: "David approved it", meta: "Both revisions kept" },
  ],
  [
    { icon: LINE_ICON["day-checklist"], text: "3 to-dos from a voice note", meta: "Brenda, confirmed by Chidi" },
    { icon: Repeat, text: "Friday routine ran", meta: "3 things still owed, sent to Olu" },
    { icon: ListChecks, text: "Brenda's notes are ready: 3 action items", meta: "Each one waits for its person to accept" },
    { icon: SquareCheckBig, text: "Ada handed a to-do to Ben's assistant", meta: "Waiting for Ben to accept" },
    { icon: LINE_ICON["chart-ring"], text: "Weekly timesheets exported", meta: "CSV, formula safe" },
    { icon: LINE_ICON["person-laptop"], text: "Connection lost for 12 minutes", meta: "Marked uncertain, asked about" },
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
                const Icon = m.icon;
                return (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-natural-xs">
                    <ToolSquare><Icon aria-hidden /></ToolSquare>
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
