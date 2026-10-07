"use client";

// Boredroom's own animation for lucide's ClipboardList (lucide-animated has none), in the same idiom.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The list's lines write themselves in, top to bottom, as the clipboard's tick does.
const LINE: Variants = { normal: { pathLength: 1, opacity: 1 }, animate: (i: number) => ({ pathLength: [0, 1], opacity: [0, 1], transition: { delay: i * 0.15, duration: 0.3, ease: "easeInOut" } }) };

export const AnimatedClipboardList = createAnimatedIcon({
  name: "clipboard-list",
  children: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <motion.path d="M12 11h4" custom={0} variants={LINE} />
      <motion.path d="M12 16h4" custom={1} variants={LINE} />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
});
