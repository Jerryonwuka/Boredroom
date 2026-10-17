import Link from "next/link";
import { CalendarCheck, Camera, ChartColumn, Clock, Download, Scale, Sparkles, Timer, Receipt, UsersRound } from "lucide-react";
import { PullQuote } from "@/components/marketing/blocks";
import { CardGrid } from "@/components/marketing/card-grid";
import { ContrastLists } from "@/components/marketing/contrast-lists";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { VersusLockup } from "@/components/marketing/versus-lockup";
import { EndOfDayReportMock, TimesheetCorrectionMock } from "@/components/marketing/visuals";
import { BoredroomViews } from "@/components/marketing/compare/boredroom-views";
import { AS_OF, SOURCES, type SourceKey } from "@/components/marketing/compare/data";
import { AtAGlance, LinkLine, SourcesSection, SubHead, TextStack } from "@/components/marketing/compare/parts";
import { comparisonArticle } from "@/components/marketing/compare/schema";
import { CostTable, HeadToHeadTable } from "@/components/marketing/compare/tables";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";

/**
 * /compare/boredroom-vs-hubstaff (Content Plan page 8; owner request, 17 October 2026: SEO analysis). The buyer uses or
 * is weighing Hubstaff for timesheets and wonders whether screenshots have to come with them. Hubstaff's facts are from
 * its pricing page and help centre, read on AS_OF (compare/data.ts). The brief's "What teams report about each" became
 * "What each one tells a lead": we quote no reviews or customer stories (build spec D18), only Hubstaff's own guidance.
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): the head-to-head template (pages-design
 * spec §5.4), with this page's own sections: screenshots and activity levels beside the timesheet that asks about a gap
 * instead, and time tracking vs outcome reporting beside the end-of-day report. Every word, link, heading and fact of
 * the first build is kept.
 */
const PATH = "/compare/boredroom-vs-hubstaff";
export const metadata = pageMetadata(PATH);

const CITED: SourceKey[] = ["hubstaffPricing", "hubstaffActivity", "hubstaffTracking", "hubstaffScreenshots", "hubstaffBlur", "boredroomPricing"];

const FAQ = [
  {
    question: "Does Boredroom track time like Hubstaff?",
    answer: "In part. Both count time from a timer the person starts and stops, and both produce timesheets. Boredroom adds clock-ins against a schedule and lateness by the minute, and a correction counts only once a lead approves it. It does not measure keyboard and mouse activity, track apps or websites, or take screenshots, and it has no invoicing, payroll or mobile apps.",
  },
  {
    question: "Does Boredroom take screenshots?",
    answer: "No. Boredroom never takes screenshots and never records screens or calls. A person's screen is seen only when they share it on a call, or when they ask Brenda for Mac to look at it, and she keeps nothing.",
  },
  {
    question: "Can I use Boredroom and Hubstaff together?",
    answer: "You can, but they do not connect: Boredroom has no integrations yet, so people would start two timers. A team that needs Hubstaff for client billing or payroll could keep it for that and use Boredroom for the team itself: attendance, tasks, messages, calls and Brenda. If you only use Hubstaff for timesheets, Boredroom covers them on its own.",
  },
  {
    question: "Does Hubstaff record keystrokes?",
    answer: "No. Hubstaff's help centre says it does not store individual keystrokes. It records only whether there was keyboard or mouse input in each second, to calculate activity levels.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH} layout="center" jsonLd={[comparisonArticle(PATH, CITED, ["hubstaff", "boredroom"])]}
        actions={<PrimaryCta secondary={{ href: "/pricing", label: "Boredroom pricing" }} />}
        footer={<VersusLockup them="Hubstaff" asOf={AS_OF} />} />

      <AtAGlance tool="hubstaff" />

      <Section id="short-version" label="Overview" title="The short version" align="center"
        sub={<p>Hubstaff is a time tracker: people start a timer, Hubstaff records the time and, while it runs, activity levels and screenshots. Boredroom is remote team management software with a personal AI assistant named Brenda for every team member. Both give you timesheets. Only one of them takes pictures of people&apos;s screens to prove the hours. This page compares them on the nine questions of our <Link href="/compare/employee-monitoring-software">employee monitoring software comparison</Link>, using Hubstaff&apos;s own pricing and help pages as of {formatDate(AS_OF)}.</p>}>
        <CardGrid columns={3} items={[
          { icon: <Receipt />, title: "Who Hubstaff is for", body: <p>Teams that bill clients by the hour or pay people by the hour, and need proof of the hours: timesheets, screenshots, activity levels, project budgets, invoices and payroll in one tool. It has desktop, web and mobile apps, and plans from $4.99 a seat a month on annual billing.</p> },
          { icon: <UsersRound />, title: "Who Boredroom is for", body: <p>Remote teams that need attendance and timesheets that add up, and want to know what was delivered rather than how busy a mouse was. Each person gets Brenda, who answers follow-ups from their work and writes each lead&apos;s end-of-day report.</p> },
          { icon: <Scale />, title: "The one-line difference", body: <p>Hubstaff proves the hours were worked. Boredroom tells a lead what the hours produced.</p> },
        ]} />
      </Section>

      <Section id="features" label="Side by side" title="Feature-by-feature comparison" align="center">
        <HeadToHeadTable tool="hubstaff" />
        <CardGrid variant="cards" columns={2} className="mt-12" items={[
          { icon: <Timer />, title: "Time tracking and timesheets", body: <p>Both tools count time from a timer the person controls. Hubstaff&apos;s help centre says it <a href={SOURCES.hubstaffTracking.url}>records activity only between Start and Stop</a> in its app, and timesheets are on every plan; Grow adds idle timeout and work breaks, Team adds automatic discarding of idle time. Boredroom&apos;s timer runs on the task the person started and pauses when they do, and its timesheets count only confirmed time. A correction is a request: it counts once a lead approves it, a reviewer cannot approve their own, the approved version stays in the history, and the CSV export adds up to the same totals. For the detail, see <Link href="/features/attendance-timesheets">remote team attendance and timesheets</Link>.</p> },
          { icon: <Camera />, title: "Screenshots and activity levels", body: <p>Hubstaff takes 1, 2 or 3 screenshots in every 10 minutes of tracked time, at random moments, with up to 10 on an add-on that also captures every monitor. It calculates an activity level for each 10 minutes from the seconds with keyboard or mouse input. Boredroom does neither. The next section is about why.</p> },
          { icon: <CalendarCheck />, title: "Attendance and scheduling", body: <p>Hubstaff&apos;s Team plan adds scheduling, alongside payments and payroll. Boredroom has attendance on every plan: the workspace sets a clock-in time, a clock-out time and a grace period, a late arrival is recorded by the minute, and the month view shows every person on every day. Brenda desktop can clock people in when they start work, if the workspace and the person both allow it.</p> },
          { icon: <Sparkles />, title: "AI assistant", body: <p>Hubstaff&apos;s pricing page lists no assistant for each person; its Insights add-on uses your data to flag unusual activity and unproductive apps. Boredroom gives every member of the team Brenda. She plans their day, sets reminders, starts their timer, drafts with them, and answers other people&apos;s follow-ups from their work, so a lead asks the assistant rather than chasing the person.</p> },
          { icon: <ChartColumn />, title: "Reporting", body: <p>Hubstaff reports on time, activity, projects, budgets and payments, with more through Insights: focus and meeting time, unproductive apps and URLs, and a team leaderboard. Boredroom reports in plain counts with nobody ranked: the organisation dashboard (who has clocked in, who is working now, hours today, tasks done), the standup rollup, and an <Link href="/blog/end-of-day-report">end-of-day report</Link> for every lead, written by Brenda.</p> },
        ]} />
      </Section>

      <SplitSection id="screenshots" label="Proof of work" title="Screenshots and activity levels" tone="tint"
        points={[
          { title: "How Hubstaff captures screenshots", body: <p>While the timer runs, the Hubstaff app takes screenshots at random times within each 10-minute block, at the frequency an owner or manager sets for the organisation or for each member. Screenshots are not taken during idle time. On paid plans, owners can <a href={SOURCES.hubstaffBlur.url}>blur screenshots</a> on the device before they are uploaded, for everyone or for one person, and owners and managers can turn screenshots off entirely. These are sensible controls, and worth knowing about if you choose Hubstaff.</p> },
          { title: "How Boredroom handles the same problem", body: <p>The problem screenshots solve is trust: was the time real? Boredroom answers it differently. The timer runs on a named task the person started. Done hands the work over for a check, and approval is a separate step by someone else. A session that loses its connection closes at the last heartbeat, the gap is marked uncertain, and the person is asked what happened rather than penalised. What a lead sees is the work and its status, not a picture of a screen.</p> },
          { title: "What each one tells a lead", body: <p>An activity level tells a lead how much input a computer received; a screenshot tells them what was on the screen at one moment. Neither says whether the work is right or finished. Hubstaff is open about the limits: its own help centre says it <a href={SOURCES.hubstaffActivity.url}>discourages quotas or scoring based on activity rates</a> and suggests reading them as trends. Boredroom leaves activity out altogether and gives the lead the status of the work, what is blocked, and what is waiting on them.</p> },
        ]}
        visual={<TimesheetCorrectionMock />}
        visualCaption="No screenshot to prove the time: uncertain minutes are not counted, and a correction waits for the lead to approve it.">
        <PullQuote>No productivity score, no screen recording, no call recording.</PullQuote>
      </SplitSection>

      <SplitSection id="outcomes" label="Hours and outcomes" title="Time tracking vs outcome reporting" visualSide="left"
        points={[
          { title: "What a timesheet tells you", body: <p>How long, on what, and whether it was approved. That is essential for billing, payroll and capacity, and both tools do it.</p> },
          { title: "What an end-of-day report tells you", body: <p>What was done, what is blocked, what changed since yesterday, and what needs a decision. In Boredroom nobody writes it: Brenda drafts it from the day&apos;s tasks, approvals, attendance and hours, and each lead gets theirs with the decisions waiting on them at the top.</p> },
          { title: "Why Boredroom does both", body: <p>Because a lead needs both answers and neither is enough on its own. Hours without outcomes invite micromanagement; outcomes without hours leave payroll guessing. Boredroom keeps the hours honest with confirmed time and approved corrections, and puts the outcomes in front of the lead every evening.</p> },
        ]}
        visual={<EndOfDayReportMock />}
        visualCaption="The outcomes, every evening: a lead's end-of-day report, written by Brenda." />

      <BoredroomViews intro="Coded views of the product. Hubstaff's interface is on its own site; we don't reproduce other companies' screenshots." />

      <Section id="pricing" label="Pricing" title="Pricing">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <TextStack items={[
            { title: "Per-seat vs per-workspace", body: <p>Hubstaff charges per seat with a 2-seat minimum: Starter $7, Grow $9 and Team $12 a month billed monthly, or $4.99, $7.50 and $10 billed annually; Enterprise is $25 a seat, billed annually. Add-ons such as Insights, more screenshots and the Silent app start at $2.50 a seat on annual billing. Boredroom charges per workspace: Pro is $15 a month or $150 a year for up to 50 people, Enterprise $50 a month or $500 a year. <Link href="/pricing">Boredroom pricing</Link> has the details.</p> },
            { title: "What the free tiers include", body: <p>Hubstaff has a 14-day trial with no card and a 30-day money-back guarantee, but no free plan; people who only view reports can have its free Project Viewer role. Boredroom has a free plan for 1 workspace and up to 5 people, with Brenda, attendance and timesheets, and no card.</p> },
          ]} />
          <div className="min-w-0">
            <SubHead title="Cost at 10, 50 and 200 people" className="mb-5" />
            <CostTable plans={["boredroomMonthly", "boredroomAnnual", "hubstaffStarterMonthly", "hubstaffStarterAnnual", "hubstaffTeamMonthly", "hubstaffTeamAnnual"]} label="Boredroom vs Hubstaff cost at 10, 50 and 200 people"
              footnote={<p>Hubstaff also lists VIP support that is applied automatically to larger monthly subscriptions, at $29 a month per organisation between $275 and $400 a month and $59 above $400. It is not included above.</p>} />
          </div>
        </div>
      </Section>

      <Section id="setup" label="Setup" title="Setup and onboarding" align="center">
        <CardGrid columns={2} items={[
          { icon: <Download />, title: "What employees install", body: <p>Hubstaff has desktop apps for Windows, macOS and Linux, mobile apps and a web timer. Activity levels and screenshots need the desktop app: its help centre says the mobile apps and web timer cannot record keyboard or mouse activity. Boredroom runs in the browser, so there is nothing to install. Brenda desktop, for Mac and Windows, is optional.</p> },
          { icon: <Clock />, title: "Time to first value", body: <p>Both are quick. Hubstaff gives you timesheets as soon as people start tracking. In Boredroom you create the organisation, make teams, put a lead on each and share one code, a link or an email invitation; people land in the right team and meet their own Brenda the first time they come in, and leads get Brenda&apos;s end-of-day report at the end of each day.</p> },
        ]} />
      </Section>

      <Section id="choose" label="Both sides" title="Which should you choose?" align="center" tone="tint">
        <ContrastLists lists={[
          { title: "Choose Hubstaff if…", items: [
            "You bill clients by the hour and they expect screenshots or activity as proof.",
            "You want invoices, project budgets, expenses and payroll in the same tool as the timer.",
            "Your team works in the field and needs mobile apps, GPS or geofenced job sites.",
          ] },
          { title: "Choose Boredroom if…", items: [
            "You need timesheets and attendance, but not screenshots or activity levels.",
            "You want each lead to get an end-of-day report of what was delivered, written for them.",
            "You want every person to have an AI assistant that answers follow-ups from their work.",
            "Your team runs on messages, docs and calls, and you want them in the same place as the work.",
            "You would rather pay per workspace than per seat as the team grows.",
          ] },
        ]} />
        <LinkLine>Comparing more than one tool? Read <Link href="/compare/boredroom-vs-activtrak">how Boredroom compares to ActivTrak</Link> and <Link href="/compare/boredroom-vs-time-doctor">to Time Doctor</Link>.</LinkLine>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <SourcesSection keys={CITED}
        intro={<p>Hubstaff&apos;s facts come from its own pricing page and help centre, read on {formatDate(AS_OF)}; prices are the US dollar list prices shown that day. Boredroom&apos;s come from the product. Tell us if anything here is out of date.</p>} />

      <RelatedLinks
        title="Keep comparing"
        label="Keep exploring"
        links={[
          { href: "/compare/employee-monitoring-software", label: "Employee monitoring software comparison" },
          { href: "/features/attendance-timesheets", label: "Remote team attendance and timesheets" },
          { href: "/blog/end-of-day-report", label: "What goes in an end-of-day report" },
          { href: "/compare/boredroom-vs-activtrak", label: "Boredroom vs ActivTrak" },
          { href: "/compare/boredroom-vs-time-doctor", label: "Boredroom vs Time Doctor" },
          { href: "/pricing", label: "Boredroom pricing, per workspace" },
        ]}
      />
    </>
  );
}
