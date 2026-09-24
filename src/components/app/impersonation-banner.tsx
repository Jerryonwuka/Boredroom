"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** Shown across the top of every app page while an administrator is viewing Boredroom as this person. */
export function ImpersonationBanner({ name, adminEmail }: { name: string; adminEmail: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <div role="status" className="sticky top-0 z-[var(--z-toast)] flex flex-wrap items-center justify-between gap-3 border-b border-warning/50 bg-warning/15 px-4 py-2 text-sm">
      <p className="flex items-center gap-2"><TriangleAlert className="size-4 text-warning" aria-hidden /><span><strong>You are viewing Boredroom as {name}</strong> <span className="text-fg-muted">(signed in as {adminEmail}). Everything you do here is recorded against the impersonation.</span></span></p>
      <Button size="sm" variant="outline" disabled={pending} onClick={async () => { setPending(true); try { const r = await api<{ next: string }>("/api/admin/impersonate/stop", { method: "POST", retries: 0 }); router.push(r.next); router.refresh(); } finally { setPending(false); } }}>{pending ? "Returning…" : "Return to admin"}</Button>
    </div>
  );
}
