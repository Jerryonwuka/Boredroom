import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tab } from "@/components/ui/tabs";

/**
 * Server-safe pieces of the Control Center, v4 (design system v4, owner decision 6 October 2026). They live apart from
 * actions.tsx ("use client") because a string exported from a client module reaches a server component as a client
 * reference, not as the string.
 */

/** A control inside a filter strip (`F`): the 24px outline trigger, 12/16 medium. */
export const filterCls = "field field-xs w-auto max-w-[16rem]";

/** A control in a form (sheets, settings cards): the 36px field. */
export const inputCls = "field";

/**
 * A name that links to its page in a table or a list: the foreground, medium; its underline is orange on hover (links,
 * accent rules 6 October 2026).
 */
export const linkCls = "rounded-sm font-medium text-foreground decoration-accent decoration-1 underline-offset-[3px] hover:underline";

/** The second line in a table cell or a row: 13/19.5 regular, secondary. */
export const subCls = "block text-meta font-normal text-secondary";

/**
 * A filter control for a toolbar (spec §7 "Filter control"): a strip, min-height 32, r10, fill-0, padding 4px 6px, a
 * 12/16 medium label in the subtle grey, then the control (give it `filterCls`, or a DatePicker size="xs"). The label
 * element wraps the control, so the label names it.
 */
export function F({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex min-h-8 max-w-full items-center gap-2 rounded-[10px] bg-fill-0 px-1.5 py-1", className)}>
      <span className="shrink-0 pl-0.5 text-xs font-medium text-subtle">{label}</span>
      {children}
    </label>
  );
}

/**
 * A labelled form control: the label 14/20 medium in the foreground, an optional `hint` beside it in the secondary
 * grey ("optional", "written to the audit trail"), 6px above the control. The label element wraps the control; for a
 * control that is itself a label (InputAdorned), pass `htmlFor` with the control's id instead, so labels never nest.
 */
export function Labelled({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  const text = <>{label}{hint ? <span className="ml-1.5 font-normal text-secondary">{hint}</span> : null}</>;
  if (htmlFor) {
    return (
      <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{text}</label>
        {children}
      </div>
    );
  }
  return (
    <label className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <span className="text-sm font-medium text-foreground">{text}</span>
      {children}
    </label>
  );
}

/**
 * A list of facts: a label (14/20 medium, with an optional 13px hint under it) on the left and its value on the right
 * (a Badge, a short text in the secondary grey). Rows are separated by space, not lines (spec §7 Lists).
 */
export function Facts({ items, className }: { items: { label: ReactNode; hint?: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <dt className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{it.label}</span>
            {it.hint ? <span className={subCls}>{it.hint}</span> : null}
          </dt>
          <dd className="min-w-0 text-sm font-normal text-secondary">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Metric cells (spec §7: fill-0, r12, p16): a 13px label in the subtle grey over a short value. For profiles of
 * something ("Adoption: 4 of 6 people active this week") where a stat card would be too loud.
 */
export function Cells({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 rounded-xl bg-fill-0 p-4">
          <dt className="type-metric-label">{it.label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The marketing pages share one row of underline tabs under their titles. */
export const MARKETING_TABS: Tab[] = [
  { label: "Overview", href: "/admin/marketing" },
  { label: "Contacts", href: "/admin/marketing/contacts" },
  { label: "Segments", href: "/admin/marketing/segments" },
  { label: "Campaigns", href: "/admin/marketing/campaigns" },
  { label: "Automations", href: "/admin/marketing/automations" },
  { label: "Templates", href: "/admin/marketing/templates" },
];

/** A workspace role in the app's words. */
export const ORG_ROLE: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

/** "past_due" → "Past due". */
export function words(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
