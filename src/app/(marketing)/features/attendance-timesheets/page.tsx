import Link from "next/link";
import { AlarmClock, CalendarDays, FileSpreadsheet, Gauge, Layers, LogOut, MonitorOff, MousePointerClick } from "lucide-react";
import { CardGrid, LimitsGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { PricingSection, ProductCta, SEE_PRICING } from "@/components/marketing/product/parts";
import { AttendanceMock, DashboardPeek, HeroCluster, MyDayMock, ReportsMock, TimesheetCorrectionMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /features/attendance-timesheets (owner request, 17 October 2026: SEO analysis; Content Plan page 12). The brief's outline,
 * the month view and a timesheet with a correction waiting for approval (coded pictures), four setup steps, "what this is
 * not" as plain negatives, the attendance / time tracking / activity monitoring table, the plans and the call to action.
 *
 * Built behaviour only (checked 17 October 2026 in server/services/attendance.ts, reports.ts, sessions.ts, orgs.ts and the
 * schedule settings): the schedule (working days, start, end, a grace period of 0 to 180 minutes) is set by owners and HR
 * and is copied onto each day's record; late and left-early are counted on working days only; there is no automatic
 * clock-out, so the brief's "forgot to clock out" answer says what does happen; corrections are proposed on your own
 * tasks and decided by a team lead, never by yourself; the CSV is for owners, HR and team leads. The brief's
 * "reconciliation view" does not exist and is not claimed: the end-of-day report is where both records meet. No payroll
 * integration exists, so none is named.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the feature template
 * (spec §5.1): a split hero with the month view and the week's hours, attendance beside the dashboard, how it works as
 * cards on a tinted band, timesheets beside a correction waiting for its lead, both records as two cards, the limits and
 * the three-kinds table on a tinted band, the steps, the live plans, the call to action, the FAQ and related cards. Every
 * h2, the h3s that head content, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/features/attendance-timesheets";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "How do you track attendance for a remote team?",
    answer: "Set the working days, a clock-in time, a clock-out time and a grace period for the organisation. Each person clocks in when they start and out when they finish, in the browser or with Brenda desktop. Boredroom records a late arrival by the minute against the schedule, and leads see who is in today and every person, every day, in the month view.",
  },
  {
    question: "What is the difference between attendance tracking and time tracking?",
    answer: "Attendance tracking records when someone started and finished the working day against a schedule. Time tracking records how much time went on which task. Boredroom keeps both: attendance from clock-ins, and timesheets from the timers people start on their tasks, counting only confirmed time.",
  },
  {
    question: "Can employees correct their own timesheets?",
    answer: "They can propose a correction to time on their own tasks, with a reason. The timesheet doesn't change until a team lead approves it, nobody can approve their own records, and the approved version stays in the history.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>Clock-ins against the schedule you set, late arrivals by the minute, a month view of every person and every day, and timesheets that count only confirmed time.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={["No screen recording", "No activity tracking", "No productivity score"]}
        visual={<HeroCluster primary={<div className="lg:pb-[72px]"><AttendanceMock /></div>} secondary={<ReportsMock />}
          caption="The attendance month view: four people, twelve days in, two late arrivals and one missed day; then the week's confirmed hours by day." />}
      />

      <SplitSection id="attendance" label="Attendance" title="Attendance you can see, without watching anyone"
        sub={<p>Remote attendance tracking should answer one question: who is working today, and did they start when the team agreed? Boredroom answers it from a clock-in, not from a camera or a keyboard.</p>}
        points={[
          { title: "Clock-in, clock-out and grace periods", body: <p>Staff and team leads clock in when they start and out when they finish. A second press does nothing, so nobody is clocked in twice. If the workspace and the person allow it, Brenda desktop can clock them in when they start work on a working day, within working hours. The grace period is the number of minutes after the start time before a clock-in counts as late.</p> },
          { title: "Late arrivals, by the minute", body: <p>A clock-in after the start time plus the grace period is recorded as late, by the minute. Leaving before the scheduled end is recorded too. On a day that isn&apos;t a working day nobody is late: someone choosing to work on a weekend is not flagged.</p> },
          { title: "The month view", body: <p>Team leads see their teams, and owners and HR see everyone: a row per person, a cell per day, and totals for days present, late and missed. A missed day is a scheduled working day, up to yesterday, with no clock-in.</p> },
        ]}
        bare visual={<DashboardPeek />}
        visualCaption="The dashboard for a lead: who has clocked in and who was late today, then the month's attendance by day."
      />

      <Section id="how-it-works" label="How it works" title="How attendance tracking works" align="center" tone="tint"
        sub={<p>Owners and HR set the schedule once, and each day is measured against it.</p>}>
        <CardGrid columns={3} items={[
          { icon: <CalendarDays />, title: "Setting a schedule", body: <p>Owners and HR set the organisation&apos;s schedule in Settings: the working days, the start and end times in the organisation&apos;s time zone, and the grace period, from 0 to 180 minutes. A new schedule applies from today. Each day&apos;s record keeps the schedule it was measured against, so changing the schedule never rewrites last month.</p> },
          { icon: <AlarmClock />, title: "What counts as late", body: <p>Late means a clock-in after the start time plus the grace period, on a working day. It is a fact on the attendance page, never an automatic pay rule. The board for today shows who is in, who has not clocked in and who has already left.</p> },
          { icon: <LogOut />, title: "What happens when someone forgets to clock out", body: <p>Boredroom doesn&apos;t guess a clock-out time. The day stays open, and the month view adds that day&apos;s hours only once there is a clock-out. Timesheets never come from attendance, so a forgotten clock-out never creates hours. Clocking out also asks people to stop a running timer first, so the two records don&apos;t drift apart.</p> },
        ]} />
      </Section>

      <SplitSection id="timesheets" label="Timesheets" title="Timesheets that count confirmed time" visualSide="left"
        points={[
          { title: "What “confirmed time” means", body: <p>Time comes from the timer a person starts on a task, and it runs only when they start it. While it runs, their browser sends a heartbeat. Time the server can vouch for is confirmed. When a laptop sleeps or loses its connection, the session closes at the last heartbeat and the gap is marked uncertain: it is not counted, and not held against anyone. The person is asked what happened.</p> },
          { title: "Corrections and approvals", body: <p>If the time is wrong, the person proposes a correction on their own task: the intervals they want counted and a reason. Boredroom checks that the times don&apos;t overlap and aren&apos;t in the future. Their team lead approves or rejects it, and a rejection needs a reason. Owners and HR can see corrections, but the team lead gives the decision. A reviewer cannot approve their own records: the database refuses it.</p> },
          { title: "Why a correction counts once a lead approves it", body: <p>The timesheet doesn&apos;t change while a correction waits. Approval applies it in one step, and from then on the corrected time is confirmed. Every correction keeps its history: the approved version stays, so anyone checking later sees what changed, who decided and when.</p> },
        ]}
        visual={<TimesheetCorrectionMock />}
        visualCaption="A timesheet day with 25 uncertain minutes, not counted, and the correction waiting for the team lead."
      />

      <Section id="together" label="Both records" title="Attendance and timesheets together">
        <CardGrid columns={2} variant="cards" items={[
          { icon: <Layers />, title: "Two records, one report", body: <p>Attendance says when someone was in. Timesheets say what the time went on. They answer different questions, so Boredroom keeps them apart and puts them side by side where a lead reads them: the <Link href="/blog/end-of-day-report">end-of-day report</Link> Brenda writes for every lead lists each person&apos;s confirmed hours next to their attendance, with late arrivals and missed days.</p> },
          { icon: <FileSpreadsheet />, title: "Exporting for payroll", body: <p>Owners, HR and team leads can export timesheets as CSV for any date range: organisation, employee ID, name, local date, time zone, project, task and confirmed seconds. The rows add up to the same totals as the Timesheets page. Uncertain time, a correction still waiting and a timer still running are left out. There are no payroll integrations yet: the CSV goes into whatever you use. Want a quick total by hand? Try the <Link href="/free-tools/work-hours-calculator">work hours calculator</Link>.</p> },
        ]} />
      </Section>

      <Section id="not" label="Its limits" title="What this is not" align="center" tone="tint">
        <LimitsGrid columns={3} items={[
          { icon: <Gauge />, title: "Not a productivity score", body: <p>Attendance and confirmed hours are facts, not a judgement. Timers, heartbeats and logins are never treated as proof of work, and nobody is ranked. That is what <Link href="/solutions/monitoring-without-scores">monitoring without productivity scores</Link> means in practice.</p> },
          { icon: <MousePointerClick />, title: "Not activity inference", body: <p>Boredroom doesn&apos;t watch keyboards, mice, apps or websites to guess whether someone is working. Heartbeats show whether the browser is connected; they are not a measure of productivity.</p> },
          { icon: <MonitorOff />, title: "Not screen recording", body: <p>Boredroom does not record screens, and calls are never recorded. If you are weighing it against a time tracker with screenshots, <Link href="/compare/boredroom-vs-hubstaff">compare Boredroom and Hubstaff</Link>.</p> },
        ]} />
        {/* relative + clip: the marks' screen-reader words are absolutely placed and would otherwise widen the page while the table scrolls. */}
        <ComparisonTable className="mt-12" layout="matrix" rowHeader="Type" label="Attendance tracking, time tracking and activity monitoring compared"
          caption="Three things often sold as one"
          columns={[{ key: "records", label: "What it records" }, { key: "question", label: "The question it answers" }, { key: "boredroom", label: "In Boredroom", ours: true }]}
          rows={[
            { label: "Attendance tracking", cells: { records: "Clock-in and clock-out against a schedule", question: "Who is in, and were they on time?", boredroom: { mark: "yes" } } },
            { label: "Time tracking", cells: { records: "Time spent on each task", question: "Where did the hours go?", boredroom: { mark: "yes", text: "Yes, confirmed time only" } } },
            { label: "Activity monitoring", cells: { records: "Keyboard and mouse use, apps, websites, often screenshots", question: "How busy did someone look?", boredroom: { mark: "no" } } },
          ]}
        />
      </Section>

      <Section id="setup" label="Getting started" title="Setting it up" align="center"
        sub={<p>Four steps, and the first week tells you whether the schedule fits.</p>}>
        <StepGrid columns={4} steps={[
          { title: "Step 1: define the working day", body: <p>In Settings, choose the working days and the start and end times. They are in the organisation&apos;s time zone.</p> },
          { title: "Step 2: set the grace period", body: <p>Choose how many minutes after the start a clock-in still counts as on time, from 0 to 180. With 0, any clock-in after the start time is late.</p> },
          { title: "Step 3: invite the team with one code", body: <p>Share the workspace&apos;s join code, a link or an email invitation. People land in the right team with the right role, and clock in from their first day.</p> },
          { title: "Step 4: review the first week", body: <p>Open the month view at the end of the first week. If late arrivals cluster around one time, the schedule may be wrong rather than the people: change it, and it applies from that day without rewriting the past.</p> },
        ]} />
      </Section>

      <PricingSection link={{ href: "/pricing", label: "See every plan in full" }}
        sub={<><p>Attendance, timers, timesheets and the CSV export are on every plan, and so is Brenda, the <Link href="/features/ai-assistant">AI assistant for teams</Link> who writes each lead&apos;s report.</p><p>Prices are per workspace, not per person.</p></>} />

      <ProductCta title="Know who is in, and where the hours went"
        sub={<p>People clock in, start a timer on a task and press Done. Attendance and confirmed hours follow, with no screen recording.</p>}
        visual={<MyDayMock />} />

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/free-tools/work-hours-calculator", label: "Free work hours calculator" },
        { href: "/features/ai-assistant", label: "Brenda, the AI assistant who writes the report" },
        { href: "/compare/boredroom-vs-hubstaff", label: "Boredroom vs Hubstaff" },
        { href: "/solutions/monitoring-without-scores", label: "No productivity score" },
        { href: "/blog/end-of-day-report", label: "What an end-of-day report is" },
        { href: "/pricing", label: "See pricing" },
      ]} />
    </>
  );
}
