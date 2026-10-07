"use client";

// Boredroom's own animation for lucide's Kanban (lucide-animated has none), in the same idiom.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The three columns grow down again, one after another (folder-kanban's idea, drawn).
const COLUMN: Variants = { normal: { pathLength: 1 }, animate: (i: number) => ({ pathLength: [0, 1], transition: { delay: i * 0.08, duration: 0.35, ease: "easeOut" } }) };

export const AnimatedKanban = createAnimatedIcon({
  name: "kanban",
  children: (
    <>
      <motion.path d="M5 3v14" custom={0} variants={COLUMN} />
      <motion.path d="M12 3v8" custom={1} variants={COLUMN} />
      <motion.path d="M19 3v18" custom={2} variants={COLUMN} />
    </>
  ),
});
