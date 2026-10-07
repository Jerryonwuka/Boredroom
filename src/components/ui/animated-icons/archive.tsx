"use client";

// lucide-animated's "archive" (MIT, ./LICENSE), on lucide-react's drawing of Archive.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const SPRING = { duration: 0.2, type: "spring", stiffness: 200, damping: 25 } as const;

export const AnimatedArchive = createAnimatedIcon({
  name: "archive",
  children: (
    <>
      <motion.rect width="20" height="5" x="2" y="3" rx="1" variants={{ normal: { y: 0, transition: SPRING }, animate: { y: -1.5, transition: SPRING } }} />
      <motion.path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" variants={{ normal: { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }, animate: { d: "M4 11v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11" } }} />
      <motion.path d="M10 12h4" variants={{ normal: { d: "M10 12h4" }, animate: { d: "M10 15h4" } }} />
    </>
  ),
});
