"use client";
import { CardBody, CardContainer } from "@/components/aceternity/3d-card";
import { GlowingEffect } from "@/components/aceternity/glowing-effect";
import { cn } from "@/lib/utils";

/**
 * Every card on the landing page: glass (see .lp-card), a pointer-following orange glow on the border
 * (Aceternity GlowingEffect) and a 3D tilt on hover (Aceternity CardContainer). `tilt={false}` keeps the glass
 * and glow but no tilt, for cards inside other motion (the scroll container, marquees).
 */
export function GlassCard({ children, className, tilt = true, bodyClassName }: { children: React.ReactNode; className?: string; tilt?: boolean; bodyClassName?: string }) {
  const body = (
    <div className={cn("lp-card relative h-full", className)}>
      <GlowingEffect spread={36} glow proximity={72} inactiveZone={0.02} borderWidth={1.5} disabled={false} />
      <div className={cn("relative h-full", bodyClassName)}>{children}</div>
    </div>
  );
  if (!tilt) return body;
  return (
    <CardContainer containerClassName="block h-full py-0" className="block h-full w-full">
      <CardBody className="h-full w-full">{body}</CardBody>
    </CardContainer>
  );
}
