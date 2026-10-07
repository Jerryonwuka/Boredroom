"use client";

// Boredroom's own animation for lucide's MessageSquareReply (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The reply arrow inside the bubble swings back and returns.
export const AnimatedMessageSquareReply = createAnimatedIcon({
  name: "message-square-reply",
  children: (
    <>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <motion.g variants={{ normal: { x: 0 }, animate: { x: [0, -1.5, 0], transition: { duration: 0.5, times: [0, 0.4, 1], ease: "easeInOut" } } }}>
        <path d="m10 8-3 3 3 3" />
        <path d="M17 14v-1a2 2 0 0 0-2-2H7" />
      </motion.g>
    </>
  ),
});
