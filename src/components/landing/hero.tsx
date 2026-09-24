"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { BackgroundRippleEffect } from "@/components/aceternity/background-ripple-effect";
import { ContainerScroll } from "@/components/aceternity/container-scroll-animation";
import { FlipWords } from "@/components/aceternity/flip-words";
import { DashboardMock } from "@/components/landing/mocks";

const EASE = [0.23, 1, 0.32, 1] as const;
const rise = (delay: number) => ({ initial: { opacity: 0, y: 24, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.9, ease: EASE, delay } });

/** The hero copy. It is the scroll container's title, so it drifts up as the dashboard rises to meet the header. */
function HeroCopy({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="pointer-events-none relative mx-auto max-w-6xl px-6 pt-8 text-center md:pt-14">
      <motion.div {...rise(0)} className="pointer-events-auto">
        <Link href="/signup?intent=org" className="lp-muted inline-flex items-center gap-2 lp-glass rounded-full px-4 py-1.5 text-sm transition-colors hover:text-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />Boredroom is in private pilot. Bring your team.
        </Link>
      </motion.div>
      <motion.h1 {...rise(0.1)} className="mx-auto mt-8 max-w-5xl font-display text-[52px] leading-[1.02] tracking-[-0.03em] md:text-[96px]">
        Know what your
        <br />
        team is{" "}
        <FlipWords words={["doing", "stuck on"]} duration={3000} className="text-accent" />
      </motion.h1>
      <motion.p {...rise(0.2)} className="lp-muted mx-auto mt-7 max-w-2xl text-pretty text-lg leading-relaxed md:text-xl">
        What people plan, the time they put in, what they deliver and what their lead accepts, in one place, live. Without check-in calls, and without a productivity score.
      </motion.p>
      <motion.div {...rise(0.3)} className="pointer-events-auto mt-9 flex flex-wrap justify-center gap-3">
        {signedIn ? <Link href="/app" className="lp-btn lp-btn-primary">Open your workspace</Link> : <Link href="/signup?intent=org" className="lp-btn lp-btn-primary">Get started</Link>}
        <a href="#how" className="lp-btn lp-btn-secondary">How it works</a>
      </motion.div>
    </div>
  );
}

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* The ripple grid: hover lights a cell, a click sends a ring out. Sits under the copy, above the sky. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[760px] [mask-image:linear-gradient(to_bottom,#000,transparent_95%)]">
        <BackgroundRippleEffect rows={10} cols={40} cellSize={56} />
      </div>
      <div aria-hidden className="lp-glow pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-70" />
      <div className="pointer-events-none relative">
        <ContainerScroll titleComponent={<HeroCopy signedIn={signedIn} />}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.4 }} className="h-full" aria-hidden>
            <DashboardMock />
          </motion.div>
        </ContainerScroll>
      </div>
    </section>
  );
}
