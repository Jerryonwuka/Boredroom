import { Check } from "lucide-react";
import { WRAP } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

/**
 * A free tool as the page's centrepiece (owner feedback, 17 October 2026: pages v2; the reference's tool page: the tool
 * straight under a compact hero, above the fold): a section at full page width holding an r28 tray with a top bar (the
 * tool's quiet h2 and fact chips, each with a tick) and the tool on the canvas (r20). Tools inside drop their own outer
 * panel. `note` sits under the tray in the secondary grey.
 *
 *   <ToolShell id="tool" title="Work hours calculator" facts={["No sign-up", "Nothing leaves your browser", "Free"]}>
 *     <WorkHoursCalculator />
 *   </ToolShell>
 */
export function ToolShell({ id = "tool", title, facts = [], note, children, className }: {
  id?: string;
  title: string;
  facts?: readonly string[];
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 pb-16 sm:pb-20", className)}>
      <div className={WRAP}>
        <div className="rounded-[22px] border border-border bg-fill-0 p-1.5 sm:rounded-[28px] sm:p-2">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3.5 pb-3 pt-2.5 sm:px-4">
            <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">{title}</h2>
            {facts.length ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {facts.map((f) => (
                  <li key={f} className="inline-flex items-center gap-1.5 text-meta font-medium text-secondary">
                    <Check aria-hidden className="size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />{f}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="min-w-0 rounded-2xl border border-border bg-background shadow-chart sm:rounded-[20px]">{children}</div>
        </div>
        {note ? <div className="mk-links mt-4 text-meta font-normal text-secondary">{note}</div> : null}
      </div>
    </section>
  );
}
