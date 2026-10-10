import { CircleCheck, ClipboardCheck, Hourglass, LogIn, SquareCheckBig, Timer } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { Avatar } from "@/components/ui/avatar";
import { CountPill } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { BarChart } from "@/components/ui/charts";
import { ListRow } from "@/components/ui/rows";
import { StatCard } from "@/components/ui/stat-card";
import { LiveIndicator, StatusDot } from "@/components/ui/status-dot";
import { ToolSquare } from "@/components/ui/tool-tile";
import { FAKE_BUTTON } from "@/components/landing/parts";
import { cn, formatClock } from "@/lib/utils";

/**
 * "Everything in view": the organisation dashboard as it is today (`app/app/[workspace]/dashboard/page.tsx`; owner
 * request, 10 October 2026: the page brought up to today's product). The page header (Company A, Friday 9 October, the
 * live line, "Review queue" and a white "Add people"), the underline tabs with plain counts, the four stat cards for
 * right now, the month's attendance in the analytics card (today's bar in orange) and who is working now beside what
 * was finished. Every figure is one the dashboard really shows: clocks, timers and tasks, no score and no "focus time".
 * Orange stays where the app puts it: the live line, the tab and metric underlines, today's bar, the running dots.
 *
 * `DashboardBody` is the page alone (it sits in the scroll card's `AppFrame`). A picture: the scroll card's viewport
 * describes it, and the frame around it is `inert`.
 */

const TABS: { label: string; count?: number }[] = [{ label: "Overview" }, { label: "Working now", count: 9 }, { label: "Clocked in", count: 11 }, { label: "Teams", count: 4 }];

// October 2026 up to Friday the 9th; the 3rd and 4th are a weekend. The figures agree with each other and the cards.
const DAYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const TODAY = DAYS.length - 1;
const MONTH = "October 2026";

const WORKING = [
  { id: "ada", name: "Ada Obi", task: "Homepage design", line: "Working since 09:12", seconds: 4 * 3600 + 58 * 60 + 12, running: true },
  { id: "ben", name: "Ben Adeyemi", task: "Brand deck revision 2", line: "Working since 10:05", seconds: 4 * 3600 + 5 * 60 + 40, running: true },
  { id: "chidi", name: "Chidi Nwosu", task: "Invoice page", line: "Paused, started 08:58", seconds: 3 * 3600 + 12 * 60 + 5, running: false },
];
const DONE = [
  { title: "Pricing page copy", who: "Mary Eze", at: "9 Oct 2026, 13:40" },
  { title: "Q3 invoice export", who: "David Okafor", at: "9 Oct 2026, 12:15" },
  { title: "Logo files for print", who: "Ada Obi", at: "9 Oct 2026, 11:02" },
];

/** A section title as the dashboard draws it (ui/card SectionTitle), without the heading: this is a picture. */
function Title({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <p className="type-section-title">{children}</p>
      {action ? <div className="-my-[3px] flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function DashboardBody() {
  return (
    <div className="px-4 pb-10 pt-6 sm:px-5 md:px-8 md:pt-8">
      {/* The page header (ui/card PageHeader): title, description and live line; actions on the right from sm. */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
        <div className="flex min-h-9 items-center"><p className="type-page-title">Dashboard</p></div>
        <p className="mt-1 text-sm font-normal text-secondary sm:col-span-2">Company A, Friday 9 October.</p>
        <p className="type-caption mt-1.5 inline-flex flex-wrap items-center gap-x-2 text-subtle sm:col-span-2"><LiveIndicator /><span>Last sync <span className="tabular-nums">14:10</span></span></p>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-end">
          <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), FAKE_BUTTON)}><ClipboardCheck aria-hidden />Review queue</span>
          <span className={cn(buttonVariants({ size: "sm" }), FAKE_BUTTON)}>Add people</span>
        </div>
      </div>
      {/* Whole tabs only (review fix, 10 October 2026: a phone cut "Clocked in 11" to "Clocked in 1"): Teams from sm, Clocked in from 380px. */}
      <div className="mt-5 flex gap-4 overflow-hidden shadow-[inset_0_-1px_0_var(--border)] sm:gap-6">
        {TABS.map((t, i) => (
          <span key={t.label} className={cn("relative inline-flex shrink-0 items-center gap-1.5 pb-2.5 pt-1 text-sm font-medium", i === 0 ? "text-foreground" : "text-secondary", i === 3 && "max-sm:hidden", i === 2 && "max-[379px]:hidden")}>
            {t.label}{t.count ? <CountPill count={t.count} /> : null}
            {i === 0 ? <span className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-accent" /> : null}
          </span>
        ))}
      </div>

      {/* By the frame's width, as in the app: two columns on a phone, four from 672px; the icon squares only where they fit. */}
      <div className="@container mt-8">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @max-xl:[&_.card-stat]:p-4 @max-4xl:[&_.card-stat_span.size-10]:hidden">
          <StatCard label="Clocked in" value={11} icon={<LogIn />} hint={<>of <span className="tabular-nums">12</span> people, <span className="tabular-nums text-warning">1</span> late</>} />
          <StatCard label="Working now" value={9} icon={<Timer />} hint={<><span className="tabular-nums">9</span> with a live connection</>} />
          <StatCard label="Hours today" value="52h 40m" icon={<Hourglass />} hint="Confirmed timer time" />
          <StatCard label="Done today" value={6} icon={<SquareCheckBig />} hint={<><span className="tabular-nums">14</span> open, <span className="tabular-nums text-danger">2</span> blocked</>} />
        </div>
      </div>

      <AnalyticsCard className="mt-3" label={`Attendance, ${MONTH}`} title="Attendance" description={`${MONTH}, everyone`}
        metrics={[
          { key: "hours", label: "Hours on the clock", value: "655h", content: <BarChart title={`Hours on the clock by day, ${MONTH}`} labels={DAYS} values={[97, 101, 0, 0, 98, 104, 99, 103, 53]} highlight={TODAY} format={(n) => `${Math.round(n)}h`} /> },
          { key: "present", label: "Days clocked in", value: 82, content: <BarChart title={`People clocked in by day, ${MONTH}`} labels={DAYS} values={[11, 12, 0, 0, 12, 12, 12, 12, 11]} highlight={TODAY} /> },
          { key: "late", label: "Late arrivals", value: 6, hint: "7% of days", content: <BarChart title={`Late arrivals by day, ${MONTH}`} labels={DAYS} values={[1, 0, 0, 0, 2, 1, 0, 1, 1]} highlight={TODAY} /> },
          { key: "missed", label: "Missed days", value: 2, content: <BarChart title={`Working days with no clock-in, ${MONTH}`} labels={DAYS} values={[0, 0, 0, 0, 1, 0, 1, 0, 0]} highlight={-1} /> },
        ]} />

      <div className="@container mt-10">
        <div className="grid gap-10 @4xl:grid-cols-2 @4xl:gap-6">
          <div className="min-w-0">
            <Title>Working now</Title>
            <ul className="-mx-2">
              {WORKING.map((w) => (
                <ListRow key={w.id} leading={<Avatar profileId={`landing-${w.id}`} name={w.name} size={40} />} title={w.name} subtitle={w.task}
                  meta={<><StatusDot tone={w.running ? "live" : "warning"} pulse={false} className="ml-1" /><span className="truncate">{w.line}</span></>}
                  trailing={<span className={cn("font-mono tabular-nums", w.running ? "text-foreground" : "text-secondary")}>{formatClock(w.seconds)}</span>} />
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <Title action={<span className={cn(buttonVariants({ variant: "ghost", size: "sm" }), FAKE_BUTTON)}><BrendaGlyph aria-hidden />Ask Brenda for a summary</span>}>Recently completed</Title>
            <ul className="-mx-2">
              {DONE.map((t) => (
                <li key={t.title} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3">
                  <ToolSquare><CircleCheck /></ToolSquare>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                    <p className="truncate text-meta font-normal text-secondary">{t.who}, {t.at}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
