import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BarChart, Legend } from "@/components/ui/charts";
import { ProgressBar } from "@/components/ui/progress-arc";
import { StatusDot } from "@/components/ui/status-dot";
import { FAKE_BUTTON, Pane, arrive } from "@/components/landing/parts";
import { CountUp } from "@/components/landing/arrival";
import { cn } from "@/lib/utils";

/**
 * Small product views for the feature sections, drawn with the app's v4 parts (server-rendered, no script). Each is a
 * picture of the app: role="img" with a short description, its insides hidden from assistive technology. Orange only
 * where the app puts it: the running timer and its live dot, progress, a checked box, today in a calendar or chart.
 *
 * Arrivals (owner request, 10 October 2026; arrival.tsx): these sit in a FeatureCard, which is the trigger. The month
 * view fills in day by day, and the week's bars grow while the total counts up; the server renders them finished.
 */

const fake = (variant: "primary" | "secondary") => cn(buttonVariants({ variant, size: "xs" }), FAKE_BUTTON);

/** My Day: the one card a staff member lives in. */
export function MyDayMock() {
  const rows = [
    { t: "Homepage design", m: "Fri, 2h 30m", state: "running" },
    { t: "Client kickoff notes", m: "today, 45m", state: "todo" },
    { t: "Brand deck, revision 2", m: "Thu", state: "todo" },
    { t: "Export the logo pack", m: "done 10:40", state: "done" },
  ] as const;
  return (
    <Pane className="overflow-hidden">
      <div role="img" aria-label="My Day: the Homepage design timer running at 1 hour 42 minutes of a 2 hour 30 minute estimate, three more to-dos, one done.">
        <div aria-hidden>
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 text-sm">
            <span className="font-semibold text-foreground">Your to-dos for today</span>
            <span className="truncate font-normal text-secondary">Wednesday 23 September</span>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2.5">
              <StatusDot tone="live" />
              <span className="text-sm font-medium text-secondary">Homepage design</span>
            </div>
            <p className="mt-2 font-mono text-[44px] leading-none tabular-nums text-accent-text sm:text-[52px]">1:42:07</p>
            <ProgressBar className="mt-4" value={102} max={150} label="Homepage design, time against the estimate" />
            <p className="mt-2 text-meta font-normal text-secondary">Estimate 2h 30m, 48m left</p>
            <ul className="mt-5 space-y-1">
              {rows.map((r) => (
                <li key={r.t} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", r.state === "running" && "bg-fill-1")}>
                  {r.state === "done"
                    ? <span className="grid size-4 shrink-0 place-items-center rounded bg-accent text-accent-fg"><Check className="size-3" strokeWidth={3.5} /></span>
                    : <span className="size-4 shrink-0 rounded border border-border-input-hover" />}
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", r.state === "done" ? "text-secondary line-through decoration-subtle" : "text-foreground")}>{r.t}</span>
                  <span className="shrink-0 text-meta font-normal tabular-nums text-secondary">{r.m}</span>
                  {r.state === "running" ? <span className={fake("primary")}>Done</span> : r.state === "todo" ? <span className={fake("secondary")}>Start</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Pane>
  );
}

/** Attendance for a month: a dot per person per day, today's column marked. */
export function AttendanceMock() {
  const people = ["Ada", "Ben", "Chidi", "Mary"];
  const pattern = ["g", "g", "a", "g", "g", "g", "x", "g", "g", "g", "g", "a", "g", "g"];
  const TODAY = 11; // the 12th, zero-based: "12 days in"
  const days = Array.from({ length: 14 }, (_, i) => i);
  return (
    <Pane className="p-4 sm:p-5">
      <div role="img" aria-label="Attendance for September: four people, twelve days in, two late arrivals and one missed day.">
        <div aria-hidden>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">September</span>
            <span className="truncate text-meta font-normal text-secondary">12 days in, 2 late, 1 missed</span>
          </div>
          <div className="grid grid-cols-[2.75rem_1fr] items-center gap-x-2 gap-y-2.5">
            <span />
            <div className="grid grid-cols-14 gap-1 text-center text-2xs font-medium tabular-nums">
              {days.map((d) => <span key={d} className={d === TODAY ? "text-accent-text" : "text-subtle"}>{d + 1}</span>)}
            </div>
            {people.map((p, r) => (
              <div key={p} className="contents">
                <span className="truncate text-meta font-normal text-secondary">{p}</span>
                <div className="grid grid-cols-14 gap-1">
                  {days.map((d) => {
                    const v = pattern[(d + r * 3) % pattern.length];
                    const future = d > TODAY;
                    return (
                      <span key={d} className="grid place-items-center">
                        <span className={cn("lp-item lp-pop size-2.5 rounded-full", future ? "bg-fill-150" : v === "g" ? "bg-success" : v === "a" ? "bg-warning" : "bg-grey-600")} style={arrive(0, 300 + d * 45 + r * 25)} />
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Legend className="mt-4" items={[{ label: "On time", value: "", tone: "success" }, { label: "Late", value: "", tone: "warning" }, { label: "Missed", value: "", tone: "neutral" }]} />
        </div>
      </div>
    </Pane>
  );
}

/** Reports: confirmed hours this week by day, today's bar orange, the rest grey (the app's BarChart). */
export function ReportsMock() {
  return (
    <Pane className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">Confirmed hours, this week</span>
        <CountUp className="type-metric" value={205} suffix="h" />
      </div>
      <BarChart className="lp-bars mt-3" height={150} title="Confirmed hours this week by day: Monday 38, Tuesday 44, Wednesday 41, Thursday 47, Friday 35 so far."
        labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} values={[38, 44, 41, 47, 35, 0, 0]} highlight={4} format={(n) => `${n}h`} />
    </Pane>
  );
}
