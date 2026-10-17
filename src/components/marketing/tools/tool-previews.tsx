import { Pane } from "@/components/landing/parts";
import { EXAMPLES, buildReport } from "@/components/marketing/tools/eod-report";
import { calculate, describeRule, formatDecimal, formatHM, formatSpoken } from "@/components/marketing/tools/work-hours";
import { cn } from "@/lib/utils";

/**
 * Still pictures of the two free tools' results, for the /free-tools hub's cards (review fix, 17 October 2026: the hub
 * was text-only cards). Each is computed on the server by the tool's own functions from the tool's own starting input,
 * so the picture always matches what the tool shows: the calculator's sample shift (09:00 to 17:30, 30 minutes unpaid,
 * overtime after 8 hours a day) and the generator's first example (Engineering). Pictures: role="img" with a
 * description, their insides hidden. Static, so reduced motion has nothing to stop. No orange: nothing in them is chosen.
 */

const SHIFT = { start: "09:00", end: "17:30", breakMinutes: "30" };
const RULE = { daily: 8, weekly: null } as const;
const FIELD = "flex h-8 min-w-0 items-center rounded-lg border border-border bg-background px-2.5 text-sm tabular-nums text-foreground";

export function WorkHoursPreview({ className }: { className?: string }) {
  const r = calculate([{ label: "Today", entries: [{ ...SHIFT }] }], RULE);
  const label = `The work hours calculator: one shift from ${SHIFT.start} to ${SHIFT.end} with a ${SHIFT.breakMinutes}-minute unpaid break gives ${formatSpoken(r.worked)} worked (${formatDecimal(r.worked)} in decimal hours), ${r.overtime ? `${formatSpoken(r.overtime)} of` : "no"} overtime.`;
  return (
    <Pane className={cn("p-4 sm:p-5", className)}>
      <div role="img" aria-label={label}>
        <div aria-hidden>
          <div className="grid grid-cols-3 gap-2 text-xs font-medium text-secondary">
            <span>Start</span><span>End</span><span>Break (min)</span>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            <span className={FIELD}>{SHIFT.start}</span><span className={FIELD}>{SHIFT.end}</span><span className={FIELD}>{SHIFT.breakMinutes}</span>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm font-medium text-secondary">Total worked</p>
            <p className="mt-1 font-display text-[40px] leading-[44px] tracking-[-0.02em] tabular-nums text-foreground">{formatHM(r.worked)}</p>
            <p className="text-sm font-normal tabular-nums text-secondary">{formatDecimal(r.worked)} hours in decimal</p>
            <dl className="mt-4 divide-y divide-border border-y border-border text-sm">
              {([["Regular", r.regular], ["Overtime", r.overtime], ["Unpaid breaks", r.breaks]] as const).map(([term, m]) => (
                <div key={term} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="font-normal text-secondary">{term}</dt>
                  <dd className="font-medium tabular-nums text-foreground">{formatHM(m)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-meta font-normal text-secondary">{describeRule(RULE, true)}</p>
          </div>
        </div>
      </div>
    </Pane>
  );
}

export function ReportPreview({ className }: { className?: string }) {
  const example = EXAMPLES[0];
  const text = buildReport(example.input);
  const label = `The end-of-day report generator's result for its ${example.label} example: a tidy plain-text report for ${example.input.name}, with the decisions waiting on someone first, then what changed since yesterday, what is blocked and tomorrow.`;
  return (
    <Pane className={cn("overflow-hidden", className)}>
      <div role="img" aria-label={label}>
        <div aria-hidden>
          <p className="border-b border-border bg-fill-0 px-4 py-2.5 text-sm font-medium text-foreground">Your end-of-day report</p>
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12.8px] leading-[20px] text-secondary">{text.trim()}</pre>
        </div>
      </div>
    </Pane>
  );
}
