"use client";

// lucide-animated's "folder-kanban" (MIT, ./LICENSE), on lucide-react's drawing of FolderKanban.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide-animated pulses the columns forever; here they pulse once, one after another.
const COLUMN: Variants = { normal: { opacity: 1 }, animate: { opacity: [1, 0.2, 1], transition: { duration: 1, ease: "easeInOut" } } };

export const AnimatedFolderKanban = createAnimatedIcon({
  name: "folder-kanban",
  children: (
    <>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <motion.g variants={{ animate: { transition: { staggerChildren: 0.2 } } }}>
        <motion.path d="M8 10v4" variants={COLUMN} />
        <motion.path d="M12 10v2" variants={COLUMN} />
        <motion.path d="M16 10v6" variants={COLUMN} />
      </motion.g>
    </>
  ),
});
