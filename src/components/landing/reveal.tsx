"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Resend-style entrance: the block sharpens from a blur, fades in and lifts, the first time it scrolls into view. */
export function Reveal({ children, className, delay = 0, as = "div", once = true }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" | "p"; once?: boolean }) {
  const Tag = motion[as];
  return (
    <Tag className={className} initial={{ opacity: 0, y: 24, filter: "blur(10px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }} viewport={{ once, margin: "-60px" }} transition={{ duration: 0.8, ease: EASE, delay }}>
      {children}
    </Tag>
  );
}

/** Children rise one after another. Wrap the items in <RevealItem>. */
export function RevealGroup({ children, className, stagger = 0.08, as = "div" }: { children: ReactNode; className?: string; stagger?: number; as?: "div" | "ul" | "ol" }) {
  const Tag = motion[as];
  return (
    <Tag className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} variants={{ hidden: {}, show: { transition: { staggerChildren: stagger } } }}>
      {children}
    </Tag>
  );
}
export const revealItem = { hidden: { opacity: 0, y: 20, filter: "blur(8px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } } };
export function RevealItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" }) {
  const Tag = motion[as];
  return <Tag className={className} variants={revealItem}>{children}</Tag>;
}
