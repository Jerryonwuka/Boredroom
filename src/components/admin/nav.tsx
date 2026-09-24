"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bell, Building2, CreditCard, FileClock, Gauge, LifeBuoy, Mail, Megaphone, Rocket, Settings, ShieldAlert, ShieldCheck, Tags, UsersRound, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { dashboard: Gauge, organisations: Building2, users: UsersRound, plans: Tags, subscriptions: CreditCard, payments: Wallet, usage: Activity, moderation: ShieldAlert, support: LifeBuoy, marketing: Megaphone, communications: Mail, launch: Rocket, system: BarChart3, audit: FileClock, admins: ShieldCheck, settings: Settings, notifications: Bell };
export type AdminNavGroup = { title: string; items: { label: string; href: string; icon: keyof typeof ICONS }[] };

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
