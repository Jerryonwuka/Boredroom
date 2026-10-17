import Link from "next/link";
import { CalendarCheck, Camera, ChartColumn, ClipboardList, Scale, Sparkles, Timer, UsersRound } from "lucide-react";
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
import { FollowUpMock, TimesheetCorrectionMock } from "@/components/marketing/visuals";
import { BoredroomViews } from "@/components/marketing/compare/boredroom-views";
import { AS_OF, SOURCES, type SourceKey } from "@/components/marketing/compare/data";
import { AtAGlance, LinkLine, SourcesSection, SubHead, TextStack } from "@/components/marketing/compare/parts";
import { comparisonArticle } from "@/components/marketing/compare/schema";
import { CostTable, HeadToHeadTable } from "@/components/marketing/compare/tables";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";

/**
 * /compare/boredroom-vs-time-doctor (Content Plan page 9; owner request, 17 October 2026: SEO analysis). The page turns
 * on the employee's experience, as the brief asks. Time Doctor's facts are from its pricing page and help centre, read on
 * AS_OF (compare/data.ts). "Why it matters for retention" gives no figures: we found none from a primary source and
 * invent none (build spec D18); it argues from what each person sees.
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): the head-to-head template (pages-design
 * spec §5.4), with this page's own sections: monitoring intensity beside the timesheet that asks about a gap instead of
 * capturing the screen, and what employees see beside their own Brenda answering a follow-up. Every word, link, heading
 * and fact of the first build is kept.
 */
const PATH = "/compare/boredroom-vs-time-doctor";
export const metadata = pageMetadata(PATH);

const CITED: SourceKey[] = ["timedoctorPricing", "timedoctorTracks", "timedoctorRatings", "timedoctorUsers", "timedoctorScreenshots", "timedoctorDeleting", "boredroomPricing"];

const FAQ = [
  {
    question: "Is Boredroom less invasive than Time Doctor?",
    answer: "Yes, by design. Time Doctor can take screenshots, record screen video on its Premium plan, track websites and apps, and rate each one as productive or not. Boredroom does none of those things: it records the tasks people plan, the timers they start and stop, the work they submit and their clock-ins, and it never records screens or calls.",
  },
  {
    question: "Does Boredroom take screenshots?",
    answer: "No. Boredroom never takes screenshots and never records screens or calls. A person's screen is seen only when they share it on a call, or when they ask Brenda for Mac to look at it, and she keeps nothing.",
  },
  {
    question: "Can I switch from Time Doctor to Boredroom?",
    answer: "Yes, though there is no importer. Export the Time Doctor reports you need for payroll or records first. Then create a Boredroom workspace, set your clock-in time, clock-out time and grace period, make your teams and invite people with a code, a link or an email. Boredroom keeps its own record from the first clock-in. Tell your team what changes: the monitoring notice in their profile says exactly what Boredroom records.",
  },
  {
    question: "Does Time Doctor record keystrokes?",
    answer: "No. Time Doctor's help centre says it measures keyboard and mouse activity during tracked time but does not record the keys pressed, and that it tracks nothing while time tracking is paused or stopped.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH} layout="center" jsonLd={[comparisonArticle(PATH, CITED, ["timedoctor", "boredroom"])]}
        actions={<PrimaryCta secondary={{ href: "/pricing", label: "Boredroom pricing" }} />}
        footer={<VersusLockup them="Time Doctor" asOf={AS_OF} />} />

      <AtAGlance tool="timedoctor" />

      <Section id="short-version" label="Overview" title="The short version" align="center"
        sub={<p>Time Doctor records the working day in detail: time, websites and apps, screenshots, productivity ratings and, on its top plan, screen video. Boredroom is remote team management software with a personal AI assistant named Brenda for every team member, and it records none of those things. The difference is felt most by the people being tracked, so that is where this page spends its time. The nine questions are the same as in our <Link href="/compare/employee-monitoring-software">employee monitoring software comparison</Link>, and Time Doctor&apos;s facts come from its own pricing and help pages as of {formatDate(AS_OF)}.</p>}>
        <CardGrid columns={3} items={[
          { icon: <ClipboardList />, title: "Who Time Doctor is for", body: <p>Companies that want a detailed, auditable record of the working day in one tool: time on projects and tasks, screenshots, web and app usage with productivity ratings, attendance, leave, breaks and payroll. It runs on Windows, Mac, Linux, Chrome and mobile, and its help centre and add-ons cover a lot of ground.</p> },
          { icon: <UsersRound />, title: "Who Boredroom is for", body: <p>Remote teams that have decided, or would like to decide, that nobody needs to be watched. They still want attendance and timesheets that add up, and they want each lead to know what was delivered without chasing anyone. Each person gets Brenda, who answers follow-ups from their work and writes each lead&apos;s end-of-day report.</p> },
          { icon: <Scale />, title: "The one-line difference", body: <p>Time Doctor watches the work happen. Boredroom asks about it, and lets each person&apos;s assistant answer.</p> },
        ]} />
      </Section>

      <Section id="features" label="Side by side" title="Feature-by-feature comparison" align="center">
        <HeadToHeadTable tool="timedoctor" />
        <CardGrid variant="cards" columns={2} className="mt-12" items={[
          { icon: <Timer />, title: "Time tracking and timesheets", body: <p>Time Doctor tracks time to projects and tasks, automatically in the background or through an interactive app the person starts, as the employer chooses; its Standard plan adds time approvals and payroll. Boredroom tracks time from a timer the person starts on a named task, and pauses it when they do. Its timesheets count only confirmed time, and a correction counts once a lead approves it, with the approved version kept.</p> },
          { icon: <Camera />, title: "Screenshots and activity monitoring", body: <p>Every Time Doctor plan includes screenshots, taken at an interval the admin sets <a href={SOURCES.timedoctorScreenshots.url}>between 3 and 30 minutes</a>. Standard adds web and app usage and productivity ratings; Premium adds video screen recording, mouse jiggler and clicker detection, irregular keyboard activity and internet connectivity tracking. Boredroom has none of these. It has no screenshot feature and no activity meter.</p> },
          { icon: <CalendarCheck />, title: "Attendance and scheduling", body: <p>Time Doctor&apos;s Standard plan includes attendance, schedules, leave tracking and break tracking, which is more than Boredroom does: Boredroom has no leave or break tracking. Boredroom&apos;s attendance is on every plan: a clock-in time, a clock-out time and a grace period for the workspace, late arrivals recorded by the minute, and a month view of every person and every day.</p> },
          { icon: <Sparkles />, title: "AI assistant", body: <p>Time Doctor&apos;s AI analyses the data: Benchmarks AI compares productivity with other users and teams, and the Unusual Activity AI report looks for patterns such as mouse jigglers. Boredroom&apos;s AI works for the person. Brenda is an <Link href="/features/ai-assistant">AI assistant for teams</Link>: one for every member, who plans their day, reminds them, drafts with them and answers other people&apos;s follow-ups from their work. Nothing she does lands on someone else&apos;s list until they accept it.</p> },
          { icon: <ChartColumn />, title: "Reporting", body: <p>Time Doctor has timeline, project, activity, web and app, attendance and payroll reports, and an executive dashboard on Premium. Boredroom has the organisation dashboard, the standup rollup, CSV exports, and Brenda&apos;s end-of-day report for every lead. Its reports give plain counts, and nobody is ranked.</p> },
        ]} />
      </Section>

      <SplitSection id="intensity" label="Monitoring" title="Monitoring intensity: the real difference"
        points={[
          { title: "What Time Doctor captures", body: <p>Its help centre lists what it <a href={SOURCES.timedoctorTracks.url}>tracks on a computer</a>: start and end times and total time worked; time on projects and tasks; the websites and apps used and for how long; keyboard and mouse activity levels during tracked time, without recording the keys pressed; and intermittent screenshots or video recordings of the screen, where they are switched on. It tracks nothing while tracking is paused or stopped. Admins and owners <a href={SOURCES.timedoctorRatings.url}>rate each site and app</a> as Productive, Unproductive or Neutral, for everyone or for a group.</p> },
          { title: "What Boredroom captures", body: <p>The tasks people plan, the work sessions they start and stop, the progress notes and evidence they submit, and clock-ins. Heartbeats show whether a browser is connected and are never a measure of productivity. Screens are never recorded and calls are never recorded. On a call, Brenda takes notes only for the people who choose Include me, on their own device, and the transcript is deleted 7 days after the recap.</p> },
          { title: "The team-trust question", body: <p>Monitoring changes the deal between a lead and a team. A screenshot every few minutes says, in effect, &ldquo;show me&rdquo;. That is reasonable in some settings: client billing, regulated work, a team that has asked for proof to protect itself. Our view is that in most remote teams it costs more trust than it earns, because the people who were doing the work feel watched and the people who weren&apos;t learn to look busy. Boredroom starts from the other assumption, and writes the rules into the product: uncertain time leads to a question, not a penalty, and a correction to someone&apos;s hours counts only once a lead approves it. There is more on this approach in <Link href="/solutions/monitoring-without-scores">monitoring without productivity scores</Link>.</p> },
        ]}
        visual={<TimesheetCorrectionMock />}
        visualCaption="Uncertain time leads to a question, not a penalty: the correction counts once the lead approves it.">
        <PullQuote>No productivity score, no screen recording, no call recording.</PullQuote>
      </SplitSection>

      <SplitSection id="employees" label="The employee's side" title="What employees see" tone="tint" visualSide="left"
        points={[
          { title: "The employee experience in Time Doctor", body: <p>Time Doctor gives employees a <a href={SOURCES.timedoctorUsers.url}>personal dashboard</a> on every plan: their start and end times, breaks and daily totals over 7 or 30 days, and on Standard or Premium their web and app usage and productivity ratings, which administrators set. Screenshots are taken while they track. Whether they can delete one is a company setting, and <a href={SOURCES.timedoctorDeleting.url}>deleting a screenshot removes the work time</a> that goes with it. That is a fair rule, and it shows what the screenshot is for: evidence for the hours.</p> },
          { title: "The employee experience in Boredroom", body: <p>A staff member&apos;s whole day is one card: type a to-do, press Start, press Done. They have their own Brenda, who briefs them each morning, plans their day, sets reminders and answers the follow-ups that would otherwise interrupt them. Their chats with her are theirs: not their lead, not the owner, not HR can read them. Direct messages are readable only by the two people in them. Everyone can read the monitoring notice in their profile, and is told when it changes. Nothing on their screen is captured, because nothing is captured.</p> },
          { title: "Why it matters for retention", body: <p>We don&apos;t have a reliable figure for how monitoring affects staff turnover, and we won&apos;t invent one. The argument is simpler. People stay where they are trusted and where their work is seen for what it is. A tool that rates their browser history and photographs their screen tells them one thing about how they are seen; a tool that gives them an assistant and asks them about gaps tells them another. If your team has pushed back on monitoring, that is worth listening to before you choose.</p> },
        ]}
        visual={<FollowUpMock />}
        visualCaption="Their own Brenda answers the follow-ups that would otherwise interrupt them, from their work." />

      <BoredroomViews intro="Coded views of the product. Time Doctor's interface is on its own site; we don't reproduce other companies' screenshots." />

      <Section id="pricing" label="Pricing" title="Pricing">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <TextStack items={[
            { title: "Per-seat vs per-workspace", body: <p>Time Doctor charges per user: Basic $8, Standard $14 and Premium $20 a month billed monthly, or $6.67, $11.67 and $16.70 billed annually; Enterprise is a custom price. HRIS and payroll integrations are $200 each a month. Boredroom charges per workspace: Pro is $15 a month or $150 a year for up to 50 people, Enterprise $50 a month or $500 a year with no limit. <Link href="/pricing">Boredroom pricing</Link> shows what each plan includes.</p> },
            { title: "What the free tiers include", body: <p>Time Doctor has a 14-day trial of its Premium plan, with no card, and no free plan. Boredroom has a free plan for 1 workspace and up to 5 people, with Brenda, attendance and timesheets, and no card; Pro has a 3-day trial and Enterprise a 7-day trial.</p> },
          ]} />
          <div className="min-w-0">
            <SubHead title="Cost at 10, 50 and 200 people" className="mb-5" />
            <CostTable plans={["boredroomMonthly", "boredroomAnnual", "timedoctorBasicMonthly", "timedoctorBasicAnnual", "timedoctorStandardMonthly", "timedoctorStandardAnnual", "timedoctorPremiumAnnual"]} label="Boredroom vs Time Doctor cost at 10, 50 and 200 people" />
          </div>
        </div>
      </Section>

      <Section id="choose" label="Both sides" title="Which should you choose?" align="center" tone="tint">
        <ContrastLists lists={[
          { title: "Choose Time Doctor if…", items: [
            "Your clients or your contracts require screenshots or screen video as proof of work.",
            "You want web and app usage, rated for productivity, alongside time on tasks.",
            "You need leave and break tracking, payroll, or HRIS and payroll integrations in the same tool.",
            "Your team needs mobile apps for time tracking.",
          ] },
          { title: "Choose Boredroom if…", items: [
            "Your team has pushed back on monitoring and you want a tool that records only what people do on purpose.",
            "You want attendance and confirmed timesheets without screenshots, ratings or an activity meter.",
            "You want every person to have an AI assistant, and every lead an end-of-day report nobody had to write.",
            "You want calls, messages and docs in the same place as the work, with calls never recorded.",
            "You would rather pay per workspace than per user.",
          ] },
        ]} />
        <LinkLine>Also comparing others? See <Link href="/compare/boredroom-vs-activtrak">Boredroom compared with ActivTrak</Link> and <Link href="/compare/boredroom-vs-hubstaff">Boredroom compared with Hubstaff</Link>.</LinkLine>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <SourcesSection keys={CITED}
        intro={<p>Time Doctor&apos;s facts come from its own pricing page and help centre, read on {formatDate(AS_OF)}; prices are the US dollar list prices shown that day and may differ by region. Boredroom&apos;s come from the product. Tell us if anything here is out of date.</p>} />

      <RelatedLinks
        title="Keep comparing"
        label="Keep exploring"
        links={[
          { href: "/compare/employee-monitoring-software", label: "Compare the whole category" },
          { href: "/solutions/monitoring-without-scores", label: "Monitoring without productivity scores" },
          { href: "/features/ai-assistant", label: "An AI assistant for every person" },
          { href: "/compare/boredroom-vs-activtrak", label: "Boredroom vs ActivTrak" },
          { href: "/compare/boredroom-vs-hubstaff", label: "Boredroom vs Hubstaff" },
          { href: "/pricing", label: "Boredroom pricing" },
        ]}
      />
    </>
  );
}
