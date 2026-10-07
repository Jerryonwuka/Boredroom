"use client";

// Boredroom's own animation for lucide's Video (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The lens nudges forward and back.
export const AnimatedVideo = createAnimatedIcon({
  name: "video",
  children: (
    <>
      <motion.path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" transition={{ times: [0, 0.4, 1], duration: 0.5 }}
        variants={{ normal: { x: 0 }, animate: { x: [0, 1.5, 0] } }} />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
});
