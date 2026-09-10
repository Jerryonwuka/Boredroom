import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("font-display text-xl tracking-wide text-fg", className)} aria-label="Boredroom home">
      BOREDROOM<span className="text-accent">.</span>
    </Link>
  );
}
