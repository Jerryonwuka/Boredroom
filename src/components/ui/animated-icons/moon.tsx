"use client";

// lucide-animated's "moon" (MIT, ./LICENSE), on lucide-react's drawing of Moon.
import { createAnimatedIcon } from "./adapter";

export const AnimatedMoon = createAnimatedIcon({
  name: "moon",
  variants: { normal: { rotate: 0 }, animate: { rotate: [0, -10, 10, -5, 5, 0] } },
  transition: { duration: 1.2, ease: "easeInOut" },
  children: <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />,
});
