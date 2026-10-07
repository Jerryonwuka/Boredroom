"use client";

// lucide-animated's "arrow-left" (MIT, ./LICENSE), on lucide-react's drawing of ArrowLeft.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedArrowLeft = createAnimatedIcon({
  name: "arrow-left",
  children: (
    <>
      <motion.path d="m12 19-7-7 7-7" variants={{ normal: { x: 0 }, animate: { x: [0, 3, 0], transition: { duration: 0.4 } } }} />
      <motion.path d="M19 12H5" variants={{ normal: { d: "M19 12H5" }, animate: { d: ["M19 12H5", "M19 12H10", "M19 12H5"], transition: { duration: 0.4 } } }} />
    </>
  ),
});
