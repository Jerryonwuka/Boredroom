"use client";

/**
 * Motion primitives for Boredroom, built on `motion` (the library behind Framer).
 * Rules: one orchestrated rise per page; everything else answers an action. Durations under 250ms, custom
 * ease-out, transform and opacity only. `MotionConfig reducedMotion="user"` switches movement off system-wide
 * for people who asked for it.
 */
import { motion, AnimatePresence, LayoutGroup, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export const EASE = [0.23, 1, 0.32, 1] as const;
export const FAST = 0.16;
export const BASE = 0.22;

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: BASE, ease: EASE }}>{children}</MotionConfig>;
}

/** The page's one entrance: the main column rises 6px and fades in, its direct children staggered by 40ms. */
export function PageRise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } } }}>
      {children}
    </motion.div>
  );
}
export const riseItem = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: BASE, ease: EASE } } };
export function Rise({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" }) {
  const Tag = motion[as];
  return <Tag className={className} variants={riseItem}>{children}</Tag>;
}

/** Wraps a list whose rows move: rows with stable keys slide to their new place instead of jumping. */
export function AnimatedList({ children, className, as = "ul" }: { children: ReactNode; className?: string; as?: "ul" | "ol" }) {
  const Tag = motion[as];
  return <LayoutGroup><Tag className={className} layout>{children}</Tag></LayoutGroup>;
}
export function AnimatedRow({ children, className, id }: { children: ReactNode; className?: string; id: string }) {
  return (
    <motion.li layout="position" layoutId={id} className={className} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: FAST } }} transition={{ layout: { duration: BASE, ease: EASE }, duration: BASE, ease: EASE }}>
      {children}
    </motion.li>
  );
}
export { AnimatePresence };

/** A notice that slides in when it appears and out when it goes. */
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show ? <motion.div key="p" initial={{ opacity: 0, y: -4, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -4, height: 0, transition: { duration: FAST } }} style={{ overflow: "hidden" }}>{children}</motion.div> : null}
    </AnimatePresence>
  );
}

/** A panel that expands under a toggle (details, assistant, edit forms). */
export function Expand({ show, children, id }: { show: boolean; children: ReactNode; id?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show ? <motion.div key="e" id={id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0, transition: { duration: FAST } }} style={{ overflow: "hidden" }}>{children}</motion.div> : null}
    </AnimatePresence>
  );
}

/** The sliding marker shared by tab bars and the sidebar: give every group its own layoutId. */
export function SlidingMarker({ layoutId, className }: { layoutId: string; className: string }) {
  return <motion.span layoutId={layoutId} className={className} transition={{ duration: BASE, ease: EASE }} aria-hidden />;
}

/** Cross-fades between two states of the same slot (the timer's running/idle faces). */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={id} className={className} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: FAST } }}>{children}</motion.div>
    </AnimatePresence>
  );
}
