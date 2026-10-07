"use client";

// Boredroom's own animation for lucide's LayoutDashboard (lucide-animated has none), in the same idiom.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// Each panel gives a small press, one after another.
const PANEL: Variants = { normal: { scale: 1 }, animate: (i: number) => ({ scale: [1, 0.8, 1], transition: { delay: i * 0.06, duration: 0.4, ease: "easeInOut" } }) };

export const AnimatedLayoutDashboard = createAnimatedIcon({
  name: "layout-dashboard",
  children: (
    <>
      <motion.rect width="7" height="9" x="3" y="3" rx="1" custom={0} variants={PANEL} />
      <motion.rect width="7" height="5" x="14" y="3" rx="1" custom={1} variants={PANEL} />
      <motion.rect width="7" height="9" x="14" y="12" rx="1" custom={2} variants={PANEL} />
      <motion.rect width="7" height="5" x="3" y="16" rx="1" custom={3} variants={PANEL} />
    </>
  ),
});
