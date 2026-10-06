import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Boredroom logo (owner decision, 6 October 2026): the owner's artwork ("Boredroom logo.png"), the italic wordmark with the
 * orange dot. public/brand holds it twice, light letters for dark backgrounds and near-black letters for light ones (the dot
 * stays orange in both), and the theme picks one. `mark` is the short "B." for tight spots such as the collapsed sidebar.
 * The artwork is 519×58 (the mark 72×58); `height` sets the drawn height in pixels and the width follows.
 */
const ART = {
  full: { w: 519, h: 58, dark: "/brand/logo-on-dark.png", light: "/brand/logo-on-light.png" },
  mark: { w: 72, h: 58, dark: "/brand/mark-on-dark.png", light: "/brand/mark-on-light.png" },
};

export function LogoArt({ variant = "full", height = 16, className }: { variant?: keyof typeof ART; height?: number; className?: string }) {
  const art = ART[variant];
  const width = Math.round((art.w / art.h) * height);
  return (
    <span className={cn("inline-flex shrink-0", className)} style={{ height, width }}>
      <Image src={art.dark} alt="" width={width} height={height} loading="eager" className="block h-full w-auto [html[data-theme=light]_&]:hidden" />
      <Image src={art.light} alt="" width={width} height={height} loading="eager" className="hidden h-full w-auto [html[data-theme=light]_&]:block" />
    </span>
  );
}

export function Logo({ className, href = "/", variant = "full", height = 16 }: { className?: string; href?: string; variant?: keyof typeof ART; height?: number }) {
  return (
    <Link href={href} className={cn("inline-flex items-center rounded-[6px]", className)} aria-label="Boredroom home">
      <LogoArt variant={variant} height={height} />
    </Link>
  );
}
