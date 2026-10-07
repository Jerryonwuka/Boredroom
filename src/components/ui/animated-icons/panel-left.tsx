"use client";

// Boredroom's own animation for lucide's PanelLeft (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The panel's edge gives a small slide, as lucide-animated's panel-left-close moves its chevron.
export const AnimatedPanelLeft = createAnimatedIcon({
  name: "panel-left",
  children: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <motion.path d="M9 3v18" transition={{ times: [0, 0.4, 1], duration: 0.5 }} variants={{ normal: { x: 0 }, animate: { x: [0, -1.5, 0] } }} />
    </>
  ),
});
