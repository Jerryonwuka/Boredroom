"use client";

// lucide-animated's "rotate-ccw" (MIT, ./LICENSE), on lucide-react's drawing of RotateCcw.
import { createAnimatedIcon } from "./adapter";

export const AnimatedRotateCcw = createAnimatedIcon({
  name: "rotate-ccw",
  variants: { normal: { rotate: 0 }, animate: { rotate: -50 } },
  transition: { type: "spring", stiffness: 250, damping: 25 },
  children: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
});
