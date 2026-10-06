import { cn } from "@/lib/utils";
import { ToolSquare } from "@/components/ui/tool-tile";

/**
 * The landing page's building blocks, v4 for marketing (owner request, 6 October 2026): the app's tokens and parts on
 * the dark canvas, with display type at marketing sizes (globals.css §6: .lp-display, .lp-h2, .lp-h3, .lp-lead,
 * .lp-sub, .lp-text). No glass, glow or 3D icons. `.lp-reveal` fades a block in as it scrolls into view where the
 * browser supports scroll-driven animation; elsewhere, and with reduced motion, it simply shows.
 */

/** The page width: 1152px, 20px sides on a phone, 24px from 640px. */
export const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-6";

/** A section opener: an optional 40px tool square with a line icon, the display title, one secondary line under it. */
export function SectionTitle({ id, icon, title, sub, align = "center", className }: { id?: string; icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; align?: "center" | "left"; className?: string }) {
  const centered = align === "center";
  return (
    <div className={cn("lp-reveal max-w-3xl", centered && "mx-auto text-center", className)}>
      {icon ? <ToolSquare className={cn("mb-6", centered && "mx-auto")}>{icon}</ToolSquare> : null}
      <h2 id={id} className="lp-h2">{title}</h2>
      {sub ? <p className={cn("lp-sub mt-4 max-w-2xl", centered && "mx-auto")}>{sub}</p> : null}
    </div>
  );
}

/**
 * The stage a product view sits on: a fill-0 tray with a hairline (r28, 8px in; r22, 6px in on a phone) holding the
 * view on the canvas colour (r20/r16, a hairline, the chart shadow). Concentric corners, no glow.
 */
export function Stage({ children, className, innerClassName, reveal = true }: { children: React.ReactNode; className?: string; innerClassName?: string; /** Fade in on scroll (off for the hero's, which is on screen at load). */ reveal?: boolean }) {
  return (
    <div className={cn(reveal && "lp-reveal", "rounded-[22px] border border-border bg-fill-0 p-1.5 sm:rounded-[28px] sm:p-2", className)}>
      <div className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-chart sm:rounded-[20px]", innerClassName)}>{children}</div>
    </div>
  );
}

/** A feature card: r20, a hairline, fill-0, 20–24px in. The visual first, then `FeatureText`. */
export function FeatureCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("lp-reveal flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-fill-0 p-5 sm:p-6", className)}>{children}</div>;
}

export function FeatureText({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mt-6", className)}>
      <h3 className="lp-h3">{title}</h3>
      <p className="lp-text mt-2">{children}</p>
    </div>
  );
}

/** A card inside a feature card that holds a small product view: the canvas colour, a hairline, r16. */
export function Pane({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-2xl border border-border bg-background shadow-natural-xs", className)}>{children}</div>;
}

/**
 * A button's look on a span, for product views: it shows the control without being one (no hover, no focus, and no
 * 40px touch growth). `variant` and `size` are the Button ones.
 */
export const FAKE_BUTTON = "pointer-events-none select-none pointer-coarse:h-7";
