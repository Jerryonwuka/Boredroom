import { Hourglass } from "lucide-react";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AreaChart, BarChart } from "@/components/ui/charts";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { FAKE_BUTTON, Stage } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TEAM = [
  { name: "Ada Obi", team: "Design", status: "Working", tone: "success" as const, hours: "6h 40m" },
  { name: "David Okafor", team: "Design", status: "Reviewing", tone: "neutral" as const, hours: "5h 05m" },
  { name: "Chidi Nwosu", team: "Tech", status: "Blocked", tone: "danger" as const, hours: "3h 12m" },
  { name: "Mary Eze", team: "Marketing", status: "Late", tone: "warning" as const, hours: "1h 48m" },
];

/**
 * "Everything in view": the organisation dashboard built from the app's own parts. The page header (the title, an
 * outline and a white primary, underline tabs with the orange underline) is a picture; under it three StatCards, the
 * AnalyticsCard (its metric strip works: choose a metric and the chart changes, the chosen one's line and highlight
 * series in orange, the rest grey) and the "Team today" table with status badges. Server-rendered; only the metric
 * strip runs script.
 */
export function DashboardDemo() {
  return (
    <Stage>
      <div className="p-4 sm:p-6">
        <div aria-hidden>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="type-page-title">Dashboard</p>
            <div className="flex gap-2">
              <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), FAKE_BUTTON, "pointer-coarse:h-8")}>Export</span>
              <span className={cn(buttonVariants({ variant: "primary", size: "sm" }), FAKE_BUTTON, "pointer-coarse:h-8")}>New task</span>
            </div>
          </div>
          <div className="mt-4 flex gap-6 overflow-hidden shadow-[inset_0_-1px_0_var(--border)]">
            <span className="relative shrink-0 pb-2.5 pt-1 text-sm font-medium text-foreground">Overview<span className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-accent" /></span>
            {["Hours", "Attendance", "Blocked"].map((t) => <span key={t} className="shrink-0 pb-2.5 pt-1 text-sm font-medium text-secondary">{t}</span>)}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Working now" value="9 of 12" rows={[{ label: "Working", value: 9, tone: "success" }, { label: "Paused", value: 2, tone: "neutral" }, { label: "Late", value: 1, tone: "warning" }]} />
          <StatCard label="Confirmed hours" value="41h 20m" hint="8% more than last week" icon={<Hourglass />} />
          <StatCard label="Delivery" value="Needs a look" rows={[{ label: "Sent for check", value: 4, tone: "neutral" }, { label: "Blocked", value: 2, tone: "danger" }]} />
        </div>

        <AnalyticsCard className="mt-3" label="This week"
          metrics={[
            { key: "hours", label: "Hours logged", value: "312.5", content: <AreaChart title="Hours logged by day, this week against last week" labels={DAYS} series={[{ label: "This week", values: [52, 61, 58, 66, 49, 14, 12] }, { label: "Last week", values: [48, 55, 60, 52, 47, 9, 4] }]} /> },
            { key: "tasks", label: "Tasks done", value: "86", content: <BarChart title="Tasks done by day, Thursday highlighted" labels={DAYS} values={[12, 18, 15, 21, 14, 3, 3]} highlight={3} /> },
            { key: "late", label: "Late clock-ins", value: "4", content: <BarChart title="Late clock-ins by day" labels={DAYS} values={[1, 0, 2, 0, 1, 0, 0]} highlight={-1} /> },
            { key: "focus", label: "Focus time", value: "61%", content: <AreaChart title="Share of the day on a running timer" labels={DAYS} series={[{ label: "Focus", values: [58, 63, 60, 66, 59, 40, 35] }]} format={(n) => `${Math.round(n)}%`} /> },
          ]} />

        <p className="type-section-title mb-2 mt-8">Team today</p>
        <DataTable caption="Team today">
          <thead><tr><th>Name</th><th className="max-sm:hidden">Team</th><th>Status</th><th className="text-right">Hours</th></tr></thead>
          <tbody>
            {TEAM.map((p) => (
              <tr key={p.name}>
                <td><span className="flex items-center gap-2.5"><Avatar profileId={`landing-${p.name}`} name={p.name} size={28} /><span className="font-medium">{p.name}</span></span></td>
                <td className="text-secondary max-sm:hidden">{p.team}</td>
                <td><Badge tone={p.tone} dot>{p.status}</Badge></td>
                <td className="text-right tabular-nums">{p.hours}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </Stage>
  );
}
