import { Target } from "lucide-react";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { ToolSquare } from "@/components/ui/tool-tile";
import { ContainerScroll } from "@/components/landing/container-scroll-animation";
import { DashboardBody } from "@/components/landing/dashboard-demo";
import { AppFrame } from "@/components/landing/hero-frame";
import { SectionTitle, WRAP } from "@/components/landing/parts";

/**
 * "Everything in view", straight under the hero (owner request, 10 October 2026: "the dashboard can then come next, in
 * the section under it", with the dashboard card from the live site that straightens as you scroll). The title, then
 * the organisation dashboard in today's app frame on the scroll card, then three cards on what it covers. Server
 * rendered; only the card's tilt runs script, and only while scrolling.
 *
 * The section clips sideways: tilted back, the card's near (bottom) edge is wider than the page on a narrow laptop.
 */

const CARDS: { icon: Icon3DName; t: string; d: string }[] = [
  { icon: "eye-dashboard", t: "Workroom", d: "Who is working now, on what, for how long, and who is on a call. Status comes from the timers people start, nothing else." },
  { icon: "calendar-clock", t: "Attendance", d: "Clock-ins against your schedule, late arrivals by the minute, the month at a glance." },
  { icon: "doc-link-check", t: "The end-of-day report", d: "Brenda writes one for every lead at the end of each day: decisions waiting on them first, then what changed since yesterday. Plain counts, nobody ranked." },
];

const LABEL = "The organisation dashboard in Boredroom: who has clocked in, who is working now, hours today, tasks done and the month's attendance.";

export function DashboardSection() {
  return (
    <section id="control" aria-labelledby="control-title" className="overflow-x-clip pb-20 pt-10 sm:pb-28 sm:pt-14">
      <div className={WRAP}>
        <ContainerScroll label={LABEL}
          title={<SectionTitle id="control-title" icon={<Target aria-hidden />} title="Everything in view" sub="Who is working, on what, what is blocked and what was delivered, live for owners, HR and team leads. Staff get My Day, not the dashboard or the Workroom." />}>
          <AppFrame active="dashboard" crumb="Dashboard"><DashboardBody /></AppFrame>
        </ContainerScroll>
        <ul className="mt-6 grid gap-3 md:grid-cols-3">
          {CARDS.map((c) => {
            const Icon = LINE_ICON[c.icon];
            return (
              <li key={c.t} className="lp-reveal flex gap-4 rounded-[20px] border border-border bg-fill-0 p-5">
                <ToolSquare><Icon aria-hidden /></ToolSquare>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground">{c.t}</h3>
                  <p className="lp-text mt-1">{c.d}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
