"use client";

// Boredroom's own animation for lucide's Inbox (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// Something lands: the tray dips and settles.
export const AnimatedInbox = createAnimatedIcon({
  name: "inbox",
  children: (
    <>
      <motion.polyline points="22 12 16 12 14 15 10 15 8 12 2 12" variants={{ normal: { y: 0 }, animate: { y: [0, 1.5, 0], transition: { duration: 0.5, times: [0, 0.4, 1], ease: "easeInOut" } } }} />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
});
