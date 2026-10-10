"use client";

import { useRef, useSyncExternalStore } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { DashboardGlow, DashboardRim } from "@/components/landing/dashboard-glow";

/**
 * "Everything in view": the dashboard card tilted back that straightens and rises as it scrolls in. Adapted from
 * Aceternity UI's ContainerScroll as used on the live site's hero; the owner liked it and asked for it back (owner
 * request, 10 October 2026). Changes from that copy: the card is v4 (the Stage tray and hairlines, no pointer
 * spotlight); the range follows the card itself (it straightens as its top edge comes in and is flat when its
 * top reaches 30% of the screen), not the whole block; phones get a gentler tilt; and reduced motion shows it flat and
 * still (globals.css §6 also holds it flat before this script wakes up).
 *
 * The title is server-rendered (`SectionTitle`) and only rides up a little. The picture is `role="img"` with `label`;
 * whatever is inside it is a drawing (`inert`, hidden from assistive technology). Scroll-linked: nothing runs while the
 * page is still.
 *
 * The orange light behind the card (owner request, 10 October 2026) is `DashboardGlow`: flat behind the card, under it
 * in paint order, warming as the card straightens; `DashboardRim` is the warm line on the card's own top edge, so it
 * follows the tilt.
 */

const PHONE = "(max-width: 767px)";
const REDUCED = "(prefers-reduced-motion: reduce)";
const watch = (query: string) => (change: () => void) => {
  const mq = window.matchMedia(query);
  mq.addEventListener("change", change);
  return () => mq.removeEventListener("change", change);
};
const subscribePhone = watch(PHONE), subscribeReduced = watch(REDUCED);
const isPhone = () => window.matchMedia(PHONE).matches;
const isReduced = () => window.matchMedia(REDUCED).matches;
/**
 * On the server the desktop tilt is drawn; a phone swaps to its own before the card scrolls into view. Reduced motion is
 * read the same way, not with motion's useReducedMotion, which knows the answer on the client's first render and so
 * hydrated "none" over the server's tilt (integration, 10 October 2026); the CSS rule holds the card flat meanwhile.
 */
const onServer = () => false;

// [from, to] for the tilt (degrees), the scale and the title's rise (px).
const DESKTOP = { rotate: [20, 0], scale: [1.05, 1], rise: [0, -100] };
const PHONE_RANGE = { rotate: [12, 0], scale: [0.94, 1], rise: [0, -40] };
const STILL = { rotate: [0, 0], scale: [1, 1], rise: [0, 0] };

export function ContainerScroll({ title, children, label, className }: {
  /** The section title (server-rendered). */ title: React.ReactNode;
  /** The card's picture (AppFrame and the dashboard). */ children: React.ReactNode;
  /** What the picture shows, for screen readers. */ label: string;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const phone = useSyncExternalStore(subscribePhone, isPhone, onServer);
  const reduced = useSyncExternalStore(subscribeReduced, isReduced, onServer);
  const { scrollYProgress } = useScroll({ target: card, offset: ["start 0.95", "start 0.3"] });
  // MotionConfig's reducedMotion does not reach scroll-linked styles, so reduced motion picks the still ranges here.
  const r = reduced ? STILL : phone ? PHONE_RANGE : DESKTOP;
  const rotateX = useTransform(scrollYProgress, [0, 1], r.rotate);
  const scale = useTransform(scrollYProgress, [0, 1], r.scale);
  const y = useTransform(scrollYProgress, [0, 1], r.rise);

  return (
    <div className={className ? `lp-scroll-perspective ${className}` : "lp-scroll-perspective"}>
      <motion.div className="lp-scroll-title" style={{ y }}>{title}</motion.div>
      {/* Untransformed: the scroll is measured from here, so the tilt never changes what it measures. */}
      <div ref={card} className="relative mx-auto mt-10 w-full max-w-5xl md:mt-14">
        <DashboardGlow progress={scrollYProgress} reduced={reduced} />
        <motion.div style={{ rotateX, scale }}
          className="lp-scroll-card relative rounded-[22px] border border-border bg-fill-0 p-1.5 shadow-chart sm:rounded-[28px] sm:p-2">
          <div role="img" aria-label={label}
            className="lp-scroll-viewport h-[32rem] overflow-hidden rounded-2xl border border-border bg-background sm:rounded-[20px] md:h-[40rem] lg:h-[44rem]">
            {children}
          </div>
          <DashboardRim progress={scrollYProgress} reduced={reduced} />
        </motion.div>
      </div>
    </div>
  );
}
