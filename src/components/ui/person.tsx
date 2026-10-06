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
import { buttonVariants } from "@/components/ui/button";
import { liftToTopLayer, popoverHost } from "@/components/ui/top-layer";

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
  // Inside an open sheet the card mounts in the sheet and lifts into the top layer; elsewhere on the body.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  const show = () => {
    timer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) { const up = r.bottom + 240 > window.innerHeight; setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), up }); }
      setHost(popoverHost(anchor.current));
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
      {showName ? <span className="min-w-0"><span className={cn("block truncate text-sm text-foreground", you ? "font-semibold" : "font-medium")}>{you ? "You" : name}</span>{meta ? <span className="block truncate text-meta font-normal text-secondary">{meta}</span> : null}</span> : null}
    </>
  );
  const cls = cn("inline-flex max-w-full items-center gap-2.5 align-middle", href && "rounded-[10px] transition-colors duration-75 hover:text-foreground", className);
  return (
    <span ref={anchor} data-no-tip className="relative inline-flex max-w-full" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {href ? <Link href={href} className={cls} aria-label={showName ? undefined : name}>{inner}</Link> : <span className={cls} aria-label={showName ? undefined : name}>{inner}</span>}
      {typeof document !== "undefined" ? createPortal(<AnimatePresence>
        {open ? (
          <motion.div ref={liftToTopLayer} key="card" role="tooltip" initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            className="top-pop popover-surface w-72 p-4 text-left" onMouseEnter={() => { if (timer.current) window.clearTimeout(timer.current); }} onMouseLeave={hide}>
            <div className="flex items-center gap-3">
              <Avatar profileId={card?.profile_id ?? profileId ?? membershipId} name={name} avatarKey={card?.avatar_key ?? avatarKey ?? null} presence={card?.presence ?? presence ?? null} size={44} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{name}</p><p className="truncate text-meta font-normal text-secondary">{card ? [card.title, ROLE[card.role] ?? card.role].filter(Boolean).join(", ") : failed ? "Could not load; try again" : "Loading…"}</p></div>
            </div>
            {card ? (
              <>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs font-medium">
                  <dt className="text-subtle">Status</dt><dd className="flex min-w-0 items-center gap-1.5 text-secondary"><span className="inline-block size-1.5 rounded-full" style={{ background: PRESENCE[card.presence].color }} aria-hidden />{PRESENCE[card.presence].label}{card.status_text ? <span className="truncate">, “{card.status_text}”</span> : null}</dd>
                  <dt className="text-subtle">Teams</dt><dd className="truncate text-secondary">{card.teams ?? "No team"}</dd>
                  <dt className="text-subtle">Id</dt><dd className="font-mono text-secondary">{card.employee_code}</dd>
                  {card.email ? <><dt className="text-subtle">Email</dt><dd className="min-w-0 truncate text-secondary">{card.email}</dd></> : null}
                </dl>
                <div className="-mx-1 mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                  <Link href={`/app/${orgSlug}/messages?to=${card.membership_id}`} className={buttonVariants({ variant: "ghost", size: "xs" })}><MessageSquare aria-hidden />Message</Link>
                  <Link href={`/app/${orgSlug}/workroom/${card.membership_id}`} className={buttonVariants({ variant: "ghost", size: "xs" })}><CalendarClock aria-hidden />Their day</Link>
                </div>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>, host ?? document.body) : null}
    </span>
  );
}
