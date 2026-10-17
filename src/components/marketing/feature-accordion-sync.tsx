"use client";

import { useEffect } from "react";

/**
 * FeatureAccordion's picture switch (owner feedback, 17 October 2026: pages v2). `toggle` does not bubble, so it listens
 * in the capture phase on the accordion's root and shows the picture of the open row (or, for a row without one, of the
 * nearest row above it that has one); every other picture is `hidden`. With every row closed the last picture stays.
 * Renders nothing: without script the first row's picture shows, and every row still opens.
 */
export function AccordionSync({ id }: { id: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(`[data-acc="${CSS.escape(id)}"]`);
    if (!root) return;
    const onToggle = (e: Event) => {
      const row = e.target as HTMLElement;
      if (!(row instanceof HTMLDetailsElement) || !row.open || !row.matches("[data-acc-row]")) return;
      const at = Number(row.dataset.accRow);
      const figures = [...root.querySelectorAll<HTMLElement>("[data-acc-visual]")];
      const show = figures.filter((f) => Number(f.dataset.accVisual) <= at).at(-1) ?? figures[0];
      for (const f of figures) f.hidden = f !== show;
    };
    root.addEventListener("toggle", onToggle, true);
    return () => root.removeEventListener("toggle", onToggle, true);
  }, [id]);
  return null;
}
