import { cn } from "@/lib/utils";
import { Reveal } from "@/components/landing/reveal";

/** Section opener in the Resend pattern: a lit 3D icon, a title, one grey line beneath. */
export function SectionTitle({ icon, alt = "", title, sub, align = "center", className }: { icon: string; alt?: string; title: React.ReactNode; sub?: React.ReactNode; align?: "center" | "left"; className?: string }) {
  const centered = align === "center";
  return (
    <Reveal className={cn("max-w-3xl", centered && "mx-auto text-center", className)}>
      <span className={cn("lp-icon mb-8", centered && "mx-auto")}><img src={`/icons/${icon}.png`} alt={alt} loading="lazy" /></span>
      <h2 className="text-balance font-display text-4xl leading-[1.06] tracking-[-0.02em] md:text-[56px]">{title}</h2>
      {sub ? <p className={cn("lp-muted mt-5 max-w-2xl text-pretty text-lg leading-relaxed md:text-xl", centered && "mx-auto")}>{sub}</p> : null}
    </Reveal>
  );
}
