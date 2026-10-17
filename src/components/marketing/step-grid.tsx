import { arrive } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const LG_COLS: Record<1 | 2 | 3 | 4, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
const LG_SPAN: Record<number, string> = { 1: "", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };

/**
 * Numbered steps across the page (owner feedback, 17 October 2026: pages v2): an ordered list in the home page's
 * hairline grid, each cell a 28px number (hidden from assistive technology: the list is an <ol>), the step's title
 * (h3) and its text. One column on a phone, two from 640px, `columns` from 1024px. The vertical `Steps` (blocks.tsx)
 * stays for long-form text.
 *
 *   <StepGrid columns={4} steps={[{ title: "Invite your team", body: <>…</> }, …]} />
 */
export function StepGrid({ steps, columns = 4, headingLevel = "h3", className }: {
  steps: readonly { title: string; body: React.ReactNode; id?: string }[];
  /** From 1024px; 1 stacks the steps (beside a picture). */
  columns?: 1 | 2 | 3 | 4;
  headingLevel?: "h3" | "h4";
  className?: string;
}) {
  const Heading = headingLevel;
  const n = steps.length;
  // From 1024px: `columns`, or fewer when there are fewer steps (no empty cell); an odd last cell fills its row.
  const lg = Math.max(1, Math.min(columns, n)) as 1 | 2 | 3 | 4;
  const rest = n % lg;
  return (
    <ol data-lp-arrive className={cn("grid gap-px overflow-hidden rounded-[20px] border border-border bg-border", n > 1 && "sm:grid-cols-2", LG_COLS[lg], className)}>
      {steps.map((step, i) => (
        <li key={step.title} className={cn("min-w-0 bg-background p-6", i === n - 1 && n % 2 === 1 && n > 1 && "max-lg:sm:col-span-2", i === n - 1 && rest > 0 && LG_SPAN[lg - rest + 1])}>
          <div className="lp-item" style={arrive(i)}>
            <span aria-hidden className="grid size-7 place-items-center rounded-full bg-fill-1 text-xs font-semibold tabular-nums text-foreground">{i + 1}</span>
            <Heading id={step.id} className="mt-5 text-base font-semibold text-foreground text-pretty">{step.title}</Heading>
            <div className="lp-text mk-links mt-1.5 [&>*+*]:mt-3">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
