"use client";

/**
 * "Your day" (and, for team leads, "Team"): the figures and lists that sat under Brenda's home panel, moved to My Day
 * (owner request, 7 October 2026: "Carry this section under the Brenda page and take it to the 'My Day' page"). Owners
 * and HR, who are sent from My Day to the Dashboard, see their version at the end of the Dashboard's overview; the
 * Dashboard itself already covers their Team view (who is working, clocked in, late, not in yet).
 *
 * The look is as it was under her panel: stat cards in a row, then calm 64px list rows under quiet labels with their
 * counts (Now, Due today, Overdue, Waiting for your check, Nobody has picked up, Reminders), four to a list with a link
 * to the rest. The page loads the data on the server (briefing() from Brenda's services, the team's timers for leads)
 * and passes it in. Sized by the room it has (container queries), since on My Day it shares the width with "How it
 * works".
 *
 * On My Day (owner request: say nothing twice): the running timer is My Day's own timer card just above, so "Now" keeps
 * only your clock; and the page speaks in its own voice, so Brenda is named rather than saying "me".
 */
import { useId, useState } from "react";
import Link from "next/link";
import { AlarmClock, CalendarCheck, ChevronRight, CircleAlert, ClipboardCheck, Clock, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ListRow } from "@/components/ui/rows";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, CountPill } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { ToolSquare } from "@/components/ui/tool-tile";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { cn, formatDuration } from "@/lib/utils";
import type { briefing } from "@/server/services/brenda";

export type Brief = Awaited<ReturnType<typeof briefing>>;
export type DayRole = "owner" | "hr" | "manager" | "employee";
/** Someone in your team (you aside), with the timer they have open, if any, for the Team view. */
export type Teammate = { id: string; name: string; state: string | null; task: string | null; todaySeconds: number };
export type TeamDay = { working: Teammate[] };

type DayProps = {
  orgSlug: string;
  role: DayRole;
  brief: Brief;
  /** The organisation's zone: times read the same on the server and in the browser, and match the rest of the page. */
  timeZone: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const timeOf = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
const dayOf = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(iso));

/**
 * The section with its title: a plain "Your day" heading, or (team leads, with `team`) underline tabs "Your day" and
 * "Team" when there is something to switch to.
 */
export function YourDaySection({ team, className, ...day }: DayProps & { team?: TeamDay | null; className?: string }) {
  const [tab, setTab] = useState<"day" | "team">("day");
  const headingId = useId();
  if (!team) {
    return (
      <section aria-labelledby={headingId} className={cn("@container min-w-0", className)}>
        <h2 id={headingId} className="type-section-title mb-3.5">Your day</h2>
        <div className="pt-1"><YourDay {...day} /></div>
      </section>
    );
  }
  const label = tab === "team" ? "Team" : "Your day";
  return (
    <section aria-labelledby={headingId} className={cn("@container min-w-0", className)}>
      <h2 id={headingId} className="sr-only">Your day</h2>
      <Tabs label="Your day and your team" value={tab} onChange={(v) => setTab(v as "day" | "team")}
        tabs={[{ label: "Your day", value: "day" }, { label: "Team", value: "team" }]} />
      <div role="tabpanel" aria-label={label} className="pt-6">
        {tab === "team" ? <YourTeam orgSlug={day.orgSlug} {...team} /> : <YourDay {...day} />}
      </div>
    </section>
  );
}

/** Stat cards in a row: two across in a narrow column, all of them once there is room. */
function StatRow({ stats }: { stats: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", stats.length >= 4 ? "@xl:grid-cols-4" : "@xl:grid-cols-3")}>
      {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
    </div>
  );
}

/** A list under a quiet label (14/20 medium, secondary) with its count; a link to the rest when there are more. */
function DayList({ title, count, children, more }: { title: string; count?: number; children: React.ReactNode; more?: { href: string; count: number } }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-1 flex items-center gap-2 px-2 text-sm font-medium tracking-normal text-secondary">{title}{count ? <CountPill count={count} /> : null}</h3>
      <ul>{children}</ul>
      {more && more.count > 0 ? <Link href={more.href} className={`${buttonVariants({ variant: "ghost", size: "xs" })} ml-1 mt-1`}>{plural(more.count, "more task")}<ChevronRight aria-hidden /></Link> : null}
    </section>
  );
}

const SHOW = 4;

/** Your day: the figures, then where you are now (your clock) and what is waiting on you. */
export function YourDay({ orgSlug, role, brief, timeZone }: DayProps) {
  const base = `/app/${orgSlug}`;
  const worker = role === "employee" || role === "manager";
  const c = brief.clock;
  const stats = worker
    ? [
      { label: "Open tasks", value: brief.openTasks },
      { label: "Due today", value: brief.dueToday.length },
      { label: "Overdue", value: brief.overdue.length },
      role === "manager" ? { label: "To check", value: brief.waitingForYourReview.length } : { label: "Reminders", value: brief.remindersToday.length },
    ]
    : [
      { label: "Due today", value: brief.dueToday.length },
      { label: "Overdue", value: brief.overdue.length },
      { label: "To check", value: brief.waitingForYourReview.length },
      { label: "Not picked up", value: brief.assignmentsNotPickedUp.length },
    ];
  const clockTitle = !c ? "Your clock" : !c.workingDay ? "Not a working day" : c.status === "in" ? "Clocked in" : c.status === "out" ? "Clocked out for today" : "Not clocked in yet";
  const lists = [
    brief.dueToday.length ? (
      <DayList key="due" title="Due today" count={brief.dueToday.length} more={{ href: `${base}/tasks`, count: brief.dueToday.length - SHOW }}>
        {brief.dueToday.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><CalendarCheck aria-hidden /></ToolSquare>} title={x.title}
            subtitle={<>{x.due ? <>Due at <time suppressHydrationWarning dateTime={x.due}>{timeOf(x.due, timeZone)}</time></> : "Due today"}{x.progress ? `, ${x.progress}% done` : ""}</>} />
        ))}
      </DayList>
    ) : null,
    brief.overdue.length ? (
      <DayList key="overdue" title="Overdue" count={brief.overdue.length} more={{ href: `${base}/tasks`, count: brief.overdue.length - SHOW }}>
        {brief.overdue.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><CircleAlert aria-hidden /></ToolSquare>} title={x.title}
            subtitle={x.due ? <>Was due <time suppressHydrationWarning dateTime={x.due}>{dayOf(x.due, timeZone)}</time></> : "Overdue"} trailing={<Badge tone="danger" dot>Overdue</Badge>} />
        ))}
      </DayList>
    ) : null,
    brief.waitingForYourReview.length ? (
      <DayList key="review" title="Waiting for your check" count={brief.waitingForYourReview.length} more={{ href: `${base}/tasks`, count: brief.waitingForYourReview.length - SHOW }}>
        {brief.waitingForYourReview.slice(0, SHOW).map((x) => (
          <ListRow key={x.taskId} href={`${base}/tasks/${x.taskId}`} leading={<ToolSquare><ClipboardCheck aria-hidden /></ToolSquare>} title={x.title} subtitle={`From ${x.from}`} trailing={<ChevronRight className="size-4" aria-hidden />} />
        ))}
      </DayList>
    ) : null,
    brief.assignmentsNotPickedUp.length ? (
      <DayList key="unpicked" title="Nobody has picked up" count={brief.assignmentsNotPickedUp.length} more={{ href: `${base}/tasks`, count: brief.assignmentsNotPickedUp.length - SHOW }}>
        {brief.assignmentsNotPickedUp.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><Users aria-hidden /></ToolSquare>} title={x.title} subtitle={`Assigned to ${x.assignee}`} trailing={<ChevronRight className="size-4" aria-hidden />} />
        ))}
      </DayList>
    ) : null,
    brief.remindersToday.length ? (
      <DayList key="reminders" title="Reminders" count={brief.remindersToday.length}>
        {brief.remindersToday.slice(0, SHOW).map((r) => (
          <ListRow key={r.id} leading={<ToolSquare><AlarmClock aria-hidden /></ToolSquare>} title={r.body} subtitle={<>At <time suppressHydrationWarning dateTime={r.at}>{timeOf(r.at, timeZone)}</time></>} />
        ))}
      </DayList>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <StatRow stats={stats} />
      <div className="grid gap-x-8 gap-y-8 @3xl:grid-cols-2">
        {/* Everyone who clocks in sees their clock here; clocking itself happens on the Clock in page, or by asking
            Brenda. The timer is My Day's own card above (the clearer of the two), so it is not repeated here. The
            organisation account does not clock in. */}
        {worker ? (
          <DayList title="Now">
            <ListRow href={`${base}/clock`} leading={<ToolSquare><Clock aria-hidden /></ToolSquare>} title={clockTitle}
              subtitle={c?.workingDay ? <>Working hours <span className="tabular-nums">{c.workStarts.slice(0, 5)}–{c.workEnds.slice(0, 5)}</span></> : "Open the Clock in page"}
              trailing={c?.status === "in" ? <Badge tone="success" dot>In</Badge> : c?.workingDay && c.status === "not_in" ? <Badge tone="warning" dot>Not in</Badge> : <ChevronRight className="size-4" aria-hidden />} />
          </DayList>
        ) : null}
        {lists}
      </div>
      {/* Staff and leads have their to-do list right below, which says when it is empty; the organisation has none. */}
      {!lists.length && !worker ? <EmptyState compact icon={BrendaGlyph} title="All clear" description="Nothing is waiting on you right now. Ask Brenda for anything you need." /> : null}
    </div>
  );
}

/**
 * Team, for team leads: who in the team is working now. (Under Brenda's panel the organisation also saw today's
 * attendance here; the Dashboard, where owners and HR land, already shows it.)
 */
export function YourTeam({ orgSlug, working }: TeamDay & { orgSlug: string }) {
  const base = `/app/${orgSlug}`;
  const running = working.filter((w) => w.state === "running");
  const paused = working.filter((w) => w.state === "paused");
  const stats = [
    { label: "Working now", value: running.length },
    { label: "Paused", value: paused.length },
    { label: "In your team", value: working.length },
  ];
  const people = [...running, ...paused];
  return (
    <div className="space-y-8">
      <StatRow stats={stats} />
      <section aria-label="Working now" className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-3 px-2">
          <h3 className="flex items-center gap-2 text-sm font-medium tracking-normal text-secondary">Working now<CountPill count={people.length} /></h3>
          <Link href={`${base}/workroom`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Open the workroom<ChevronRight aria-hidden /></Link>
        </div>
        {people.length ? (
          <ul className="grid gap-x-8 @3xl:grid-cols-2">
            {people.slice(0, 8).map((w) => (
              <ListRow key={w.id} leading={<Avatar profileId={w.id} name={w.name} size={40} />} title={w.name}
                subtitle={`${w.state === "running" ? "Working on" : "Paused on"} ${w.task ?? "a task"}`}
                trailing={<><span className="hidden tabular-nums sm:inline">{formatDuration(w.todaySeconds)}</span>{w.state === "running"
                  // Many people at once: a still orange dot each (live), the word in the quiet grey, so the list stays calm.
                  ? <Badge><StatusDot tone="live" pulse={false} size={6} />Working</Badge>
                  : <Badge tone="warning" dot>Paused</Badge>}</>} />
            ))}
          </ul>
        ) : <EmptyState compact icon={Users} title="Nobody has a timer running" description="When someone starts work on a task, they show up here." />}
      </section>
    </div>
  );
}
