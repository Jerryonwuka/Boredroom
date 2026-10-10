import { cn } from "@/lib/utils";
import { ToolSquare } from "@/components/ui/tool-tile";

/**
 * The landing page's building blocks, v4 for marketing (owner request, 6 October 2026): the app's tokens and parts on
 * the dark canvas, with display type at marketing sizes (globals.css §6: .lp-display, .lp-h2, .lp-h3, .lp-lead,
 * .lp-sub, .lp-text). No glass, glow or 3D icons. `.lp-reveal` blocks and `data-lp-arrive` groups rise into place
 * once, as they first come into view (owner request, 10 October 2026: components/landing/arrival.tsx); without script,
 * and with reduced motion, they simply show.
 */

/** Stagger index for an arrival (`.lp-item`): 70ms a step, or an exact delay in ms. */
export const arrive = (i: number, ms?: number): React.CSSProperties => (ms === undefined ? { "--lp-i": i } : { "--lp-d": `${ms}ms` }) as unknown as React.CSSProperties;

/** The page width: 1152px, 20px sides on a phone, 24px from 640px. */
export const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-6";

/** The page's one contact (the footer's Contact, and Enterprise's "Talk to us"). */
export const CONTACT_EMAIL = "jonwuka@xsitecapital.com";

/**
 * A section opener: an optional 40px tool square with a line icon, the display title, one secondary line under it.
 * They arrive in that order (owner request, 10 October 2026).
 */
export function SectionTitle({ id, icon, title, sub, align = "center", className }: { id?: string; icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; align?: "center" | "left"; className?: string }) {
  const centered = align === "center";
  return (
    <div data-lp-arrive className={cn("max-w-3xl", centered && "mx-auto text-center", className)}>
      {icon ? <div className="lp-item mb-6" style={arrive(0)}><ToolSquare className={cn(centered && "mx-auto")}>{icon}</ToolSquare></div> : null}
      <h2 id={id} className="lp-h2 lp-item" style={arrive(1)}>{title}</h2>
      {sub ? <p className={cn("lp-sub lp-item mt-4 max-w-2xl", centered && "mx-auto")} style={arrive(2)}>{sub}</p> : null}
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

/** A feature card: r20, a hairline, fill-0, 20–24px in. The visual first, then `FeatureText`. `order` staggers a row's arrival. */
export function FeatureCard({ children, className, order = 0 }: { children: React.ReactNode; className?: string; order?: number }) {
  return <div className={cn("lp-reveal flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-fill-0 p-5 sm:p-6", className)} style={order ? arrive(order * 2) : undefined}>{children}</div>;
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
export function Pane({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement> & { "data-lp-arrive"?: boolean }) {
  return <div {...rest} className={cn("min-w-0 rounded-2xl border border-border bg-background shadow-natural-xs", className)}>{children}</div>;
}

/**
 * A button's look on a span, for product views: it shows the control without being one (no hover, no focus, and no
 * 40px touch growth). `variant` and `size` are the Button ones.
 */
export const FAKE_BUTTON = "pointer-events-none select-none pointer-coarse:h-7";
