import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FAKE_BUTTON, Pane } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

/**
 * A timesheet day with a correction waiting for the team lead (owner request, 17 October 2026: SEO analysis, Content Plan
 * page 12: "a screenshot of a timesheet with a correction awaiting approval"). A coded picture of the real flow
 * (server/services/reports.ts): confirmed timer time, a gap the server could not vouch for marked uncertain and not
 * counted, and the person's proposed correction with its reason, which changes nothing until the lead approves it. No
 * orange: nothing here is live or chosen (the accent rules); the pending state is a neutral badge. role="img" with a
 * description; its insides are hidden from assistive technology.
 */
const ROWS: { task: string; time: string; length: string; status: "confirmed" | "uncertain" }[] = [
  { task: "Homepage design", time: "09:02 to 11:40", length: "2h 38m", status: "confirmed" },
  { task: "Homepage design", time: "11:40 to 12:05", length: "25m", status: "uncertain" },
  { task: "Client call notes", time: "13:10 to 14:05", length: "55m", status: "confirmed" },
];

const fake = (variant: "primary" | "secondary") => cn(buttonVariants({ variant, size: "xs" }), FAKE_BUTTON);

export function TimesheetCorrectionMock({ className }: { className?: string }) {
  return (
    <Pane className={cn("p-4 sm:p-5", className)}>
      <div role="img" aria-label="Ada's timesheet for Tuesday: 3 hours 33 minutes confirmed, 25 minutes uncertain and not counted, and her correction asking to count those 25 minutes on Homepage design, waiting for her team lead David to approve it.">
        <div aria-hidden>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">Ada, Tuesday</span>
            <span className="text-meta font-normal tabular-nums text-secondary">3h 33m confirmed</span>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {ROWS.map((r) => (
              <div key={r.time} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.task}</p>
                  <p className="text-xs font-normal tabular-nums text-subtle">{r.time}</p>
                </div>
                <span className={cn("text-sm tabular-nums", r.status === "confirmed" ? "text-foreground" : "text-subtle line-through")}>{r.length}</span>
                <Badge tone={r.status === "confirmed" ? "success" : "neutral"} size="sm">{r.status === "confirmed" ? "Confirmed" : "Uncertain"}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-border bg-fill-0 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Correction</span>
              <Badge size="sm">Waiting for David</Badge>
            </div>
            <p className="mt-1.5 text-meta font-normal text-secondary">Count 11:40 to 12:05 on Homepage design.</p>
            <p className="mt-1 text-meta font-normal text-secondary">&ldquo;Kept working on the draft offline when the laptop lost its connection.&rdquo;</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={fake("primary")}>Approve</span>
              <span className={fake("secondary")}>Reject</span>
            </div>
          </div>
        </div>
      </div>
    </Pane>
  );
}
