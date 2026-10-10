"use client";

/**
 * The sample app frame for /dev/design: the v4 shell (spec §6) drawn at its real sizes, for the shell and screen
 * builders to copy. Sidebar 256px on #171717 with a hairline; nav items 32px tall, 4px apart, inset 12px, icon 18px
 * in the secondary grey, active = fill-1 + foreground; a "Pinned" section label; a tinted notice card and the workspace
 * row at the bottom. Top bar 50px, the canvas at 90% with an 8px blur and a bottom hairline, three columns: sidebar
 * toggle + breadcrumb | centred search (230px, 32px, r12, ⌘ K) | small outline buttons, icon buttons, a 32px avatar.
 * The page: 20px sides, the page header with underline tabs, stat cards, the analytics card, a section title and a table,
 * then the page's notes (PageNotes) at the bottom.
 *
 * Accent rules (6 October 2026), five touches here: the current page's nav icon, the unread count on Messages (an
 * attention pill), the bell's unread dot, the active tab's underline, and the analytics card (the chosen metric's line
 * and its orange highlight series). The page's standout action would be a sixth: here "New task" stays the white
 * primary. The sidebar's trial card (accent tint) shows only while a trial runs, so it is left out of this sample.
 * Nav icons are the animated twins where they exist (components/ui/animated-icons): hover one.
 */
import * as React from "react";
import { Bell, CalendarClock, ChevronRight, Ellipsis, Folder, Hourglass, MessageSquare, PanelLeft, Plus, Search, SquareCheckBig, TriangleAlert } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { AnimatedClock, AnimatedFileText, AnimatedListTodo, AnimatedMessageSquare, AnimatedTimer, AnimatedUsers } from "@/components/ui/animated-icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge, CountPill, Kbd } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { StatCard } from "@/components/ui/stat-card";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { FilterSelect } from "@/components/ui/filter-control";
import { DataTable } from "@/components/ui/table";
import { LiveIndicator } from "@/components/ui/status-dot";
import { AreaChart, BarChart } from "@/components/ui/charts";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Brenda", icon: BrendaGlyph, active: false },
  { label: "My Day", icon: AnimatedListTodo, active: false },
  { label: "Clock in", icon: AnimatedClock, active: false },
  { label: "Dashboard", icon: Folder, active: true },
  { label: "Tasks", icon: SquareCheckBig, active: false },
  { label: "Messages", icon: AnimatedMessageSquare, active: false, count: 3 },
  { label: "People", icon: AnimatedUsers, active: false },
  { label: "Attendance", icon: CalendarClock, active: false },
  { label: "Timesheets", icon: AnimatedTimer, active: false },
];
const PINNED = [{ label: "Website relaunch", icon: AnimatedFileText }, { label: "Q4 hiring", icon: AnimatedFileText }];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PEOPLE = [
  { id: "p1", name: "Ada Lovelace", role: "Design", status: "Working", tone: "success" as const, hours: "6h 40m", onCall: true },
  { id: "p2", name: "David Okafor", role: "Team lead", status: "In a meeting", tone: "warning" as const, hours: "5h 05m", onCall: false },
  { id: "p3", name: "Grace Hopper", role: "Engineering", status: "Away", tone: "neutral" as const, hours: "3h 12m", onCall: true },
  { id: "p4", name: "Brenda Ade", role: "Support", status: "Late", tone: "danger" as const, hours: "1h 48m", onCall: false },
];

export function SampleAppFrame() {
  const [range, setRange] = React.useState("week");
  const [tab, setTab] = React.useState("overview");
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="flex h-[880px] bg-background text-foreground">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex" aria-label="Sample sidebar">
          <div className="flex h-[50px] shrink-0 items-center justify-between pl-[18px] pr-3">
            <LogoArt height={16} />
            <IconButton aria-label="Collapse the sidebar"><PanelLeft aria-hidden /></IconButton>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pt-1" aria-label="Sample navigation">
            <ul className="space-y-1">
              {NAV.map(({ label, icon: Icon, active, count }) => (
                <li key={label}>
                  <a href="#frame" aria-current={active ? "page" : undefined} className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 [&>svg]:size-[18px] [&>svg]:shrink-0", active ? "bg-fill-1 text-foreground [&>svg]:text-accent" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>
                    <Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {count ? <CountPill count={count} tone="attention" /> : null}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mb-1 mt-4 px-1.5 text-sm font-medium text-secondary">Pinned</p>
            <ul className="space-y-1">
              {PINNED.map(({ label, icon: Icon }) => (
                <li key={label}><a href="#frame" className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground [&_svg]:size-[18px]"><Icon aria-hidden /><span className="truncate">{label}</span></a></li>
              ))}
            </ul>
          </nav>
          <div className="space-y-2 p-3">
            <button type="button" className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground transition-colors duration-75 hover:bg-fill-1">
              <Avatar profileId="sample-workspace" name="Company A" size={20} />
              <span className="min-w-0 flex-1 truncate text-left">Company A</span>
              <ChevronRight className="size-3.5 rotate-90 text-secondary" aria-hidden />
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="grid h-[50px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-[var(--header-bg)] px-3 backdrop-blur-[8px]">
            <div className="flex min-w-0 items-center gap-1">
              <IconButton aria-label="Open the sidebar" className="md:hidden"><PanelLeft aria-hidden /></IconButton>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm font-medium">
                <a href="#frame" className="truncate text-secondary hover:text-foreground">Workspace</a>
                <ChevronRight className="size-3.5 shrink-0 text-secondary" aria-hidden />
                <span aria-current="page" className="truncate text-foreground">Dashboard</span>
              </nav>
            </div>
            <button type="button" className="hidden h-8 w-[230px] items-center gap-2 rounded-xl border border-border-input bg-background px-3 text-meta font-normal text-secondary transition-colors duration-75 hover:border-border-input-hover sm:flex">
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left">Search everything…</span>
              <span className="flex gap-1" aria-hidden><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
            </button>
            <div className="flex items-center justify-end gap-1.5">
              <Button variant="secondary" size="sm" className="hidden lg:inline-flex">Feedback</Button>
              <Button variant="secondary" size="sm" className="hidden lg:inline-flex">Docs</Button>
              <IconButton aria-label="Search" className="sm:hidden"><Search aria-hidden /></IconButton>
              <IconButton aria-label="Notifications, 2 unread"><Bell aria-hidden /><span aria-hidden className="absolute right-[7px] top-[7px] size-2 rounded-full bg-accent ring-2 ring-background" /></IconButton>
              <Avatar profileId="sample-owner" name="Owner Admin" size={32} />
            </div>
          </header>

          {/* Page */}
          {/* As the app's shell does: the content, then the page's notes, pushed to the bottom when the page is short. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-12 pt-6">
            <div>
              <PageHeader title="Dashboard" description="How the team is doing this week."
                actions={<><Button variant="secondary" size="sm">Export</Button><Button size="sm"><Plus aria-hidden />New task</Button></>}
                tabs={[{ label: "Overview", value: "overview" }, { label: "Hours", value: "hours" }, { label: "Attendance", value: "attendance", count: 2 }, { label: "Blocked", value: "blocked" }]} tabValue={tab} onTabChange={setTab} />

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard label="Hours this week" value="312h 30m" hint="8% more than last week" icon={<Hourglass />} />
                <StatCard label="Working now" value="14 of 18" rows={[{ label: "Working", value: 14, tone: "success" }, { label: "Away", value: 3, tone: "neutral" }, { label: "Late", value: 1, tone: "danger" }]} />
                <StatCard label="Blocked tasks" value="3" tone="danger" action={<IconButton variant="outline" aria-label="Open blocked tasks"><TriangleAlert aria-hidden /></IconButton>} actions={<Button variant="secondary" size="xs">Review</Button>} />
              </div>

              <AnalyticsCard className="mt-3" label="This week"
                toolbar={<>
                  <FilterSelect label="Team" options={[{ value: "all", label: "All teams" }, { value: "design", label: "Design" }, { value: "eng", label: "Engineering" }]} defaultValue="all" />
                  <FilterSelect label="Range" value={range} onChange={(e) => setRange(e.target.value)} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
                </>}
                metrics={[
                  { key: "hours", label: "Hours logged", value: "312.5", content: <AreaChart title="Hours logged by day" labels={DAYS} series={[{ label: "Hours", values: [52, 61, 58, 66, 49, 14, 12] }, { label: "Last week", values: [48, 55, 60, 52, 47, 9, 4] }]} /> },
                  { key: "tasks", label: "Tasks done", value: "86", content: <BarChart title="Tasks done by day" labels={DAYS} values={[12, 18, 15, 21, 14, 3, 3]} highlight={3} /> },
                  { key: "late", label: "Late clock-ins", value: "4", content: <BarChart title="Late clock-ins by day" labels={DAYS} values={[1, 0, 2, 0, 1, 0, 0]} highlight={-1} /> },
                  { key: "focus", label: "Focus time", value: "61%", content: <AreaChart title="Focus time share" labels={DAYS} series={[{ label: "Focus", values: [58, 63, 60, 66, 59, 40, 35] }]} format={(n) => `${Math.round(n)}%`} /> },
                ]} />

              <SectionTitle className="mt-10" title="Team today" action={<Button variant="ghost" size="sm">View all</Button>} />
              <DataTable caption="Team today">
                <thead><tr><th>Name</th><th>Role</th><th>Status</th><th className="text-right">Hours</th><th>Calls</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {PEOPLE.map((p) => (
                    <tr key={p.id}>
                      <td><span className="flex items-center gap-2.5"><Avatar profileId={p.id} name={p.name} size={28} /><span className="font-medium">{p.name}</span></span></td>
                      <td className="text-secondary">{p.role}</td>
                      <td><Badge tone={p.tone} dot>{p.status}</Badge></td>
                      <td className="text-right tabular-nums">{p.hours}</td>
                      <td>{p.onCall ? <LiveIndicator>On a call</LiveIndicator> : <span className="text-xs font-medium text-subtle">Not on a call</span>}</td>
                      <td className="w-10 text-right">
                        <Menu align="end" label={`Actions for ${p.name}`} trigger={<IconButton aria-label={`Actions for ${p.name}`}><Ellipsis aria-hidden /></IconButton>}>
                          <MenuItem icon={<MessageSquare />}>Message</MenuItem>
                          <MenuItem icon={<CalendarClock />}>Their day</MenuItem>
                          <MenuSeparator />
                          <MenuItem tone="danger" icon={<TriangleAlert />}>Flag</MenuItem>
                        </Menu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            <PageNotes>
              <PageNote>Hours count clock-in to clock-out, in the organisation&rsquo;s time zone.</PageNote>
              <PageNote>Figures come from clocks, timers and tasks.</PageNote>
            </PageNotes>
          </main>
        </div>
      </div>
    </div>
  );
}
