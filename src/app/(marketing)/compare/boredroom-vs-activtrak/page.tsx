import Link from "next/link";
import { CalendarCheck, Camera, ChartColumn, Download, Eye, Gauge, Laptop, Scale, ShieldCheck, Sparkles, Timer, UsersRound } from "lucide-react";
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
import { EndOfDayReportMock } from "@/components/marketing/visuals";
import { BoredroomViews } from "@/components/marketing/compare/boredroom-views";
import { AS_OF, SOURCES, type SourceKey } from "@/components/marketing/compare/data";
import { AtAGlance, LinkLine, SourcesSection, SubHead, TextStack } from "@/components/marketing/compare/parts";
import { comparisonArticle } from "@/components/marketing/compare/schema";
import { CostTable, HeadToHeadTable } from "@/components/marketing/compare/tables";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";

/**
 * /compare/boredroom-vs-activtrak (Content Plan page 7; owner request, 17 October 2026: SEO analysis). The buyer here is
 * looking for a way out of productivity scoring. ActivTrak's facts are from its pricing page and help centre, read on
 * AS_OF (compare/data.ts); the table uses the hub's nine questions so the two pages agree. Where ActivTrak is better
 * (analytics at scale, technology and AI use, its refusal to log keystrokes), the page says so.
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): the head-to-head template (pages-design
 * spec §5.4): a centred hero with "Boredroom vs ActivTrak" as a lockup (names only), at a glance, the short version as
 * cards, the nine-question table as the centrepiece with the topics as cards under it, the score question beside the
 * report a lead reads instead, privacy as cards, the product, pricing beside the cost table, setup, both sides in
 * balance, the questions, the sources. Every word, link, heading and fact of the first build is kept.
 */
const PATH = "/compare/boredroom-vs-activtrak";
export const metadata = pageMetadata(PATH);

const CITED: SourceKey[] = ["activtrakPricing", "activtrakData", "activtrakGlossary", "boredroomPricing"];

const FAQ = [
  {
    question: "Is Boredroom a replacement for ActivTrak?",
    answer: "For some teams. If you use ActivTrak to know who is working, on what, and whether the hours add up, Boredroom does that without classing apps or scoring people, and adds an AI assistant for every person. If you use ActivTrak for technology usage, compliance alarms, utilisation analytics or measuring AI tool adoption, Boredroom does none of that, and it is not a replacement.",
  },
  {
    question: "Does Boredroom record screens like ActivTrak?",
    answer: "No. Boredroom never records screens or calls and takes no screenshots. ActivTrak, for comparison, offers screenshots and live screen view only through its Screen Details add-on, off by default. Brenda for Mac can look at a screen only when its owner asks her to, and nothing is kept.",
  },
  {
    question: "Can I migrate from ActivTrak to Boredroom?",
    answer: "There is no importer. Export the ActivTrak reports you want to keep first, then create a Boredroom workspace, make your teams and invite people with a code, a link or an email. Boredroom starts its own record from the first clock-in and timer. It does not take app or website history, because it does not keep any.",
  },
  {
    question: "Does ActivTrak log keystrokes?",
    answer: "No. ActivTrak's help centre lists keystroke logging and video camera monitoring as data it never collects. Neither does Boredroom.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH} layout="center" jsonLd={[comparisonArticle(PATH, CITED, ["activtrak", "boredroom"])]}
        actions={<PrimaryCta secondary={{ href: "/pricing", label: "Boredroom pricing" }} />}
        footer={<VersusLockup them="ActivTrak" asOf={AS_OF} />} />

      <AtAGlance tool="activtrak" />

      <Section id="short-version" label="Overview" title="The short version" align="center"
        sub={<p>ActivTrak and Boredroom both tell a manager what their team is doing. They get there in opposite ways. ActivTrak measures activity on each computer and turns it into productivity analytics. Boredroom is remote team management software with a personal AI assistant named Brenda for every team member, and it gives no productivity score at all. This page sets them side by side on the same nine questions as our <Link href="/compare/employee-monitoring-software">employee monitoring software comparison</Link>, using ActivTrak&apos;s own pricing and help pages as of {formatDate(AS_OF)}.</p>}>
        <CardGrid columns={3} items={[
          { icon: <ChartColumn />, title: "Who ActivTrak is for", body: <p>Organisations that want analytics on how work happens across many computers: utilisation, schedule adherence, focus and collaboration time, workload and burnout signals, technology use and, with an add-on, AI adoption. It is strongest at scale, where a pattern across 500 people says something no single manager could see.</p> },
          { icon: <UsersRound />, title: "Who Boredroom is for", body: <p>Remote teams that want to know who is working, on what, what is blocked and what got done, without screenshots, app tracking or a score. Each person gets Brenda, who answers follow-ups from their work and writes each lead&apos;s end-of-day report.</p> },
          { icon: <Scale />, title: "The one-line difference", body: <p>ActivTrak measures how people use their computers. Boredroom asks about the work and lets each person&apos;s assistant answer.</p> },
        ]} />
      </Section>

      <Section id="features" label="Side by side" title="Feature-by-feature comparison" align="center">
        <HeadToHeadTable tool="activtrak" />
        <CardGrid variant="cards" columns={2} className="mt-12" items={[
          { icon: <Gauge />, title: "Productivity scoring", body: <p>ActivTrak classes each app and website as productive, unproductive or undefined. Its <a href={SOURCES.activtrakGlossary.url}>Insights glossary</a> then reports productive hours a day for each person against a goal (7 hours by default for new accounts), a Productivity Efficiency percentage, a team&apos;s top-quartile average, and coaching lists of people with low efficiency. Boredroom has no equivalent and never will: there is no classification of apps, no goal of productive hours and no ranking. Reports give plain counts.</p> },
          { icon: <Camera />, title: "Screen recording and screenshots", body: <p>ActivTrak does not list video recording. Screenshots and live screen view come with its Screen Details add-on, and its help centre says <a href={SOURCES.activtrakData.url}>screenshots are taken when an alarm triggers</a> and are off by default. Boredroom has no screenshots and no screen recording. Screens are shared only on a call, by the person sharing.</p> },
          { icon: <CalendarCheck />, title: "Attendance and timesheets", body: <p>ActivTrak counts time automatically from computer activity and offers attendance and schedule adherence from its $10 plan, with timesheet reconciliation through its ActivConnect add-on. Boredroom counts the time people record themselves: clock-ins against a schedule with a grace period, late arrivals by the minute, and timesheets of confirmed time from the timers people start. A correction counts once a lead approves it, the approved version stays, and the CSV export adds up to the same totals. When a laptop sleeps, the gap is marked uncertain and the person is asked about it; it is not counted and not held against them.</p> },
          { icon: <Sparkles />, title: "AI assistant", body: <p>ActivTrak&apos;s AI points at the data: Work Advisor answers a manager&apos;s questions about it, coaching suggestions are AI-powered, and the AI Insights add-on measures how staff use AI tools. Boredroom&apos;s points at the person. Every member of the team gets Brenda, an <Link href="/features/ai-assistant">AI assistant for teams</Link> who plans their day, sets reminders, starts their timer and drafts with them. Ask yours where Ben&apos;s deck is and Ben&apos;s Brenda answers from his work, sharing only what you could already see.</p> },
          { icon: <ChartColumn />, title: "Reporting", body: <p>ActivTrak has a deep reporting layer: dashboards for utilisation, productivity and technology, report exports, email subscriptions, alarms, and BI templates through ActivConnect. Employees can have a personal insights dashboard. Boredroom&apos;s reporting is narrower and written in sentences: the organisation dashboard (who has clocked in, who is working now, hours today, tasks done, the month&apos;s attendance), the standup rollup, and Brenda&apos;s end-of-day report for each lead, decisions waiting on them first, then what changed since yesterday.</p> },
        ]} />
      </Section>

      <SplitSection id="productivity-score" label="Scores" title="The productivity score question"
        points={[
          { title: "How ActivTrak scores people", body: <p>To be precise about it: ActivTrak does not call its figure a score. It calls it productive hours a day, compared with a goal, and Productivity Efficiency, the share of total time spent in productive apps and sites. The effect is the same as a score. A rule decides what counts as work, software measures time against that rule, and each person gets a number a manager can compare. It is configurable and it is clearly explained in ActivTrak&apos;s documentation, which is to its credit.</p> },
          { title: "Why Boredroom doesn't", body: <p>Because the number measures the wrong thing. Time in a productive-classed window is not output, and time away from the screen is not idleness. Timers, heartbeats and logins are never treated as proof of work in Boredroom. More practically, people work to the meter once they know about it, and they should know about it. We wrote the rule into the product rather than the marketing: no score, and nobody ranked. There is more on the reasoning in <Link href="/solutions/monitoring-without-scores">monitoring without productivity scores</Link>.</p> },
          { title: "What teams use instead", body: <p>Plain answers to plain questions. Who is working now, on what, for how long: from the timers people start. What was delivered and what is blocked: from the tasks. What the lead needs to decide: from Brenda&apos;s end-of-day report. And the follow-ups that used to be a message chasing someone go to that person&apos;s assistant, which answers from their work and asks them once if it can&apos;t.</p> },
        ]}
        visual={<EndOfDayReportMock />}
        visualCaption="What a lead reads instead of a score: Brenda's end-of-day report, decisions waiting on them first.">
        <PullQuote>No productivity score, no screen recording, no call recording.</PullQuote>
      </SplitSection>

      <Section id="privacy" label="Privacy" title="Privacy and consent" align="center" tone="tint">
        <CardGrid columns={3} items={[
          { icon: <Eye />, title: "What ActivTrak records", body: <p>According to its help centre, the ActivTrak agent records the computer and user name, IP addresses, and for each activity the time, duration, application and a description; window titles and full URLs on higher plans or with an add-on; and screenshots with the Screen Details add-on. It lists keystroke logging and webcam monitoring as data it never collects, and ships controls to hide titles, URLs and screenshots by default. That is a careful default.</p> },
          { icon: <ShieldCheck />, title: "What Boredroom records", body: <p>The tasks people plan, the work sessions they start and stop, the progress notes and evidence they submit, and clock-ins. Heartbeats show whether a browser is connected; they are not a measure of productivity. Boredroom does not record screens, apps, websites or keystrokes, and calls are never recorded. Call notes are taken only for people who choose Include me, on their own device, and the transcript is deleted 7 days after the recap.</p> },
          { icon: <Laptop />, title: "What each requires from employees", body: <p>ActivTrak runs as an agent installed on each work computer, and its pricing page lists remote agent installation and silent deployment. Employees need do nothing, which is the point and, for some teams, the problem. Boredroom asks more of people and tells them more: they start their own timers, and everyone can read the monitoring notice in their profile and is told when it changes.</p> },
        ]} />
      </Section>

      <BoredroomViews intro="Coded views of the product. ActivTrak's interface is on its own site; we don't reproduce other companies' screenshots." />

      <Section id="pricing" label="Pricing" title="Pricing">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <TextStack items={[
            { title: "Per-seat vs per-workspace", body: <p>ActivTrak charges per worker per month and sells annual plans only: $10 for Work Activity Tracking, $15 for Workforce Management, $17 for Productivity Optimization and $21 for Workflow, with AI Insights at $4 more per worker. Boredroom charges per workspace: Pro is $15 a month or $150 a year for up to 50 people, Enterprise $50 a month or $500 a year with no limit. See <Link href="/pricing">Boredroom pricing</Link> for what each plan includes.</p> },
            { title: "What the free tiers include", body: <p>ActivTrak&apos;s free plan covers up to 3 people with 30 days of data history, and its 14-day trial gives the full Workforce Management and Productivity Optimization bundle before dropping to the free plan. Boredroom&apos;s free plan covers 1 workspace and up to 5 people with no card, and includes Brenda; Pro has a 3-day trial and Enterprise a 7-day trial.</p> },
          ]} />
          <div className="min-w-0">
            <SubHead title="Cost at 10, 50 and 200 people" className="mb-5" />
            <CostTable plans={["boredroomMonthly", "boredroomAnnual", "activtrakTracking", "activtrakWorkforce", "activtrakOptimisation"]} label="Boredroom vs ActivTrak cost at 10, 50 and 200 people" />
          </div>
        </div>
      </Section>

      <Section id="setup" label="Setup" title="Setup and onboarding" align="center">
        <CardGrid columns={2} items={[
          { icon: <Timer />, title: "Time to first value", body: <p>ActivTrak&apos;s value builds as data accumulates: its agent starts recording as soon as it is installed, and its trends, goals and benchmarks are built from the history it collects. Boredroom&apos;s starts on day one. Create the organisation, make your teams and put a lead on each, then share one code, a link or an email invitation; people land in the right team with the right role and meet their own Brenda the first time they come in. Leads get Brenda&apos;s end-of-day report at the end of each day.</p> },
          { icon: <Download />, title: "What employees have to install", body: <p>For ActivTrak, the agent on each computer (Windows, macOS or ChromeOS). For Boredroom, nothing: it runs in the browser. Brenda desktop, for Mac and Windows, is optional and adds the timer, the morning briefing and notifications at the top of the screen.</p> },
        ]} />
      </Section>

      <Section id="choose" label="Both sides" title="Which should you choose?" align="center" tone="tint">
        <ContrastLists lists={[
          { title: "Choose ActivTrak if…", items: [
            "You want productivity, utilisation and capacity analytics across a large organisation.",
            "You need to know which software is used, by whom, and whether licences are worth it.",
            "You want to measure how staff adopt AI tools.",
            "You need compliance alarms, website blocking or USB and file-transfer detection.",
            "You want monitoring that never logs keystrokes, with screenshots off unless you add them.",
          ] },
          { title: "Choose Boredroom if…", items: [
            "You want to know what your team is doing without classing their apps or scoring them.",
            "You want every person to have an assistant that answers follow-ups from their work.",
            "You want an end-of-day report for each lead that nobody has to write.",
            "You want attendance and timesheets that people record themselves and can correct with approval.",
            "You would rather pay per workspace than per worker.",
          ] },
        ]} />
        <LinkLine>Still weighing it up? See how the other two compare: <Link href="/compare/boredroom-vs-hubstaff">Boredroom vs Hubstaff</Link> and <Link href="/compare/boredroom-vs-time-doctor">Boredroom vs Time Doctor</Link>.</LinkLine>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <SourcesSection keys={CITED}
        intro={<p>ActivTrak&apos;s facts come from its own pricing page and help centre, read on {formatDate(AS_OF)}; prices are the US dollar list prices shown that day. Boredroom&apos;s come from the product. Tell us if anything here is out of date.</p>} />

      <RelatedLinks
        title="Keep comparing"
        label="Keep exploring"
        links={[
          { href: "/compare/employee-monitoring-software", label: "The full employee monitoring software comparison" },
          { href: "/solutions/monitoring-without-scores", label: "Monitoring without productivity scores" },
          { href: "/features/ai-assistant", label: "Brenda, the AI assistant for teams" },
          { href: "/compare/boredroom-vs-hubstaff", label: "Boredroom vs Hubstaff" },
          { href: "/compare/boredroom-vs-time-doctor", label: "Boredroom vs Time Doctor" },
          { href: "/pricing", label: "See Boredroom's plans" },
        ]}
      />
    </>
  );
}
