"use client";

// lucide-animated's "upload" (MIT, ./LICENSE), on lucide-react's drawing of Upload.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedUpload = createAnimatedIcon({
  name: "upload",
  children: (
    <>
      <motion.g variants={{ normal: { y: 0 }, animate: { y: -2, transition: { type: "spring", stiffness: 200, damping: 10, mass: 1 } } }}>
        <path d="M12 3v12" />
        <path d="m17 8-5-5-5 5" />
      </motion.g>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </>
  ),
});
