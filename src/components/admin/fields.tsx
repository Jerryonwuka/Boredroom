import type { ReactNode } from "react";

/**
 * Server-safe pieces of the Control Center forms. They live apart from actions.tsx ("use client") because a string
 * exported from a client module reaches a server component as a client reference, not as the string.
 */

/** The filter-bar control: a 36px pill on the shared field style. Forms use `field` on its own (40px, 10px corners). */
export const inputCls = "field field-sm";

/** A small labelled control for filter bars. */
export function F({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5"><span className="eyebrow">{label}</span>{children}</label>;
}
