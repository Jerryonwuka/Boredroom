"use client";

/**
 * The top bar, v4 (spec §6): 50px, the canvas at 90% with an 8px blur behind it and a hairline under it, sticky over
 * the page. Three columns: the sidebar toggle (the menu button on phones) and the breadcrumb | the centred search
 * button | the icon buttons: theme, notifications (a popover with the recent ones), settings for the people who run
 * the workspace (a menu), and the person's avatar (a popover: who they are, their work status, their links, sign out).
 * Below lg the search is an icon on the right. Pop-ups close on Escape (focus back on their button) and a click outside.
 * Accent rules (6 October 2026): the unread dot on the bell and beside each unread notification is orange (attention);
 * the work-status picker's chosen status keeps its own status colour (status meaning wins over accent).
 *
 * `data-app-topbar` is the hook Brenda's chat uses to hide the bar while it is open (globals.css).
 *
 * Its icons are animated (owner request, 7 October 2026; components/ui/animated-icons): the bell rings, the gear turns,
 * the sun lights its rays and so on while their button or menu item is hovered or focused from the keyboard; never on a
 * loop, still under reduced motion.
 *
 * The account menu links to the person's own assistant in Settings, "Your assistant", with its glyph (owner decision,
 * 7 October 2026: personal assistants; Settings opens for everyone for that section).
 *
 * Between assistants (owner decision, 8 October 2026: personal assistants, phase 6): a notification another person's
 * assistant brought says what kind it is after its time ("2 min ago, Request to accept"), as the Notifications page does,
 * so a request to accept reads differently from a passed-on message at a glance; each opens its card.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AnimatedBell, AnimatedBuilding2, AnimatedClipboardCheck, AnimatedLogOut, AnimatedSearch, AnimatedSettings, AnimatedShieldCheck, AnimatedUser, AnimatedUsersRound,
} from "@/components/ui/animated-icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuItem, Popover } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PresenceDot } from "@/components/ui/presence";
import { Breadcrumb, type CrumbPage } from "@/components/app/breadcrumb";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { SidebarToggle } from "@/components/app/sidebar";
import { SEARCH_DIALOG_ID, SearchTrigger, WorkspaceSearch } from "@/components/app/workspace-search";
import { PRESENCE, PRESENCES, type Presence } from "@/lib/presence";
import { api } from "@/lib/api-client";
import { relativeTime, cn } from "@/lib/utils";
import type { RecentNotification } from "@/server/services/workspace";

export type TopBarUser = { profileId: string; displayName: string; email: string; avatarKey?: string | null; title?: string | null; statusText?: string | null; presence?: Presence | null; isAdmin?: boolean };

/** The work status: four choices, saved at once, shown as the dot on the avatar everywhere. */
export function PresencePicker({ value, className }: { value: Presence; className?: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState<Presence>(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (p: Presence) => {
    if (p === current) return;
    const was = current;
    setPending(true); setError(null); setCurrent(p);
    try { await api("/api/me/presence", { method: "PATCH", body: { presence: p } }); router.refresh(); }
    catch { setCurrent(was); setError("Your status did not change. Check your connection and try again."); }
    finally { setPending(false); }
  };
  return (
    <div className={cn("border-t border-border px-1 pb-1 pt-2", className)}>
      <p className="px-2 pb-1 text-xs font-medium text-subtle">Work status</p>
      <div role="radiogroup" aria-label="Work status" aria-busy={pending} className="grid grid-cols-2 gap-0.5">
        {PRESENCES.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={current === p} disabled={pending} onClick={() => void choose(p)}
            className={cn("flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm font-medium transition-colors duration-75 disabled:opacity-60 pointer-coarse:h-10", current === p ? "bg-fill-1 text-foreground" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>
            <span aria-hidden className="inline-flex"><PresenceDot presence={p} size={8} withRing={false} /></span>
            <span className="truncate">{PRESENCE[p].label}</span>
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-1.5 px-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/** "Mark read" on one notification: says when it is working and when it did not work, instead of failing silently. */
function MarkRead({ orgSlug, id }: { orgSlug: string; id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  return (
    <Button variant="ghost" size="xs" disabled={state === "pending"} className={cn("relative z-[1] -my-0.5 shrink-0", state === "failed" && "text-danger hover:text-danger")}
      onClick={async () => { setState("pending"); try { await api(`/api/orgs/${orgSlug}/notifications/${id}`, { method: "PATCH" }); router.refresh(); setState("idle"); } catch { setState("failed"); } }}>
      {state === "pending" ? "Marking…" : state === "failed" ? "Try again" : "Mark read"}
    </Button>
  );
}

/** The kind of a phase 6 notification in words (the Notifications page uses the same). */
const ASSISTANT_KINDS: Record<string, string> = {
  "assistant.message": "Passed-on message", "assistant.request": "Request to accept", "assistant.reply": "Reply", "assistant.outcome": "Request update",
  "assistant.tagged": "Your assistant in Messages", "assistant.thread_reply": "Reply in Messages",
};

function Notifications({ orgSlug, unread, recent }: { orgSlug: string; unread: number; recent: RecentNotification[] }) {
  return (
    <Popover align="end" label="Notifications" width="min(360px, calc(100vw - 16px))" className="p-1"
      trigger={
        <IconButton aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <AnimatedBell aria-hidden />
          {unread ? <span aria-hidden className="absolute right-[7px] top-[7px] size-2 rounded-full bg-accent ring-2 ring-background" /> : null}
        </IconButton>
      }>
      {(close) => (
        <>
          <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1.5">
            <p className="text-sm font-medium text-foreground">Notifications</p>
            <span className="text-xs text-subtle">{unread ? `${unread} unread` : "All read"}</span>
          </div>
          {recent.length === 0 ? (
            <EmptyState compact icon={AnimatedBell} title="Nothing yet" description="Assignments, review requests and decisions land here as they happen." />
          ) : (
            <ul className="scroll-thin max-h-[min(22rem,60dvh)] overflow-y-auto">
              {recent.map((n) => (
                <li key={n.id} className="relative flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors duration-75 hover:bg-fill-1">
                  <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                  <div className="min-w-0 flex-1">
                    {/* The title's link covers the row; Mark read sits above it. */}
                    {n.href
                      ? <Link href={n.href} onClick={close} className="block rounded-sm text-sm font-medium text-foreground after:absolute after:inset-0 after:rounded-lg">{n.title}{n.read_at ? null : <span className="sr-only"> (unread)</span>}</Link>
                      : <p className="text-sm font-medium text-foreground">{n.title}{n.read_at ? null : <span className="sr-only"> (unread)</span>}</p>}
                    {n.body ? <p className="mt-0.5 line-clamp-2 text-meta font-normal text-secondary">{n.body}</p> : null}
                    <p className="mt-0.5 text-xs text-subtle"><time dateTime={n.created_at}>{relativeTime(n.created_at)}</time>{ASSISTANT_KINDS[n.type] ? `, ${ASSISTANT_KINDS[n.type]}` : null}</p>
                  </div>
                  {!n.read_at ? <MarkRead orgSlug={orgSlug} id={n.id} /> : null}
                </li>
              ))}
            </ul>
          )}
          <div role="separator" className="menu-separator" />
          <Link href={`/app/${orgSlug}/notifications`} onClick={close} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}>All notifications</Link>
        </>
      )}
    </Popover>
  );
}

function SettingsMenu({ orgSlug, attention }: { orgSlug: string; attention: number }) {
  const base = `/app/${orgSlug}`;
  return (
    <Menu align="end" label="Settings" trigger={<IconButton aria-label="Settings"><AnimatedSettings aria-hidden /></IconButton>}>
      {/* No policy page any more (owner decision, 5 October 2026): working hours and recording rules are in Settings. */}
      <MenuItem href={`${base}/settings`} icon={<AnimatedSettings aria-hidden />}>Organisation settings</MenuItem>
      <MenuItem href={`${base}/people`} icon={<AnimatedUsersRound aria-hidden />}>People and teams</MenuItem>
      <MenuItem href={`${base}/reviews`} icon={<AnimatedClipboardCheck aria-hidden />} kbd={attention ? (attention > 99 ? "99+" : attention) : undefined}>Review queue</MenuItem>
      <MenuItem href={`${base}/audit`} icon={<AnimatedShieldCheck aria-hidden />}>Audit log</MenuItem>
    </Menu>
  );
}

function Account({ orgSlug, user, roleLabel }: { orgSlug: string; user: TopBarUser; roleLabel: string }) {
  const router = useRouter();
  const [signOut, setSignOut] = useState<"idle" | "pending" | "failed">("idle");
  const presence = user.presence ?? "active";
  return (
    <Popover align="end" label="Your account" width={288} className="p-1"
      trigger={
        <button type="button" aria-label={`Your account, ${user.displayName}`} className="relative ml-1 grid size-8 shrink-0 place-items-center rounded-full transition-opacity duration-75 hover:opacity-90 pointer-coarse:size-10">
          <Avatar profileId={user.profileId} name={user.displayName} avatarKey={user.avatarKey} presence={presence} size={32} />
        </button>
      }>
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2 pb-2 pt-1.5">
            <Avatar profileId={user.profileId} name={user.displayName} avatarKey={user.avatarKey} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{user.displayName}</p>
              <p className="truncate text-meta font-normal text-secondary">{user.email}</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-2">
            <Badge>{roleLabel}</Badge>
            {user.title ? <span className="min-w-0 truncate text-xs text-secondary">{user.title}</span> : null}
          </div>
          {user.statusText ? <p className="px-2 pb-2 text-meta font-normal text-secondary">“{user.statusText}”</p> : null}
          <div role="separator" className="menu-separator" />
          <PresencePicker value={presence} className="border-0 pt-1" />
          <div role="separator" className="menu-separator" />
          <Link href={`/app/${orgSlug}/profile`} onClick={close} className="menu-item"><AnimatedUser aria-hidden />Your profile</Link>
          <Link href={`/app/${orgSlug}/settings?section=assistant`} onClick={close} className="menu-item"><BrendaGlyph aria-hidden />Your assistant</Link>
          <Link href="/app?switch=1" onClick={close} className="menu-item"><AnimatedBuilding2 aria-hidden />Switch workspace</Link>
          {user.isAdmin ? <Link href="/admin" onClick={close} className="menu-item"><AnimatedShieldCheck aria-hidden />Control Center</Link> : null}
          <div role="separator" className="menu-separator" />
          <button type="button" disabled={signOut === "pending"} className="menu-item disabled:opacity-60"
            onClick={async () => { setSignOut("pending"); try { await api("/api/auth/logout", { method: "POST", retries: 0 }); router.push("/login"); router.refresh(); } catch { setSignOut("failed"); } }}>
            <AnimatedLogOut aria-hidden />{signOut === "pending" ? "Signing out…" : "Sign out"}
          </button>
          {signOut === "failed" ? <p role="alert" className="px-2 pb-1.5 pt-1 text-xs text-danger">Could not sign out. Check your connection and try again.</p> : null}
        </>
      )}
    </Popover>
  );
}

export function TopBar({ orgSlug, orgName, user, roleLabel, isOrg, unread, attention, recent, pages, brenda = false, menu, className }: {
  orgSlug: string; orgName: string; user: TopBarUser; roleLabel: string; isOrg: boolean; unread: number; attention: number; recent: RecentNotification[];
  /** Every page the search and the breadcrumb know, with its sidebar group. */ pages: CrumbPage[];
  /** Brenda is on for this workspace (the search offers her a search that found nothing). */ brenda?: boolean;
  /** The phone and tablet menu button (MobileNav), first on the left below md. */ menu?: React.ReactNode;
  className?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
    <header data-app-topbar
      className={cn("sticky top-[var(--shell-banners,0px)] z-[var(--z-sticky)] isolate grid h-[50px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[var(--header-bg)] before:backdrop-blur-[8px] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {menu}
        <SidebarToggle className="hidden md:inline-flex" />
        <Breadcrumb orgName={orgName} pages={pages} />
      </div>
      <div className="hidden justify-center lg:flex">
        <SearchTrigger onOpen={() => setSearchOpen(true)} />
      </div>
      <div className="flex items-center justify-end gap-1">
        <IconButton aria-label="Search" aria-haspopup="dialog" aria-controls={SEARCH_DIALOG_ID} className="lg:hidden" onClick={() => setSearchOpen(true)}><AnimatedSearch aria-hidden /></IconButton>
        {/* On phones the theme switch lives in the menu, so the bar fits a 375px screen. */}
        <ThemeToggle className="hidden sm:inline-flex" />
        <Notifications orgSlug={orgSlug} unread={unread} recent={recent} />
        {isOrg ? <SettingsMenu orgSlug={orgSlug} attention={attention} /> : null}
        <Account orgSlug={orgSlug} user={user} roleLabel={roleLabel} />
      </div>
    </header>
    {/* Outside the bar: Brenda's chat hides the bar, and ⌘K still opens the palette there. */}
    <WorkspaceSearch orgSlug={orgSlug} pages={pages} brenda={brenda} open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
