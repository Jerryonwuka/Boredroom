"use client";

/**
 * The top-right cluster on every workspace page: notifications, settings (organisation accounts) and the person,
 * each an icon that opens a panel with the details. One panel open at a time; outside click and Escape close it.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Settings, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { relativeTime, cn } from "@/lib/utils";
import type { RecentNotification } from "@/server/services/workspace";

type Panel = "notifications" | "settings" | "profile";
export type TopBarUser = { profileId: string; displayName: string; email: string; avatarKey?: string | null; title?: string | null; statusText?: string | null };

export function TopBar({ orgSlug, user, roleLabel, isOrg, unread, attention, recent, className }: { orgSlug: string; user: TopBarUser; roleLabel: string; isOrg: boolean; unread: number; attention: number; recent: RecentNotification[]; className?: string }) {
  const [open, setOpen] = useState<Panel | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const base = `/app/${orgSlug}`;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const toggle = (p: Panel) => setOpen((o) => (o === p ? null : p));
  const iconBtn = "relative inline-flex size-10 items-center justify-center rounded-full border border-border bg-[linear-gradient(180deg,#1d1d1d,#141414)] text-fg-muted transition-[color,border-color,background-color] duration-[var(--duration-fast)] hover:border-border-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";
  const panel = "absolute right-0 top-[calc(100%+8px)] z-[var(--z-dropdown)] w-[22rem] max-w-[calc(100vw-2rem)] tile p-2 text-left";

  return (
    <div ref={ref} className={cn("relative flex items-center gap-2", className)}>
      <div className="relative">
        <button type="button" className={iconBtn} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open === "notifications"} aria-controls="topbar-notifications" onClick={() => toggle("notifications")}>
          <Bell className="size-[18px]" aria-hidden />
          {unread ? <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums text-accent-fg">{unread > 99 ? "99+" : unread}</span> : null}
        </button>
        {open === "notifications" ? (
          <div id="topbar-notifications" role="dialog" aria-label="Notifications" className={panel}>
            <div className="flex items-center justify-between px-2 py-1.5"><p className="font-semibold">Notifications</p><span className="text-xs text-fg-subtle">{unread ? `${unread} unread` : "all read"}</span></div>
            {recent.length === 0 ? <p className="px-2 py-6 text-center text-sm text-fg-muted">Nothing yet. Assignments, review requests and decisions land here as they happen.</p> : (
              <ul className="max-h-[22rem] divide-y divide-border-soft overflow-y-auto">
                {recent.map((n) => (
                  <li key={n.id} className={cn("flex items-start gap-2.5 px-2 py-2.5", !n.read_at && "bg-white/[0.03]")}>
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                    <div className="min-w-0 flex-1">
                      {n.href ? <Link href={n.href} onClick={() => setOpen(null)} className="block text-sm font-medium hover:underline">{n.title}</Link> : <p className="text-sm font-medium">{n.title}</p>}
                      {n.body ? <p className="line-clamp-2 text-xs text-fg-muted">{n.body}</p> : null}
                      <p className="mt-0.5 text-[11px] text-fg-subtle">{relativeTime(n.created_at)}</p>
                    </div>
                    {!n.read_at ? <button type="button" className="shrink-0 text-xs text-fg-subtle hover:text-fg" onClick={async () => { await api(`/api/orgs/${orgSlug}/notifications/${n.id}`, { method: "PATCH" }); router.refresh(); }}>Mark read</button> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border-soft p-2"><Link href={`${base}/notifications`} onClick={() => setOpen(null)}><Button size="sm" variant="subtle" className="w-full">All notifications</Button></Link></div>
          </div>
        ) : null}
      </div>

      {isOrg ? (
        <div className="relative">
          <button type="button" className={iconBtn} aria-label="Settings" aria-expanded={open === "settings"} aria-controls="topbar-settings" onClick={() => toggle("settings")}>
            <Settings className="size-[18px]" aria-hidden />
          </button>
          {open === "settings" ? (
            <div id="topbar-settings" role="dialog" aria-label="Settings" className={panel}>
              <p className="px-2 py-1.5 font-semibold">Settings</p>
              <ul className="text-sm">
                {[
                  [`${base}/settings`, "Organisation settings", "Recording, AI assistant, schedule, policy, grants"],
                  [`${base}/people`, "People and teams", "Join code, invitations, team leads"],
                  [`${base}/reviews`, "Review queue", attention ? `${attention} waiting for a decision` : "Nothing waiting"],
                  [`${base}/policy`, "Monitoring notice", "What is recorded, and who has acknowledged it"],
                  [`${base}/audit`, "Audit log", "Who did what and when"],
                ].map(([href, label, hint]) => (
                  <li key={href}><Link href={href} onClick={() => setOpen(null)} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-white/[0.05]"><span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className="block truncate text-xs text-fg-subtle">{hint}</span></span><ChevronRight className="size-4 text-fg-subtle" aria-hidden /></Link></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        <button type="button" className={cn(iconBtn, "overflow-hidden p-0")} aria-label={`Your account, ${user.displayName}`} aria-expanded={open === "profile"} aria-controls="topbar-profile" onClick={() => toggle("profile")}>
          <Avatar profileId={user.profileId} name={user.displayName} avatarKey={user.avatarKey} size={38} className="border-0" />
        </button>
        {open === "profile" ? (
          <div id="topbar-profile" role="dialog" aria-label="Your account" className={panel}>
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar profileId={user.profileId} name={user.displayName} avatarKey={user.avatarKey} size={48} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{user.displayName}</p>
                {user.title ? <p className="truncate text-xs text-fg-muted">{user.title}</p> : null}
                <p className="truncate text-xs text-fg-subtle">{user.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-2 pb-2"><Badge tone="accent">{roleLabel}</Badge>{user.statusText ? <span className="truncate text-xs text-fg-muted">“{user.statusText}”</span> : <span className="text-xs text-fg-subtle">No status set</span>}</div>
            <ul className="border-t border-border-soft pt-1 text-sm">
              <li><Link href={`${base}/profile`} onClick={() => setOpen(null)} className="block rounded-[var(--radius-sm)] px-2 py-2 hover:bg-white/[0.05]">Your profile</Link></li>
              <li><Link href="/app" onClick={() => setOpen(null)} className="block rounded-[var(--radius-sm)] px-2 py-2 hover:bg-white/[0.05]">Switch workspace</Link></li>
              <li><button type="button" className="block w-full rounded-[var(--radius-sm)] px-2 py-2 text-left hover:bg-white/[0.05]" onClick={async () => { await api("/api/auth/logout", { method: "POST", retries: 0 }); router.push("/login"); router.refresh(); }}>Sign out</button></li>
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
