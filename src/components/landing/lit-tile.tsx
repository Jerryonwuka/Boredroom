"use client";
import { useReducedMotion } from "motion/react";
import { MovingBorder } from "@/components/aceternity/moving-border";
import { cn } from "@/lib/utils";

/**
 * A card whose border carries one travelling orange light (Resend's feature-card effect, on Aceternity's MovingBorder).
 * The light lives only in the 1px ring; the face stays opaque. Give neighbours different durations so they drift apart.
 * Under prefers-reduced-motion the light is not rendered.
 */
export function LitTile({ children, className, duration = 6000 }: { children: React.ReactNode; className?: string; duration?: number }) {
  const reduced = useReducedMotion();
  return (
    <div className={cn("relative overflow-hidden rounded-2xl p-px", className)} style={{ background: "rgba(255,255,255,0.1)" }}>
      {reduced ? null : (
        <div aria-hidden className="absolute inset-0 rounded-2xl">
          <MovingBorder duration={duration} rx="16" ry="16">
            <div className="h-28 w-28 opacity-90" style={{ background: "radial-gradient(var(--accent) 25%, transparent 65%)" }} />
          </MovingBorder>
        </div>
      )}
      <div className="relative h-full rounded-[15px] bg-[#0a0a0a]">{children}</div>
    </div>
  );
}
