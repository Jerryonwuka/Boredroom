"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionPaused, usePrefersReducedMotion } from "@/components/landing/hero-stage";

const format = (total: number, f: "h:mm:ss" | "mm:ss") => {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return f === "h:mm:ss" ? `${h}:${two(m)}:${two(s)}` : `${two(Math.floor(total / 60))}:${two(s)}`;
};

/**
 * A running clock inside a product picture (owner feedback, 17 October 2026: pages v2: "a few live touches"): it renders
 * `start` seconds on the server and, once on screen, ticks once a second, so a timer or a call looks live. Still under
 * reduced motion and while the page's motion is paused (PauseMotion); stops off screen. Hidden from assistive technology
 * (it sits inside a role="img" picture whose description gives the time).
 */
export function LiveClock({ start, format: f = "h:mm:ss", className }: { start: number; format?: "h:mm:ss" | "mm:ss"; className?: string }) {
  const [t, setT] = useState(start);
  const [onScreen, setOnScreen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const paused = useMotionPaused();
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (reduced || paused || !onScreen) return;
    const id = window.setInterval(() => setT((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [reduced, paused, onScreen]);
  return <span ref={ref} aria-hidden className={className}>{format(t, f)}</span>;
}
