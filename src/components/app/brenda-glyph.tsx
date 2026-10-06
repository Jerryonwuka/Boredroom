import { forwardRef, type SVGProps } from "react";

/**
 * Brenda's face as a line icon (owner decision, 5 October 2026: no generic AI icons anywhere; where something means
 * Brenda, it shows her face). Drawn on the same 24px grid, stroke and caps as the lucide icons beside it, so it sits in
 * the sidebar, on buttons and in empty states like any other icon: her rounded screen and her two pill eyes.
 */
export const BrendaGlyph = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>(
  function BrendaGlyph({ size = 24, strokeWidth = 2, ...props }, ref) {
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="2.5" y="5" width="19" height="14.5" rx="5.5" />
        <path d="M9.5 10.25v3.5" />
        <path d="M14.5 10.25v3.5" />
      </svg>
    );
  },
);
