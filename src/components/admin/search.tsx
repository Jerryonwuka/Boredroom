"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** Global search: users, organisations, payments, contacts, subscriptions, campaigns. Enter opens the results page. */
export function AdminSearch() {
  const router = useRouter();
  return (
    <form role="search" className="relative hidden sm:block" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (typeof q === "string" && q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input name="q" type="search" placeholder="Search users, organisations, payments…" aria-label="Search the platform" className="h-10 w-72 rounded-full border border-border bg-inset pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle" />
    </form>
  );
}
