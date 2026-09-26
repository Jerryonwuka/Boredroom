"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GooeyInput } from "@/components/aceternity/gooey-input";
import { cn } from "@/lib/utils";

const SURFACE = "border border-border bg-[var(--btn-bg)] text-fg ring-0";

/**
 * Global search: users, organisations, payments, contacts, subscriptions, campaigns. The same collapsing gooey
 * input as the workspace top bar (owner decision, 25 September 2026): a round button that opens into a field when
 * clicked and folds away when it loses focus. Enter opens the results page.
 */
export function AdminSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div role="search" className="relative" onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { e.preventDefault(); router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`); setQ(""); } }}>
      <GooeyInput placeholder="Search users, organisations…" value={q} onValueChange={setQ} onOpenChange={(o) => { if (!o) setQ(""); }} collapsedWidth={44} expandedWidth={260} expandedOffset={48}
        classNames={{ trigger: cn(SURFACE, "px-3"), input: "text-fg placeholder:text-fg-subtle", bubbleSurface: SURFACE }} />
    </div>
  );
}
