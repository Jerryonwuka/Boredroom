"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Goes back in history when the previous page was inside the app; otherwise follows the fallback link. */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Link href={href} onClick={(e) => { if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) { e.preventDefault(); router.back(); } }}
      className="mb-3 inline-flex items-center gap-1.5 rounded-full text-sm text-fg-muted hover:text-fg">
      <ArrowLeft className="h-4 w-4" aria-hidden />{label}
    </Link>
  );
}
