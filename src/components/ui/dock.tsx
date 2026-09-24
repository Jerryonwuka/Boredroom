"use client";

/**
 * The dock reference the owner supplied (24 September 2026): a row of icon tiles that lift on hover with a
 * label beneath. Kept here as the pattern the workspace sidebar follows (`components/app/sidebar.tsx`);
 * the hero around it is the original demo and is not used in the product.
 */
import type { ComponentType, CSSProperties } from "react";
import { Home, Compass, Calendar, Bookmark, Image as ImageIcon, Telescope, Cog, Search } from "lucide-react";

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

export default function HeroDock() {
  const accent = typeof window !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--hero-accent").trim() : "";
  const accentStyle = (accent ? { "--accent": accent } : {}) as CSSProperties;

  return (
    <div className="relative min-h-screen w-full bg-black" style={accentStyle}>
      <div className="absolute inset-0 z-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120, 180, 255, 0.25), transparent 70%), #000000" }} />
      <section className="relative isolate min-h-screen w-full overflow-hidden px-4 text-white sm:px-8">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 [mask-image:radial-gradient(90%_70%_at_50%_45%,black,transparent_85%)] sm:[mask-image:radial-gradient(80%_60%_at_50%_40%,black,transparent_80%)]" />
          <div className="animate-marquee-left absolute inset-y-0 left-0 w-24 opacity-40 blur-xl [background:linear-gradient(90deg,rgba(255,255,255,0.25),transparent)] sm:w-40 sm:opacity-60 sm:blur-2xl" />
          <div className="animate-marquee-right absolute inset-y-0 right-0 w-24 opacity-40 blur-xl [background:linear-gradient(270deg,rgba(255,255,255,0.25),transparent)] sm:w-40 sm:opacity-60 sm:blur-2xl" />
        </div>
        <div className="pointer-events-none absolute inset-0 -z-20 opacity-[0.05] [background-image:radial-gradient(rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:12px_12px]" />
        <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-start gap-4 text-center sm:gap-8" style={{ marginTop: "20%" }}>
          <h1 className="text-balance font-semibold tracking-tight text-white/90 [font-size:clamp(20px,4.5vw,38px)]">The Dali Agents console</h1>
          <p className="mx-auto max-w-xl text-pretty text-xs text-white/70 sm:text-sm">One dock for every agent surface. AI agents that work - or you don&apos;t pay.</p>
          <div className="relative mt-6 w-full max-w-[85%] sm:max-w-[80%]">
            <div className="flex items-center justify-center"><Dock /></div>
            <div className="mt-4 flex justify-center">
              <a href="https://daliagents.com" target="_blank" rel="noreferrer" className="text-[10px] tracking-wide text-white/40 transition-colors hover:text-white/70">daliagents.com</a>
            </div>
          </div>
        </div>
      </section>
      <style>{`
        @keyframes marqueeLeft { 0% { transform: translateX(-60%); } 100% { transform: translateX(0%); } }
        @keyframes marqueeRight { 0% { transform: translateX(60%); } 100% { transform: translateX(0%); } }
        .animate-marquee-left { animation: marqueeLeft 8s linear infinite alternate; }
        .animate-marquee-right { animation: marqueeRight 8s linear infinite alternate; }
        .hover-halo{position:relative}
        .hover-halo::after{content:"";position:absolute;inset:-2px;border-radius:inherit;opacity:0;transition:opacity .25s, transform .25s;box-shadow:0 0 0 0 rgba(255,255,255,.18),0 12px 30px -10px rgba(0,0,0,.7)}
        .hover-halo:hover::after{opacity:1;}
        .tooltip{opacity:0;transform:translateY(6px);transition:opacity .2s, transform .2s}
        .group:hover .tooltip{opacity:1;transform:translateY(0)}
      `}</style>
    </div>
  );
}

export function Dock() {
  return (
    <div className="relative flex scale-90 items-center gap-2 sm:scale-95 sm:gap-4">
      <div className="flex items-center gap-3 rounded-[28px] bg-neutral-900/80 px-3 py-2 shadow-2xl ring-1 ring-white/10 backdrop-blur-lg sm:gap-5 sm:rounded-[48px] sm:px-6 sm:py-3">
        <DockIcon icon={Home} label="Agents" />
        <DockIcon icon={Compass} label="Leads" />
        <DockIcon icon={Calendar} label="Operations" badge="4" />
        <DockIcon icon={Bookmark} label="Support" />
        <DockIcon icon={ImageIcon} label="Care" />
        <DockIcon icon={Telescope} label="Rescue" />
        <span className="mx-1 hidden h-6 w-px bg-white/10 sm:block" aria-hidden="true" />
        <DockIcon icon={Search} label="Search" />
        <DockIcon icon={Cog} label="Settings" />
      </div>
    </div>
  );
}

export function DockIcon({ icon: Icon, label, badge }: { icon: IconType; label: string; badge?: string }) {
  return (
    <button type="button" className="hover-halo group relative grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-b from-neutral-800/60 to-neutral-900/70 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 hover:scale-[1.05] sm:h-14 sm:w-14" aria-label={label}>
      <Icon className="h-5 w-5 text-white/85 transition-transform duration-200 group-hover:scale-110" strokeWidth={2.1} />
      {badge ? <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] font-semibold text-neutral-900 ring-1 ring-white/80">{badge}</span> : null}
      <span className="tooltip pointer-events-none absolute -bottom-6 translate-y-1/2 text-[9px] tracking-wide text-white/70 sm:text-[10px]">{label}</span>
    </button>
  );
}
