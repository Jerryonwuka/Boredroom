"use client";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { BackgroundRippleEffect } from "@/components/aceternity/background-ripple-effect";
import { ContainerScroll } from "@/components/aceternity/container-scroll-animation";
import { FlipWords } from "@/components/aceternity/flip-words";
import { DashboardMock } from "@/components/landing/mocks";

export type LandingCopy = { headline: string; subheadline: string; cta: string };

const EASE = [0.23, 1, 0.32, 1] as const;
/** The faces in the trust pill above the headline; served from public/users. */
const USERS = [1, 2, 3, 4, 5].map((n) => `/users/user-${n}.jpg`);
const rise = (delay: number) => ({ initial: { opacity: 0, y: 24, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.9, ease: EASE, delay } });

/** The hero copy. It is the scroll container's title, so it drifts up as the dashboard rises to meet the header. */
function HeroCopy({ signedIn, waitlist, copy }: { signedIn: boolean; waitlist: boolean; copy: LandingCopy }) {
  return (
    <div className="pointer-events-none relative mx-auto max-w-6xl px-6 pt-8 text-center md:pt-14">
      <motion.div {...rise(0)} className="pointer-events-auto">
        <Link href={waitlist ? "#waitlist" : "/signup?intent=org"} className="lp-muted inline-flex items-center gap-3 lp-glass rounded-full py-1.5 pl-2 pr-4 text-sm transition-colors hover:text-fg">
          <span className="flex -space-x-2.5" aria-hidden>
            {USERS.map((src, i) => <Image key={src} src={src} alt="" width={28} height={28} priority className="h-7 w-7 rounded-full border-2 border-bg object-cover" style={{ zIndex: USERS.length - i }} />)}
          </span>
          <span>{waitlist ? "Opening soon. Join the waitlist." : <>Trusted by <strong className="font-semibold text-fg">10k+</strong> users.</>}</span>
        </Link>
      </motion.div>
      <motion.h1 {...rise(0.1)} className="mx-auto mt-8 max-w-5xl font-display text-[52px] leading-[1.02] tracking-[-0.03em] md:text-[96px]">
        {waitlist && copy.headline ? copy.headline : <>Know what your<br />team is{" "}<FlipWords words={["doing", "stuck on"]} duration={3000} className="text-accent" /></>}
      </motion.h1>
      <motion.p {...rise(0.2)} className="lp-muted mx-auto mt-7 max-w-2xl text-pretty text-lg leading-relaxed md:text-xl">
        {waitlist && copy.subheadline ? copy.subheadline : "What people plan, the time they put in, what they deliver and what their lead accepts, in one place, live. Without check-in calls, and without a productivity score."}
      </motion.p>
      {/* In waitlist mode the form lives in the closing section (#waitlist); the hero only points there. */}
      <motion.div {...rise(0.3)} className="pointer-events-auto mt-9 flex flex-wrap justify-center gap-3">
        {signedIn ? <Link href="/app" className="lp-btn lp-btn-primary">Open your workspace</Link>
          : waitlist ? <a href="#waitlist" className="lp-btn lp-btn-primary">{copy.cta || "Join the waitlist"}</a>
          : <Link href="/signup?intent=org" className="lp-btn lp-btn-primary">Get started</Link>}
        <a href="#how" className="lp-btn lp-btn-secondary">How it works</a>
      </motion.div>
    </div>
  );
}

export function Hero({ signedIn, waitlist = false, copy = { headline: "", subheadline: "", cta: "" } }: { signedIn: boolean; waitlist?: boolean; copy?: LandingCopy }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* The ripple grid: hover lights a cell, a click sends a ring out. Sits under the copy, above the sky. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[760px] [mask-image:linear-gradient(to_bottom,#000,transparent_95%)]">
        <BackgroundRippleEffect rows={10} cols={40} cellSize={56} />
      </div>
      <div aria-hidden className="lp-glow pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-70" />
      <div className="pointer-events-none relative">
        <ContainerScroll titleComponent={<HeroCopy signedIn={signedIn} waitlist={waitlist} copy={copy} />}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.4 }} className="h-full" aria-hidden>
            <DashboardMock />
          </motion.div>
        </ContainerScroll>
      </div>
    </section>
  );
}
