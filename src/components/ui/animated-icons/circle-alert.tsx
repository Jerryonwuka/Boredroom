"use client";

// Boredroom's own animation for lucide's CircleAlert (lucide-animated has none), in the same idiom.
import { createAnimatedIcon } from "./adapter";

// A small shake, as the bell rings.
export const AnimatedCircleAlert = createAnimatedIcon({
  name: "circle-alert",
  variants: { normal: { rotate: 0 }, animate: { rotate: [0, -10, 10, -6, 6, 0] } },
  transition: { duration: 0.5, ease: "easeInOut" },
  children: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
});
