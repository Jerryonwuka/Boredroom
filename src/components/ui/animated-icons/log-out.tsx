"use client";

// lucide-animated's "logout" (MIT, ./LICENSE), on lucide-react's drawing of LogOut.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide-animated's "logout": the arrow steps out of the door and back.
export const AnimatedLogOut = createAnimatedIcon({
  name: "log-out",
  children: (
    <>
      <motion.g variants={{ normal: { x: 0 }, animate: { x: [0, 3, 0], transition: { duration: 0.45 } } }}>
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </motion.g>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </>
  ),
});
