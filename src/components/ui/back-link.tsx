"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatedChevronLeft } from "@/components/ui/animated-icons";

/**
 * Goes back in history when the previous page was inside the app; otherwise follows the fallback link. The link's hit
 * area reaches past its text (a 40px target) without moving anything around it. v4: 14/20 medium, secondary, a chevron.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Link href={href} onClick={(e) => { if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) { e.preventDefault(); router.back(); } }}
      className="relative mb-3 inline-flex items-center gap-1 rounded-md text-sm font-medium text-secondary transition-colors duration-75 hover:text-foreground before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']">
      <AnimatedChevronLeft className="size-4" aria-hidden />{label}
    </Link>
  );
}
