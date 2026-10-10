import { Plus } from "lucide-react";
import { arrive } from "@/components/landing/parts";

/**
 * The FAQ as a quiet accordion: native <details> (keyboard and screen readers work without script), hairlines between
 * the questions, the question 16/24 medium, a "+" in the secondary grey that turns to an "×" (150ms) when open, the
 * answer 15/24 in the secondary grey. The questions arrive one after another, once (owner request, 10 October 2026).
 */
export function Faq({ items }: { items: [string, string][] }) {
  return (
    <div data-lp-arrive className="lp-faq divide-y divide-border border-y border-border">
      {items.map(([q, a], i) => (
        <details key={q} className="lp-item group" style={arrive(0, i * 55)}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 rounded-lg py-4 text-left text-base font-medium text-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">
            <span>{q}</span>
            <Plus className="size-4 shrink-0 text-secondary transition-transform duration-150 ease-out group-open:rotate-45" aria-hidden />
          </summary>
          <p className="lp-text pb-5 pr-10">{a}</p>
        </details>
      ))}
    </div>
  );
}
