"use client";

// lucide-animated's "layout-grid" (MIT, ./LICENSE), on lucide-react's drawing of LayoutGrid.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const move = (x: number, y: number): Variants => ({
  normal: { x: 0, y: 0 },
  animate: { x: [0, x, x, 0], y: [0, y, y, 0], transition: { duration: 0.8, ease: "easeInOut", times: [0, 0.4, 0.6, 1] } },
});

export const AnimatedLayoutGrid = createAnimatedIcon({
  name: "layout-grid",
  children: (
    <>
      <motion.rect width="7" height="7" x="3" y="3" rx="1" variants={move(11, 0)} />
      <motion.rect width="7" height="7" x="14" y="3" rx="1" variants={move(0, 11)} />
      <motion.rect width="7" height="7" x="14" y="14" rx="1" variants={move(-11, 0)} />
      <motion.rect width="7" height="7" x="3" y="14" rx="1" variants={move(0, -11)} />
    </>
  ),
});
