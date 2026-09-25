"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Activity, BarChart3, Bell, Building2, CreditCard, FileClock, Gauge, LifeBuoy, Mail, Megaphone, Menu, Rocket, Settings, ShieldAlert, ShieldCheck, Tags, UsersRound, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { dashboard: Gauge, organisations: Building2, users: UsersRound, plans: Tags, subscriptions: CreditCard, payments: Wallet, usage: Activity, moderation: ShieldAlert, support: LifeBuoy, marketing: Megaphone, communications: Mail, launch: Rocket, system: BarChart3, audit: FileClock, admins: ShieldCheck, settings: Settings, notifications: Bell };
export type AdminNavGroup = { title: string; items: { label: string; href: string; icon: keyof typeof ICONS }[] };

/** The phone-width menu: a Menu pill that slides the sections in from the right, over the page, and closes on navigation. */
export function AdminMobileMenu({ groups, footer }: { groups: AdminNavGroup[]; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="admin-mobile-menu" onClick={() => setOpen(true)} className="chip chip-link inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium"><Menu className="size-4" aria-hidden />Menu</button>
      <AnimatePresence>
        {open ? (
          <>
            <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => setOpen(false)} className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--overlay)]" aria-hidden />
            <motion.aside key="panel" id="admin-mobile-menu" role="dialog" aria-modal="true" aria-label="Control Center sections" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
              className="fixed inset-y-0 right-0 z-[var(--z-dialog)] flex w-[min(20rem,88vw)] flex-col border-l border-border-strong bg-sidebar shadow-[var(--card-shadow)]">
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-border-soft px-4"><p className="font-display text-base">Sections</p><button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full text-fg-muted hover:bg-wash hover:text-fg"><X className="size-4" aria-hidden /></button></div>
              <div className="flex-1 overflow-y-auto px-2 py-3" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}><AdminNav groups={groups} /></div>
              {footer ? <div className="shrink-0 border-t border-border-soft px-4 py-3 text-sm">{footer}</div> : null}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Control Center" className="space-y-4">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="eyebrow mb-1.5 px-2.5">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = ICONS[it.icon];
              const active = it.href === "/admin" ? pathname === "/admin" : pathname === it.href || pathname.startsWith(`${it.href}/`);
              return (
                <li key={it.href}>
                  <Link href={it.href} aria-current={active ? "page" : undefined} className={cn("group flex min-h-9 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[14px] font-medium text-fg-muted transition-colors duration-[var(--duration-fast)] hover:text-fg", active && "bg-wash-strong text-fg shadow-[inset_0_1px_0_var(--highlight)]")}>
                    <Icon className={cn("size-4 transition-transform duration-200 group-hover:-translate-y-px", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
                    <span className="truncate">{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
