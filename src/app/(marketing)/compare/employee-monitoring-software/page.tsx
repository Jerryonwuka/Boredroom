import Link from "next/link";
import { EyeOff, ShieldCheck } from "lucide-react";
import { Callout, Definition, PullQuote } from "@/components/marketing/blocks";
import { CardGrid } from "@/components/marketing/card-grid";
import { ContrastLists } from "@/components/marketing/contrast-lists";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { EndOfDayReportMock } from "@/components/marketing/visuals";
import { BoredroomViews } from "@/components/marketing/compare/boredroom-views";
import { AS_OF, SOURCES, TOOLS, type SourceKey, type ToolId } from "@/components/marketing/compare/data";
import { SourcesSection, SubHead, TextCard } from "@/components/marketing/compare/parts";
import { comparisonArticle } from "@/components/marketing/compare/schema";
import { CategoryTable, CostTable } from "@/components/marketing/compare/tables";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";

/**
 * /compare/employee-monitoring-software: the comparison hub (Content Plan page 6; owner request, 17 October 2026: SEO
 * analysis). The category's main tools on the same nine questions, one honest paragraph each (including where each is
 * better than Boredroom), the monitoring vs scoring explainer, recording and consent, the cost at 10, 50 and 200 people,
 * and the FAQ. Every fact about another product is from that vendor's own pricing or help pages, read on AS_OF and
 * listed under "Sources" (compare/data.ts). TrackForce, in the brief's list, is left out: the name covers several
 * unrelated products (security-guard workforce software among them) and none publishes a price we could check.
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): the category template (pages-design spec
 * §5.5): a centred hero with the definition box under it (still in the first 100 words), the six-tool matrix as the
 * centrepiece (tools as columns, Boredroom's last on fill-0, the nine questions as rows), how to read it as cards, the
 * five questions as numbered cells, the tools one card each, monitoring vs scoring beside the report a lead reads
 * instead, what each tool records as cards, the product, the cost table, both sides in balance, the questions, sources.
 * Every word, link, heading and fact of the first build is kept.
 */
const PATH = "/compare/employee-monitoring-software";
export const metadata = pageMetadata(PATH);

const CITED: SourceKey[] = [
  "activtrakPricing", "activtrakData", "activtrakGlossary",
  "hubstaffPricing", "hubstaffActivity", "hubstaffTracking", "hubstaffScreenshots", "hubstaffBlur",
  "timedoctorPricing", "timedoctorTracks", "timedoctorRatings", "timedoctorScreenshots", "timedoctorUsers",
  "workstatusPricing", "controlioPricing", "controlioHome", "icoMonitoring", "icoOverview", "boredroomPricing",
];

const FAQ = [
  {
    question: "What is the best employee monitoring software?",
    answer: "It depends on what you need to know. For workforce analytics across many computers, ActivTrak is the most complete of the tools here. For hourly work with proof of hours and payroll, Hubstaff or Time Doctor. For security-grade monitoring, Controlio. If you want to know what your remote team is doing without screenshots or a productivity score, Boredroom is built for that.",
  },
  {
    question: "Is employee monitoring software legal?",
    answer: "Usually, if you do it openly and in proportion. In the UK, the Information Commissioner's Office says data protection law does not prevent employers from monitoring workers, but they must tell workers about it in a way that is easy to understand, must carry out a data protection impact assessment before monitoring that is likely to be high risk, and says covert monitoring should only be authorised by senior management. Rules differ by country, so take local advice.",
  },
  {
    question: "Is there employee monitoring software that doesn't record screens?",
    answer: "Yes. Boredroom never records screens or calls and takes no screenshots. Of the other tools here, ActivTrak takes screenshots only with its Screen Details add-on and has them off by default, and Hubstaff lets owners and managers turn screenshots off for everyone or for one person. Time Doctor and Workstatus include screenshots in their plans, and Controlio includes screen recording.",
  },
  {
    question: "Which employee monitoring tools have a free plan?",
    answer: "As of 17 October 2026, ActivTrak has a free plan for up to 3 people and Boredroom has a free plan for up to 5 people in one workspace. Hubstaff, Time Doctor, Workstatus and Controlio offer 14-day trials instead.",
  },
  {
    question: "Does Boredroom score or rank employees?",
    answer: "No. Boredroom has no productivity score, ranks nobody and treats no timer, heartbeat or login as proof of work. Reports give plain counts, and a gap in someone's time leads to a question, not a penalty.",
  },
];

/** The tools, one card each, in the hub's order (Boredroom last, the same weight): the page's own paragraph per tool. */
const TOOL_CARDS: readonly { id: ToolId; body: React.ReactNode }[] = [
  { id: "activtrak", body: <p><a href={SOURCES.activtrakPricing.url}>ActivTrak</a> is workforce analytics. An agent on each work computer records apps and websites, active and passive time, and turns them into reports on utilisation, schedule adherence, focus, workload and how staff use AI tools. Activity is classed as productive, unproductive or undefined, and its <a href={SOURCES.activtrakGlossary.url}>Insights glossary</a> defines productive hours a day against a goal of 7 hours by default, plus a Productivity Efficiency percentage. It is notably restrained in one respect: its help centre says it <a href={SOURCES.activtrakData.url}>never collects keystrokes or webcam video</a>, and screenshots exist only with an add-on and are off by default. It suits larger organisations that want numbers on how work happens across hundreds of computers. It stops at the person: there is no assistant for each employee, and the core of it is a productivity measurement that some teams will not want.</p> },
  { id: "hubstaff", body: <p><a href={SOURCES.hubstaffPricing.url}>Hubstaff</a> is a time tracker with proof of work. People start and stop a timer in its app, and while it runs Hubstaff records activity levels (the share of each 10 minutes with keyboard or mouse input) and takes 1 to 3 screenshots every 10 minutes, which owners can blur or switch off. Timesheets are on every plan, and the Team plan adds scheduling, payments and payroll. Hubstaff is better than Boredroom for hourly billing, client invoices, project budgets, mobile apps and payroll, none of which Boredroom does. To its credit, its own help centre says it <a href={SOURCES.hubstaffActivity.url}>discourages quotas or scoring based on activity rates</a>. It stops where the timer stops: it knows how long something took, not what was delivered or what a lead needs to decide.</p> },
  { id: "timedoctor", body: <p><a href={SOURCES.timedoctorPricing.url}>Time Doctor</a> tracks time and activity in detail: screenshots on every plan at an interval the admin sets between 3 and 30 minutes, web and app usage, productivity ratings for every site and app, and video screen recording on Premium. Its Standard plan is strong on the administrative side: attendance, schedules, time approvals, leave and break tracking, and payroll. Employees get a personal dashboard of their own hours and breaks. It suits companies that want the most detailed record of the working day in one place. It also records the most of the three head-to-heads, which is worth weighing if your team is uneasy about being watched.</p> },
  { id: "workstatus", body: <p><a href={SOURCES.workstatusPricing.url}>Workstatus</a> combines time and activity tracking (screenshots with blur, app and URL monitoring, idle time) with projects, timesheets, shift scheduling, leave and payroll exports, and on its Profit plan, budget and margin tracking for service businesses. Employee self-view is on by default. It suits agencies and service firms that want time, attendance and profitability in one tool. It stops short of anything for the employee beyond seeing their own data, and like the others it charges per user.</p> },
  { id: "controlio", body: <p><a href={SOURCES.controlioPricing.url}>Controlio</a> sits at the security end of the category: live screen streaming and video recording from its Basic plan, optional keystroke and email monitoring, behaviour rules for websites, apps and USB devices, and an <a href={SOURCES.controlioHome.url}>optional stealth mode</a> in which the agent is invisible to the person. It can be installed on your own servers. It suits organisations with compliance or insider-risk needs that justify that level of capture. It is the furthest of the six from a team-management tool.</p> },
  { id: "boredroom", body: <p>Boredroom gives every person a personal AI assistant, Brenda, who knows their day, answers follow-ups from their real work and writes each team lead an end-of-day report: decisions waiting on them first, then what changed since yesterday. Around her: clock-ins against a schedule, late arrivals by the minute, timers people start themselves, timesheets of confirmed time with approved corrections, messages, docs and calls. It records no screens and no calls, takes no screenshots and gives no productivity score. It suits remote teams who want to know what is happening without watching anyone. It stops where the others are strongest: no app and website tracking, no payroll, no invoicing, no mobile apps, and no integrations yet.</p> },
];

/** What each tool records: the page's list, one cell per tool (the tool's name as the cell's title). */
const RECORDS: readonly { id: ToolId; body: string }[] = [
  { id: "activtrak", body: "Apps, websites and time; screenshots on alarms and live screen view only with the Screen Details add-on. Never keystrokes or webcam." },
  { id: "hubstaff", body: "Time, activity levels, apps and URLs, and 1 to 3 screenshots every 10 minutes while the timer runs. No keystrokes are stored." },
  { id: "timedoctor", body: "Time, activity levels, websites and apps, screenshots, and screen video on Premium. Keystrokes are not recorded." },
  { id: "workstatus", body: "Time, apps and URLs, screenshots, and session replay as an add-on." },
  { id: "controlio", body: "Apps and websites, live screen and video recording, and optionally keystrokes, files, email and printing." },
  { id: "boredroom", body: "The tasks people plan, the timers they start and stop, the work they submit, and clock-ins. No screens, no calls, no keystrokes, no apps or websites." },
];

export default function Page() {
  return (
    <>
      <ProductHero
        path={PATH}
        layout="center"
        jsonLd={[comparisonArticle(PATH, CITED, ["activtrak", "hubstaff", "timedoctor", "workstatus", "controlio", "boredroom"])]}
        lead={<p>Six tools on the same nine questions: what they record, whether they score people, how consent works, what they cost at 10, 50 and 200 people, and who each one suits. Facts about other products come from their own pricing and help pages, read on {formatDate(AS_OF)}.</p>}
        actions={<PrimaryCta secondary={{ href: "/pricing", label: "Boredroom pricing" }} />}
        footer={<Definition term="Employee monitoring software" className="text-left">records what people do on their work computers (time, apps and websites, keyboard and mouse activity, and often screenshots or screen video) so that an employer can report on attendance, productivity or security. Some tools turn that record into a productivity score; others only count time.</Definition>}
      />

      <Section id="comparison-table" label="Six tools, nine questions" title="The comparison table" align="center" className="pt-4 sm:pt-6"
        sub={<>
          <p>This is an employee monitoring software comparison written by Boredroom, so read it knowing who wrote it. We have tried to make it useful anyway: the same questions for every tool, each vendor described from its own pages, and a plain account of where each one is better than ours. Boredroom is remote team management software with a personal AI assistant named Brenda for every team member. No productivity score, no screen recording, no call recording. That is a choice, and it means Boredroom is the wrong tool for some of the jobs below.</p>
          <p>Here is every tool on the same nine questions, in a few words a cell. The head-to-head pages give the full answer for each: <Link href="/compare/boredroom-vs-activtrak">Boredroom vs ActivTrak</Link>, <Link href="/compare/boredroom-vs-hubstaff">Boredroom vs Hubstaff</Link> and <Link href="/compare/boredroom-vs-time-doctor">Boredroom vs Time Doctor</Link>.</p>
        </>}>
        <CategoryTable />
        <div className="mt-12 grid gap-3 lg:grid-cols-2">
          <TextCard title="What each column means">
            <ul className="space-y-2.5">
              <li><strong className="font-medium text-foreground">Screen recording and screenshots:</strong> whether the tool captures images or video of the screen, and on which plan.</li>
              <li><strong className="font-medium text-foreground">Productivity score or rating:</strong> whether activity is classed as productive or not and turned into a figure per person.</li>
              <li><strong className="font-medium text-foreground">Call recording:</strong> whether calls are recorded. None of the monitoring tools here lists a calling feature; Boredroom has calls and never records them.</li>
              <li><strong className="font-medium text-foreground">Consent and visibility:</strong> who starts the tracking, and whether it can run where the person cannot see it.</li>
              <li><strong className="font-medium text-foreground">Attendance and timesheets:</strong> clock-ins, schedules, lateness, approved hours.</li>
              <li><strong className="font-medium text-foreground">AI assistant:</strong> whether each person gets an assistant of their own, or AI is used to analyse them.</li>
              <li><strong className="font-medium text-foreground">Pricing model, free plan or trial, best for:</strong> what you pay for, how you try it, and the job each tool is built for.</li>
            </ul>
          </TextCard>
          <TextCard title="How to read the table without being misled">
            <p>Three cautions. First, a feature on a vendor&apos;s list may sit on a higher plan or behind an add-on, so check the plan you would actually buy; we name the plan where the vendor does. Second, &ldquo;none listed&rdquo; means exactly that: the vendor&apos;s pricing page did not list it on {formatDate(AS_OF)}, not that it can never exist. Third, the tools are not trying to do the same job. ActivTrak is an analytics product, Hubstaff and Time Doctor are time trackers with monitoring, Controlio is closer to security software, and Boredroom is a way of running a remote team. A row that looks empty may simply be outside what a tool is for.</p>
          </TextCard>
        </div>
      </Section>

      <Section id="how-to-compare" label="How to compare" title="How to compare employee monitoring software" align="center">
        <SubHead title="The five questions that actually matter" className="mx-auto text-center"
          sub={<p>Feature lists in this category run to dozens of lines, and most of them are variations on five questions. Answer these first and the shortlist writes itself.</p>} />
        <StepGrid columns={3} headingLevel="h4" className="mt-8" steps={[
          { title: "What does it record?", body: <p>Time only, apps and websites, keyboard and mouse activity, screenshots, screen video, keystrokes. Each step down that list is more evidence and more intrusion.</p> },
          { title: "Does it turn the record into a judgement?", body: <p>A tool can report hours, or it can class activity as productive and unproductive and give each person a number against a goal.</p> },
          { title: "Who knows it is running?", body: <p>Some tools track only when the person presses Start. Others run in the background, and several offer a silent or stealth mode.</p> },
          { title: "What does a lead get from it?", body: <p>A dashboard to read, or something that answers the question they were going to ask anyway.</p> },
          { title: "How is it priced?", body: <p>Almost every tool here charges per person per month. That decides the bill at 50 or 200 people more than any feature does.</p> },
        ]} />
        <CardGrid variant="cards" columns={2} className="mt-12" items={[
          { icon: <EyeOff />, title: "What the category gets wrong", body: <>
            <p>Monitoring tools measure what a computer can see: which window was in front, whether the mouse moved, what was on the screen at 10:42. The work a lead cares about is rarely visible that way. A designer thinking through a layout, an engineer reading code, a manager on a long call: all of them can look idle to an activity meter. The opposite is also true: a mouse jiggler looks busy, which is why several tools list jiggler detection as a feature.</p>
            <p>The result is a lot of data that answers the wrong question. A lead does not want to know that someone was 71% active between 2pm and 3pm. They want to know whether the proposal went out, what is blocked, and who needs a decision from them.</p>
          </> },
          { icon: <ShieldCheck />, title: "The one distinction most buyers miss: monitoring vs scoring", body: <p>Recording time is one thing. Converting that record into a verdict on a person is another. Most of the debate about monitoring is really about scoring: the productive hours figure against a goal, the activity percentage, the ranked team. You can have attendance and timesheets without any of it, and that is the line we draw. There is more on it in <Link href="/solutions/monitoring-without-scores">monitoring without productivity scores</Link>, and below.</p> },
        ]} />
      </Section>

      <Section id="tools" label="One by one" title="The tools, one by one" align="center"
        sub={<p>One paragraph each, from the vendor&apos;s own pages: what it does, who it suits, and where it stops.</p>}>
        <CardGrid variant="cards" columns={2} items={TOOL_CARDS.map(({ id, body }) => ({
          title: `${TOOLS[id].name}: what it does, who it suits, where it stops`,
          body,
          footer: <p className="text-meta font-normal text-secondary"><span className="font-medium text-foreground">Best for:</span> {TOOLS[id].short.bestFor}</p>,
        }))} />
        <Callout title="Why TrackForce is not here" className="mt-3">
          <p>The brief for this page listed TrackForce. The name is used by several unrelated products, the best known of them software for security-guard firms, and none publishes prices we could check, so we left it out rather than guess.</p>
        </Callout>
      </Section>

      <SplitSection id="monitoring-vs-scoring" label="Monitoring vs scoring" title="Monitoring vs scoring: the distinction that changes the shortlist" tone="tint"
        points={[
          { title: "What a productivity score is", body: <p>A productivity score is a number that stands in for a person&apos;s output. The tool decides which apps and sites count as work, measures time in them, and compares the result with a target or with colleagues. ActivTrak&apos;s version is productive hours a day against a goal, Time Doctor&apos;s is a rating on every site and app, Hubstaff&apos;s Insights add-on adds unproductive apps and a team leaderboard. Each is configurable, and each is a judgement made by software about a person.</p> },
          { title: "What it measures, and what it misses", body: <p>It measures attention to a screen, classified by a rule someone wrote. YouTube is unproductive until it is the marketing team&apos;s job; a design tool is productive even while someone stares at a blank canvas. It misses the work that does not happen in a classified window: thinking, phone calls, a conversation in the kitchen, reading on paper. And it changes behaviour, because people learn what the meter rewards. That is why several tools here list detection of mouse jigglers and auto-clickers as a feature.</p> },
          { title: "What teams use instead", body: <p>The alternative is to ask about the work rather than measure the screen. A short end-of-day note of what was done, what is blocked and what is next tells a lead more than a day of activity data. In Boredroom nobody has to write it: Brenda drafts each lead&apos;s end-of-day report from the work itself, and a person&apos;s own assistant answers &ldquo;where is the deck?&rdquo; from their tasks, so the lead does not have to chase. If you want the evidence on how remote teams actually perform, our <Link href="/blog/remote-work-productivity-statistics">remote work productivity statistics</Link> collects it, with sources.</p> },
        ]}
        visual={<EndOfDayReportMock />}
        visualCaption="Asking about the work instead of measuring the screen: the end-of-day report Brenda drafts for each lead.">
        <PullQuote>No productivity score, no screen recording, no call recording.</PullQuote>
      </SplitSection>

      <Section id="recording-and-consent" label="Recording and consent" title="Screen recording, call recording and consent">
        <SubHead title="What each tool records" />
        <CardGrid columns={3} headingLevel="h4" className="mt-6" items={RECORDS.map(({ id, body }) => ({ title: TOOLS[id].name, body: <p>{body}</p> }))} />
        <div className="mt-12 grid gap-3 lg:grid-cols-2">
          <TextCard title="The consent question">
            <p>Consent here means two things: does the person know, and do they have any say? On the first, the tools differ by design. Hubstaff tracks only between Start and Stop in its app, though its Silent app can track company-owned devices in the background. Time Doctor lets the employer choose background tracking or an app the person starts. ActivTrak and Workstatus offer silent deployment, and Controlio an invisible stealth mode. On the second, monitoring tools are set by the employer.</p>
            <p>Boredroom works the other way round. Everyone can read the monitoring notice in their profile and is told when it changes. Timers run only when the person starts them. On a call, each person chooses Include me or Not me before Brenda takes notes; no answer counts as no, only the words of people who agree are written down, on their own device, and the transcript is deleted 7 days after the recap.</p>
          </TextCard>
          <TextCard title="What “no recording” actually means">
            <p>In Boredroom it means three specific things. Screens are never recorded: there is no screenshot feature and no screen video, and screen sharing on a call happens only when the person shares. Calls are never recorded: their sound and video pass through the video provider only to reach the people on the call. And Brenda for Mac, which can look at a screen to help, does so only when that person asks, keeps nothing, and the organisation cannot see the picture or whether it was used.</p>
          </TextCard>
        </div>
      </Section>

      <BoredroomViews intro="Coded views of the product, as staff and leads see it. There is no screenshot of anyone's screen to show, because Boredroom never takes one." />

      <Section id="pricing" label="Pricing" title="Pricing comparison">
        <div className="grid gap-3 lg:grid-cols-2">
          <TextCard title="Per-seat vs per-workspace pricing">
            <p>Every monitoring tool here charges per person per month, and most give the lowest price only on annual billing. ActivTrak sells annual plans only. Hubstaff has a 2-seat minimum and Controlio a 5-user minimum. Boredroom charges per workspace: one price for the team whether it has 6 people or 50, which is why the gap widens as a team grows. See <Link href="/pricing">Boredroom pricing</Link> for the plans.</p>
          </TextCard>
          <TextCard title="What the free tiers actually include">
            <p>ActivTrak&apos;s free plan covers up to 3 people with 30 days of history. Boredroom&apos;s covers 1 workspace and up to 5 people, with the AI assistant, with no card. Hubstaff, Time Doctor, Workstatus and Controlio have 14-day trials; Hubstaff also gives report-only viewers a free role.</p>
          </TextCard>
        </div>
        <SubHead title="The true cost at 10, 50 and 200 people" className="mt-16"
          sub={<p>The table uses each tool&apos;s entry plan and the plan most teams would need for attendance or timesheets, at the listed US dollar price. Vendors may show different prices by region and change them often; the date is in the caption.</p>} />
        <CostTable className="mt-6" minWidth="40rem"
          plans={["boredroomMonthly", "boredroomAnnual", "activtrakTracking", "activtrakOptimisation", "hubstaffStarterAnnual", "hubstaffTeamAnnual", "timedoctorBasicAnnual", "timedoctorStandardAnnual", "workstatusProof", "controlioBasicAnnual"]}
          label="Employee monitoring software cost at 10, 50 and 200 people"
          footnote={<p>Hubstaff also lists VIP support that is applied automatically to larger monthly subscriptions, at $29 a month per organisation between $275 and $400 a month and $59 above $400. It is not included above.</p>} />
      </Section>

      <Section id="choose" label="Both sides" title="Which tool should you choose?" align="center" tone="tint">
        <ContrastLists lists={[
          { title: "Choose a monitoring tool if…", items: [
            "You bill clients by the hour and need proof of hours with screenshots: Hubstaff or Time Doctor.",
            "You run payroll from tracked time and want it in the same tool: Hubstaff, Time Doctor or Workstatus.",
            "You want analytics on how work happens across hundreds of computers, including technology and AI use: ActivTrak.",
            "You have compliance or insider-risk requirements that justify screen video and keystroke rules: Controlio.",
            "You need mobile apps or GPS for field staff: Hubstaff and Workstatus offer them; Boredroom does not.",
          ] },
          { title: "Choose Boredroom if…", items: [
            "You want to know what your remote team is doing without screenshots, screen video or a productivity score.",
            "You want each person to have an assistant that answers follow-ups from their work, so leads stop chasing.",
            "You want an end-of-day report for every lead that nobody has to write.",
            "You need attendance and timesheets that add up, with corrections that keep their history.",
            "You would rather pay per workspace than per person.",
          ] },
        ]} />
        <TextCard title="The honest answer for most remote teams" className="mt-3 bg-background">
          <p>Most remote teams do not need to see screens. They need to know who is working, on what, what is blocked and what got done, and they need the people being measured to trust the measure. If that is you, start with the tools that record the least and see whether anything is missing. If you genuinely need proof of every hour for a client or a regulator, a monitoring tool is the right answer, and the head-to-heads above will help you pick one.</p>
        </TextCard>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <SourcesSection keys={CITED} title="Sources and method"
        intro={<p>We read each vendor&apos;s pricing page and help centre on {formatDate(AS_OF)} and took every fact from there: no review sites, ratings or customer stories. Prices are the US dollar list prices shown to us that day, before tax. Where a page did not say something, we say so rather than guess. Boredroom&apos;s facts come from the product itself. If anything here is out of date, tell us and we will correct it.</p>} />

      <RelatedLinks
        title="Keep comparing"
        label="Keep exploring"
        links={[
          { href: "/compare/boredroom-vs-activtrak", label: "Boredroom vs ActivTrak" },
          { href: "/compare/boredroom-vs-hubstaff", label: "Boredroom vs Hubstaff" },
          { href: "/compare/boredroom-vs-time-doctor", label: "Boredroom vs Time Doctor" },
          { href: "/solutions/monitoring-without-scores", label: "Monitoring without productivity scores" },
          { href: "/blog/remote-work-productivity-statistics", label: "Remote work productivity statistics" },
          { href: "/pricing", label: "Boredroom pricing, per workspace" },
        ]}
      />
    </>
  );
}
