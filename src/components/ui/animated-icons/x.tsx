"use client";

// lucide-animated's "x" (MIT, ./LICENSE), on lucide-react's drawing of X.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const STROKE: Variants = { normal: { opacity: 1, pathLength: 1 }, animate: { opacity: [0, 1], pathLength: [0, 1] } };

export const AnimatedX = createAnimatedIcon({
  name: "x",
  children: (
    <>
      <motion.path d="M18 6 6 18" variants={STROKE} />
      <motion.path d="m6 6 12 12" transition={{ delay: 0.2 }} variants={STROKE} />
    </>
  ),
});
