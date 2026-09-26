"use client";

/**
 * A person in a list (owner decision, 25 September 2026): their face first, so a row is read at a glance, the name
 * beside it, and a card on hover with the rest: role, teams, employee id, status. The card loads on first hover from
 * /api/orgs/:org/members/:id/card and is remembered for the page, so lists stay light.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquare, CalendarClock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PRESENCE, type Presence } from "@/lib/presence";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type PersonCard = { membership_id: string; display_name: string; role: string; employee_code: string; profile_id: string; avatar_key: string | null; presence: Presence; title: string | null; status_text: string | null; teams: string | null; email: string | null; joined_at: string };
const ROLE: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };
const cache = new Map<string, Promise<PersonCard>>();

function load(orgSlug: string, membershipId: string) {
  const key = `${orgSlug}:${membershipId}`;
  let p = cache.get(key);
  if (!p) { p = api<PersonCard>(`/api/orgs/${orgSlug}/members/${membershipId}/card`); cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
}

export function Person({ orgSlug, membershipId, name, profileId, avatarKey, presence, size = 28, href, showName = true, meta, className, you = false }: {
  orgSlug: string; membershipId: string; name: string; profileId?: string | null; avatarKey?: string | null; presence?: Presence | null; size?: number; href?: string; showName?: boolean; meta?: React.ReactNode; className?: string; you?: boolean;
}) {
  const [card, setCard] = useState<PersonCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  const show = () => {
    timer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) { const up = r.bottom + 240 > window.innerHeight; setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), up }); }
      setOpen(true);
      setFailed(false);
      void load(orgSlug, membershipId).then(setCard).catch(() => setFailed(true));
    }, 220);
  };
  const hide = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setOpen(false); };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const face = <Avatar profileId={card?.profile_id ?? profileId ?? membershipId} name={name} avatarKey={card?.avatar_key ?? avatarKey ?? null} presence={card?.presence ?? presence ?? null} size={size} />;
  const inner = (
    <>
      {face}
      {showName ? <span className="min-w-0"><span className={cn("block truncate text-sm", you ? "font-semibold text-accent" : "font-medium text-fg")}>{you ? "You" : name}</span>{meta ? <span className="block truncate text-xs text-fg-subtle">{meta}</span> : null}</span> : null}
    </>
  );
  const cls = cn("inline-flex max-w-full items-center gap-2.5 align-middle", href && "rounded-[var(--radius-sm)] transition-colors duration-[var(--duration-fast)] hover:text-fg", className);
  return (
    <span ref={anchor} data-no-tip className="relative inline-flex max-w-full" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {href ? <Link href={href} className={cls} aria-label={showName ? undefined : name}>{inner}</Link> : <span className={cls} aria-label={showName ? undefined : name}>{inner}</span>}
      {typeof document !== "undefined" ? createPortal(<AnimatePresence>
        {open ? (
          <motion.div key="card" role="tooltip" initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            className="w-72 rounded-[var(--radius)] border border-border-strong bg-popover p-4 text-left shadow-[var(--card-shadow)]" onMouseEnter={() => { if (timer.current) window.clearTimeout(timer.current); }} onMouseLeave={hide}>
            <div className="flex items-center gap-3">
              <Avatar profileId={card?.profile_id ?? profileId ?? membershipId} name={name} avatarKey={card?.avatar_key ?? avatarKey ?? null} presence={card?.presence ?? presence ?? null} size={44} />
              <div className="min-w-0"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-fg-subtle">{card ? [card.title, ROLE[card.role] ?? card.role].filter(Boolean).join(" · ") : failed ? "Could not load; try again" : "Loading…"}</p></div>
            </div>
            {card ? (
              <>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="eyebrow">Status</dt><dd className="flex items-center gap-1.5 text-fg-muted"><span className="inline-block size-1.5 rounded-full" style={{ background: PRESENCE[card.presence].color }} aria-hidden />{PRESENCE[card.presence].label}{card.status_text ? <span className="truncate">· “{card.status_text}”</span> : null}</dd>
                  <dt className="eyebrow">Teams</dt><dd className="truncate text-fg-muted">{card.teams ?? "No team"}</dd>
                  <dt className="eyebrow">Id</dt><dd className="font-mono text-fg-muted">{card.employee_code}</dd>
                  {card.email ? <><dt className="eyebrow">Email</dt><dd className="min-w-0 truncate text-fg-muted">{card.email}</dd></> : null}
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-soft pt-3">
                  <Link href={`/app/${orgSlug}/messages?to=${card.membership_id}`} className="link-action"><MessageSquare aria-hidden />Message</Link>
                  <Link href={`/app/${orgSlug}/workroom/${card.membership_id}`} className="link-action"><CalendarClock aria-hidden />Their day</Link>
                </div>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>, document.body) : null}
    </span>
  );
}
