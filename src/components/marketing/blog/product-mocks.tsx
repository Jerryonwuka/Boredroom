import { FileText } from "lucide-react";
import { BrendaFace } from "@/components/app/brenda-face";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON, Pane } from "@/components/landing/parts";
import type { AssistantLook } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/**
 * Pictures of the product for the blog (owner request, 17 October 2026: SEO analysis: "one screenshot of the Boredroom
 * end-of-day report view", "a screenshot of the Boredroom standup view"). There are no screenshots on the site, so these
 * are coded mocks drawn after the real output, in the landing mocks' language (assistant-mocks.tsx), with made-up
 * people:
 * - EndOfDayReportMock: the document Brenda writes for a team lead (server/services/daily-report.ts reportMarkdown): her
 *   author line, the headline, "Decisions for you", "Changed since yesterday", a person's section with confirmed hours
 *   and attendance as plain facts, and "Needs your attention". No score, nobody ranked.
 * - StandupCardMock: a person's standup approval card (lib/standup STANDUP_WORDS: "Your standup for Design", Yesterday,
 *   Today, Blocked, "Post to #Design", Edit, "Skip today", the readback and the rollup line), and the lead's one rollup
 *   line ("Design: 5 of 6 posted").
 * Each is role="img" with a description of what it shows; its insides are hidden from assistive technology. Static (no
 * arrival animation), so reduced motion has nothing to stop. No orange: nothing in them is live.
 */

const look: AssistantLook = { colour: "white", visor: "bean", eyes: "pill" };
const fake = (variant: "primary" | "secondary" | "ghost") => cn(buttonVariants({ variant, size: "xs" }), FAKE_BUTTON);
const LABEL = "text-meta font-medium text-secondary";
const LINE = "text-sm font-normal text-foreground";

export const END_OF_DAY_REPORT_LABEL =
  "A sample Boredroom end-of-day report for a team lead, written by Brenda at 18:00: a one-line summary of the day, two decisions waiting on the lead, what changed since yesterday, one person's finished work, confirmed hours and clock-in time, and one item that needs attention. There is no score and nobody is ranked.";

export function EndOfDayReportMock({ className }: { className?: string }) {
  return (
    <Pane className={cn("p-4 sm:p-5", className)}>
      <div role="img" aria-label={END_OF_DAY_REPORT_LABEL}>
        <div aria-hidden>
          <div className="flex items-center gap-2.5">
            <BrendaFace size="sm" look={look} quiet />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">End-of-day report, Design</p>
              <p className="truncate text-meta font-normal text-secondary">Docs, Daily reports. Only you can read it.</p>
            </div>
            <FileText className="ml-auto size-4 shrink-0 text-secondary" />
          </div>
          <p className="mt-4 text-meta font-normal italic text-secondary">Brenda wrote this end-of-day report for you at 18:00 on Thursday, from what was recorded in Boredroom.</p>
          <p className="mt-3 text-sm font-semibold text-foreground">Your team logged 31.5 hours today and finished 6 tasks, with 2 sent for review. 1 task is blocked.</p>

          <p className={cn(LABEL, "mt-5")}>Decisions for you</p>
          <ul data-plain className="mt-1.5 divide-y divide-border rounded-xl border border-border">
            <li data-plain className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className={cn(LINE, "min-w-0 flex-1")}>Review “Homepage hero, revision 2” from Ada</span>
              <Badge>Review</Badge>
            </li>
            <li data-plain className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className={cn(LINE, "min-w-0 flex-1")}>Chidi is blocked on you: “Pricing page copy”</span>
              <Badge>Blocked</Badge>
            </li>
          </ul>

          <p className={cn(LABEL, "mt-4")}>Changed since yesterday</p>
          <ul data-plain className="mt-1 space-y-1">
            <li data-plain className={LINE}><span className="font-medium">Newly blocked:</span> “Pricing page copy” (Chidi)</li>
            <li data-plain className={LINE}><span className="font-medium">Finished:</span> “Logo files” (Ben), “Onboarding emails” (Ada)</li>
          </ul>

          <p className={cn(LABEL, "mt-4")}>Ada Obi</p>
          <ul data-plain className="mt-1 space-y-1">
            <li data-plain className={LINE}>Design. 7.5 hours.</li>
            <li data-plain className={LINE}>Finished: “Onboarding emails”. Sent for review: “Homepage hero, revision 2”.</li>
            <li data-plain className={LINE}>Attendance: clocked in at 08:58.</li>
          </ul>

          <p className={cn(LABEL, "mt-4")}>Needs your attention</p>
          <p className={cn(LINE, "mt-1")}>Chidi has waited a day for the client’s copy.</p>
        </div>
      </div>
    </Pane>
  );
}

export const STANDUP_CARD_LABEL =
  "A sample Boredroom standup card: Brenda has drafted Ben's update for the Design team from his own work, under Yesterday, Today and Blocked. Nothing is posted until Ben presses Post to #Design; he can also edit it or skip the day. Below it, the lead's rollup line: 5 of 6 posted.";

export function StandupCardMock({ className }: { className?: string }) {
  const sections = [
    { label: "Yesterday", lines: ["Finished “Logo files”", "Sent “Icon set” for review"] },
    { label: "Today", lines: ["“Pricing page layout”, 40% done", "“Email header”, due today"] },
    { label: "Blocked", lines: ["“Pricing page copy”: waiting on Chidi for the client’s text"] },
  ];
  return (
    <Pane className={cn("p-4 sm:p-5", className)}>
      <div role="img" aria-label={STANDUP_CARD_LABEL}>
        <div aria-hidden>
          <div className="flex items-center gap-2.5">
            <BrendaFace size="sm" look={look} quiet />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">Your standup for Design</p>
              <p className="truncate text-meta font-normal text-secondary">Drafted by Brenda from your work</p>
            </div>
            <Badge>Ready to post</Badge>
          </div>
          <div className="mt-4 space-y-3.5">
            {sections.map((s) => (
              <div key={s.label}>
                <p className={LABEL}>{s.label}</p>
                <ul data-plain className="mt-1 space-y-0.5">
                  {s.lines.map((l) => <li key={l} data-plain className={LINE}>{l}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs font-normal text-subtle">Posts to #Design (6 people) as you, sent by Brenda. Rollup to David at 12:00.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={fake("primary")}>Post to #Design</span>
            <span className={fake("secondary")}>Edit</span>
            <span className={fake("ghost")}>Skip today</span>
          </div>
          <p className="mt-4 border-t border-border pt-3 text-meta font-normal text-secondary"><span className="font-medium text-foreground">Design</span>: 5 of 6 posted. Rollup sent to David at 12:00.</p>
        </div>
      </div>
    </Pane>
  );
}
