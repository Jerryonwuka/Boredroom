"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Global search: users, organisations, payments, contacts, subscriptions, campaigns. v4 (spec §6): the top bar's
 * centred search, 32px tall, 230px, r12, an outline with the 13px prompt and the ⌘ K keys. It is the field itself:
 * ⌘K (Ctrl K) puts the cursor in it, Enter opens the results page. While it has focus the border turns to the
 * foreground and the magnifier orange (accent rules, 6 October 2026).
 */
export function AdminSearch({ className }: { className?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const mod = useSyncExternalStore(noSubscribe, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form role="search" action="/admin/search"
      onSubmit={(e) => { e.preventDefault(); const q = input.current?.value.trim() ?? ""; if (!q) return; router.push(`/admin/search?q=${encodeURIComponent(q)}`); e.currentTarget.reset(); input.current?.blur(); }}
      className={cn("group flex h-8 w-[230px] items-center gap-2 rounded-xl border border-border-input bg-background pl-3 pr-1.5 transition-[border-color,box-shadow] duration-75 hover:border-border-input-hover focus-within:border-foreground focus-within:shadow-[var(--field-ring)] focus-within:hover:border-foreground", className)}>
      <Search className="size-4 shrink-0 text-secondary transition-colors duration-75 group-focus-within:text-accent" aria-hidden />
      <input ref={input} name="q" type="text" enterKeyHint="search" autoComplete="off" spellCheck={false} aria-label="Search users, organisations, payments, contacts, subscriptions and campaigns"
        aria-keyshortcuts={mod === "⌘" ? "Meta+K" : "Control+K"} placeholder="Search everything…"
        className="h-full min-w-0 flex-1 bg-transparent text-meta font-normal text-foreground outline-none placeholder:text-secondary" />
      <span className="flex shrink-0 gap-1 group-focus-within:hidden" aria-hidden><Kbd>{mod}</Kbd><Kbd>K</Kbd></span>
    </form>
  );
}
