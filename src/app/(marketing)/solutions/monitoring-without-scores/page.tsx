import Link from "next/link";
import { CalendarCheck, Database, Eye, FileText, Gauge, History, ListChecks, ListOrdered, MessageSquareOff, MonitorOff, Target, Timer, VideoOff } from "lucide-react";
import { AsOf, CheckList, PullQuote, Sources, type Source } from "@/components/marketing/blocks";
import { CardGrid, LimitsGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { CopyBlock } from "@/components/marketing/copy-block";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { FeatureAccordion } from "@/components/marketing/feature-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { MovingPicture, ProductCta, SEE_PRICING } from "@/components/marketing/product/parts";
import { AttendanceMock, ChangesCard, CommitmentMock, DashboardPeek, EndOfDayReportMock, MyDayMock, ReportsMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_LINE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /solutions/monitoring-without-scores (owner request, 17 October 2026: SEO analysis; Content Plan page 11, the positioning
 * page). The brief's outline, its "what we record / what we never record" table (the asset AI answers cite), the
 * positioning line as a pull quote in the analysis's words, the consent mechanics, a copyable "what to say to your team"
 * script, a comparison with activity-based monitoring tools and the call to action after the record table.
 *
 * Boredroom's side is built (src/app/page.tsx FAIR and faq(), server/services/orgs.ts DEFAULT_NOTICE, attendance.ts,
 * reports.ts, daily-report.ts; checked 17 October 2026). The other tools' side is only what their own pages said when
 * fetched on 17 October 2026 (SOURCES, shown on the page with an "as of" date), described fairly: none of them records
 * the keys pressed, and their screenshots are optional. No statistics: the productivity data lives in the statistics post.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the solution template
 * (spec §5.2): a split hero with the dashboard, the problem as three cards, what it looks like beside the live changes
 * (Pause under it), the record table, the positioning line and the four limits on a tinted band, the call to action,
 * consent as four cards, what you get instead as an accordion with a picture per row, introducing it beside the copyable
 * message on a tinted band, the cited comparison and when the other way is right, the FAQ, the sources and related
 * cards. Every h2, every h3 that heads content, every link (and source) and its words are kept; the TOC is gone (V11).
 */
const PATH = "/solutions/monitoring-without-scores";
export const metadata = pageMetadata(PATH);
const AS_OF = "2026-10-17";

const SOURCES = [
  { title: "How are activity levels calculated in Hubstaff?", publisher: "Hubstaff help centre", url: "https://support.hubstaff.com/how-are-activity-levels-calculated/", asOf: AS_OF },
  { title: "Time tracking with screenshots", publisher: "Hubstaff", url: "https://hubstaff.com/features/time-tracker-with-screenshots", asOf: AS_OF },
  { title: "What does Time Doctor track on my computer?", publisher: "Time Doctor knowledge base", url: "https://support.timedoctor.com/knowledge/what-does-time-doctor-monitor-on-my-computer", asOf: AS_OF, published: "11 September 2025" },
  { title: "Productivity management and measurement software", publisher: "ActivTrak", url: "https://www.activtrak.com/solutions/productivity-management/", asOf: AS_OF },
] as const satisfies readonly Source[];
const [HUBSTAFF_ACTIVITY, HUBSTAFF_SCREENSHOTS, TIME_DOCTOR, ACTIVTRAK] = SOURCES;

const SCRIPT = `Hi everyone,

From [date] we're running our days in Boredroom: to-dos, timers, attendance, messages and calls in one place.

What it records: the tasks you plan, the timers you start and stop, the work and notes you submit, and when you clock in and out. Timers only run when you start them.

What it never does: it doesn't record your screen, it never records calls, and it gives nobody a productivity score. Nobody is ranked.

Each of you gets your own assistant, Brenda (you can rename her). Your chats with her are yours. I can't read them, and neither can anyone else.

If someone turns on call notes, you choose Include me or Not me. No answer counts as no.

If time is missing or uncertain, you'll get a question, not a penalty.

The full monitoring notice is in your profile, and you'll be told whenever it changes. Questions? Ask me directly.

[Your name]`;

const FAQ = [
  {
    question: "Is there employee monitoring software that doesn't record screens?",
    answer: "Yes. Boredroom doesn't record screens and never records calls. It shows attendance against your schedule, confirmed time from the timers people start, and a daily report written by Brenda for each lead. On a Mac, Brenda looks at a screen only when that person asks her to, if the organisation allows it, and never keeps the picture.",
  },
  {
    question: "Can you monitor a remote team without productivity scores?",
    answer: "Yes. Instead of a score built from activity, Boredroom gives leads plain facts: who has clocked in and who was late, the confirmed hours per person, what was finished and sent for review, what is overdue or blocked, and the commitments people accepted. Nobody is ranked.",
  },
  {
    question: "Is non-invasive monitoring effective?",
    answer: "It answers the questions a lead actually asks: is the work done, is it on time, is anyone blocked, and who is in today. It does that from the work itself rather than from keyboard or screen activity, so people have no reason to perform for a tracker and leads get answers they can act on.",
  },
];

/** A cell that names a source: the claim, then the source as a visible link. */
function Cited({ children, source }: { children: React.ReactNode; source: Source }) {
  return <>{children} (<a href={source.url}>{source.publisher}</a>)</>;
}

/** A row of the records table: what Boredroom records, and what it never records. */
const recordRow = (records: string, never: string) => ({ cells: { records: { mark: "yes" as const, text: records }, never: { mark: "no" as const, text: never } } });

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>You want to know what your remote team is working on. You don&apos;t want to watch their screens or turn their day into a percentage.</p>}
        sub={<p>{ENTITY_SENTENCE} Here is what that looks like in practice, what it records and what it never does.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={POSITIONING_POINTS}
        visual={<DashboardPeek height={420} />}
      />

      <Section id="problem" label="The problem" title="The problem with productivity scores" align="center"
        sub={<p>A score measures input, rewards looking busy and costs trust.</p>}>
        <CardGrid columns={3} items={[
          { icon: <Gauge />, title: "What a score actually measures", body: <p>A productivity score is built from activity: how often the keyboard and mouse are used, and which apps and websites are open. Hubstaff, for example, counts each second with keyboard or mouse input and divides by the 600 seconds in each 10-minute block. Time Doctor rates the sites and apps people use as productive, unproductive, neutral or unrated. Those are measures of input, not of finished work.</p> },
          { icon: <Target />, title: "Why scores get gamed", body: <p>Once a number is used to judge people, people work on the number. Activity can be produced without any work, and a lot of real work produces none: reading a brief, thinking through a problem, a phone call, a sketch on paper. A score rewards the first and misses the second.</p> },
          { icon: <Eye />, title: "What scores cost you in trust", body: <p>A score tells everyone they are being watched for signs of slacking. The people doing good work feel judged by a proxy, and the conversation with their lead turns from the work to the number. If you want the research on how remote teams perform, start with <Link href="/blog/remote-work-productivity-statistics">the productivity data</Link>.</p> },
        ]} />
      </Section>

      <SplitSection id="without-scores" label="In practice" title="What monitoring without scores looks like"
        points={[
          { title: "Visibility without surveillance", body: <p>A lead needs to know four things: who is in, what is being worked on, what is finished and what is stuck. All four come from the work itself. A staff member types a to-do, presses Start and presses Done, and every change reaches the lead&apos;s screen within seconds.</p> },
          { title: "Status from timers, not from inference", body: <p>Timers only run when someone starts them. Heartbeats show whether the browser is connected; they are not a measure of productivity. When a laptop sleeps, the session closes at the last heartbeat and the gap is marked uncertain. The person is asked what happened, and the time is not counted or held against them.</p> },
          { title: "Reports that inform, not rank", body: <p>Every lead gets an end-of-day report from Brenda: the decisions waiting on them, what changed since yesterday, and per person the confirmed hours, finished work, anything overdue or blocked, and attendance. It gives plain counts. Nobody is compared with anyone else.</p> },
        ]}
        bare visual={<MovingPicture caption="Every change as it happens: a clock-in, a timer started, a call, a blocked task, work sent for checking and approved."><ChangesCard /></MovingPicture>}
      />

      <Section id="what-we-record" label="The record" title="What Boredroom records, and what it doesn't" tone="tint"
        sub={<p>This is the same list every member can read in the monitoring notice in their profile.</p>}>
        <ComparisonTable layout="versus" rowHeader={null} label="What Boredroom records and what it never records"
          caption="What Boredroom records, and what it never records"
          columns={[{ key: "records", label: "Boredroom records" }, { key: "never", label: "Boredroom never records" }]}
          rows={[
            recordRow("The tasks you plan", "Your screen"),
            recordRow("The timers you start, pause and stop", "Calls: their sound and video only pass through to reach the people on the call"),
            recordRow("The work, progress notes and evidence you submit", "Keystrokes, mouse movement, or the apps and websites you use"),
            recordRow("When you clock in and out, and lateness against the schedule", "A productivity score, or a ranking of people"),
            recordRow("Call notes, only for people who chose Include me", "The words of anyone who said Not me or didn't answer"),
            recordRow("Timesheet corrections, with their history", "Your chats with Brenda, for anyone but you"),
          ]}
        />
        <PullQuote className="my-12 text-center">{POSITIONING_LINE}</PullQuote>
        <LimitsGrid columns={4} items={[
          { icon: <MonitorOff />, title: "No screen recording", body: <p>Boredroom does not record screens. Brenda for Mac can look at a person&apos;s screen only if the organisation allows it and only when that person asks her to, with her keys or her Look button. The picture is not kept, and the organisation cannot see it or whether it was used. It is not monitoring and is not used to assess anyone&apos;s work.</p> },
          { icon: <VideoOff />, title: "No call recording", body: <p>Calls are never recorded. Sound and video pass through the video provider only to reach the people on the call.</p> },
          { icon: <Gauge />, title: "No productivity score", body: <p>Timers, heartbeats and logins are never treated as proof of work, so there is nothing to score.</p> },
          { icon: <ListOrdered />, title: "No ranking people against each other", body: <p>Reports list people with their facts, not in order of anything. A reviewer cannot approve their own submission either: the database refuses it.</p> },
        ]} />
      </Section>

      <ProductCta title="See the work, not a score"
        sub={<p>Attendance, confirmed hours and a daily report for every lead, with no screen or call recording.</p>}
        visual={<MyDayMock />} />

      <Section id="consent" label="Consent" title="Consent, in practice" align="center">
        <CardGrid columns={2} items={[
          { icon: <MessageSquareOff />, title: "Call notes: no answer counts as no", body: <p>When someone turns on Brenda&apos;s notes during a call, each person chooses Include me or Not me. Anyone who doesn&apos;t answer is left out. Only the words of people who agree are turned into text, on their own device, and no audio is sent for transcription. Everyone who joined gets the recap with its decisions and action items, and each item waits for its person to accept it. More on how <Link href="/features/call-notes">AI meeting notes with consent</Link> work.</p> },
          { icon: <History />, title: "Transcripts deleted 7 days after the recap", body: <p>Only the people on the call can read the transcript, and it is deleted 7 days after the recap. A short version of the recap goes into the call&apos;s thread.</p> },
          { icon: <Eye />, title: "What assistants can and cannot see", body: <p>Each person&apos;s assistant works for them. When a lead&apos;s Brenda asks someone else&apos;s for an update, the answer shares only facts about the work that the lead could already see: never their to-dos, day plan, documents, messages or chats. Owners and HR see a plain log of what assistants did, never what was said. Direct messages are readable only by the two people in them.</p> },
          { icon: <Database />, title: "Row-level security", body: <p>Each organisation is sealed by row-level security in the database, even from privileged code. Reports are built as the person who receives them, so they never show more than that person could see on their own pages.</p> },
        ]} />
      </Section>

      <FeatureAccordion id="instead" label="Instead" title="What you get instead of a score"
        items={[
          {
            id: "attendance", icon: <CalendarCheck />, title: "Live attendance",
            body: <p>Set the working days, a clock-in time, a clock-out time and a grace period. A late arrival is recorded by the minute, and the month view shows every person, every day. See how it works in <Link href="/features/attendance-timesheets">attendance and timesheets</Link>.</p>,
            visual: <AttendanceMock />, caption: "The attendance month view for four people, with two late arrivals and one missed day.",
          },
          {
            id: "timesheets", icon: <Timer />, title: "Timesheets that count confirmed time",
            body: <p>Timesheets count only confirmed time. A correction counts once a lead approves it, the approved version stays, and the CSV export adds up to the same totals.</p>,
            visual: <ReportsMock />, caption: "The week's confirmed hours by day.",
          },
          {
            id: "report", icon: <FileText />, title: "The end-of-day report",
            body: <p>Written by Brenda for every lead at the time you set, and saved as a private document in their Docs. Nobody has to write it, and nobody is scored in it.</p>,
            visual: <EndOfDayReportMock />, caption: "A team lead's end-of-day report: plain counts, decisions waiting first.",
          },
          {
            id: "commitments", icon: <ListChecks />, title: "Commitments that don't get lost",
            body: <p>When the workspace switches it on, Brenda notes promises made in channels and team chats and asks each person whether to add them to their to-dos. Direct messages are never tracked. All of this comes from each person&apos;s <Link href="/features/ai-assistant">AI assistant for teams</Link>, one per person.</p>,
            visual: <CommitmentMock />, caption: "Brenda notes a promise made in #Design and asks before adding it to a to-do list.",
          },
        ]}
      />

      <SplitSection id="introduce" label="Rolling it out" title="How to introduce this to your team" tone="tint"
        points={[
          { title: "What to say", body: <p>Tell people before the first day, in your own words, what is recorded and what isn&apos;t. Here is a message you can copy and adjust.</p> },
          { title: "What to promise", body: <p>Promise only what the product enforces, so the promise holds: screens and calls are never recorded, nobody gets a score, chats with Brenda are private, call notes need each person&apos;s yes, and uncertain time gets a question first.</p> },
          { title: "What to never do", body: <CheckList negative items={[
            "Never use the end-of-day report to rank people. It lists facts so you can help, not so you can sort.",
            "Never treat a gap as proof of slacking. Ask, as the product does.",
            "Never switch on commitment tracking without telling the team first.",
            "Never ask people to keep a timer running to look busy. Timers measure the task, not the person.",
          ]} /> },
        ]}
        bare visual={<CopyBlock title="Message to your team" text={SCRIPT} filename="boredroom-team-message.txt" />}
      />

      <Section id="compare" label="Compared" title="How this compares to traditional monitoring tools"
        sub={<p>Here is what three well-known tools say about themselves on their own pages, next to Boredroom. For a fuller look, read the <Link href="/compare/employee-monitoring-software">employee monitoring software comparison</Link>, or the head-to-heads: <Link href="/compare/boredroom-vs-activtrak">compare Boredroom and ActivTrak</Link>, or <Link href="/compare/boredroom-vs-time-doctor">compare Boredroom and Time Doctor</Link>.</p>}>
        <div className="mk-links">
          <ComparisonTable layout="versus" rowHeader="What is measured" label="Boredroom compared with activity-based monitoring tools"
            caption={<>Boredroom and activity-based monitoring tools, from each vendor&apos;s own pages. <AsOf date={AS_OF} /></>}
            columns={[{ key: "boredroom", label: "Boredroom", ours: true }, { key: "others", label: "Activity-based tools" }]}
            rows={[
              { label: "Keyboard and mouse activity", cells: { boredroom: { mark: "no", text: "Not measured" }, others: <><Cited source={HUBSTAFF_ACTIVITY}>Hubstaff: the share of seconds with input in each 10 minutes</Cited>; <Cited source={TIME_DOCTOR}>Time Doctor: activity levels</Cited></> } },
              { label: "Apps and websites", cells: { boredroom: { mark: "no", text: "Not tracked" }, others: <><Cited source={TIME_DOCTOR}>Time Doctor rates them productive, unproductive, neutral or unrated</Cited>; <Cited source={ACTIVTRAK}>ActivTrak tracks which ones people use</Cited></> } },
              { label: "Screenshots", cells: { boredroom: { mark: "no", text: "Never" }, others: <><Cited source={HUBSTAFF_SCREENSHOTS}>Hubstaff: optional, up to three every 10 minutes, can be blurred or turned off</Cited>; <Cited source={TIME_DOCTOR}>Time Doctor: screenshots or screen video, if enabled</Cited></> } },
              { label: "Productivity view", cells: { boredroom: { mark: "no", text: "None: plain counts" }, others: <Cited source={ACTIVTRAK}>ActivTrak: productivity through the day and historical benchmarks</Cited> } },
              { label: "Keys pressed", cells: { boredroom: { mark: "no", text: "Never recorded" }, others: <><Cited source={HUBSTAFF_ACTIVITY}>Hubstaff: no keylogging</Cited>; <Cited source={TIME_DOCTOR}>Time Doctor: actual keys not recorded</Cited></> } },
              { label: "Attendance and timesheets", cells: { boredroom: { mark: "yes", text: "Clock-ins against the schedule; confirmed timer time" }, others: <><Cited source={HUBSTAFF_SCREENSHOTS}>Hubstaff: time tracking</Cited>; <Cited source={TIME_DOCTOR}>Time Doctor: time tracking</Cited></> } },
            ]}
          />
        </div>
        <div className="mt-12 rounded-[20px] border border-border bg-fill-0 p-6 sm:p-8">
          <h3 className="text-base font-semibold text-foreground">When traditional monitoring is the right answer</h3>
          <p className="lp-text mt-2 max-w-3xl">Be honest about the cases where an activity tool fits better. If clients pay by the hour and expect screenshots as evidence, or a contract requires a record of activity on each device, Boredroom will not give you that. If you want to know which apps and licences are actually used, an app-usage tool answers it and Boredroom doesn&apos;t. If what you need is to know whether the work is done, on time and unblocked, without watching anyone, that is what Boredroom is for.</p>
        </div>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <Section id="sources" label="Sources" title="Sources" className="pt-4 sm:pt-6"
        sub={<p>Facts about other products come from their own pages, read on the date shown. Products change: check the source before you decide.</p>}>
        <div className="mk-links rounded-[20px] border border-border bg-fill-0 p-6 text-secondary sm:p-8">
          <Sources items={SOURCES} />
        </div>
      </Section>

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/compare/employee-monitoring-software", label: "Compare the tools" },
        { href: "/features/ai-assistant", label: "Brenda, an AI assistant for every person" },
        { href: "/features/attendance-timesheets", label: "Attendance and timesheets that add up" },
        { href: "/blog/remote-work-productivity-statistics", label: "Remote work productivity statistics" },
        { href: "/pricing", label: "See pricing" },
      ]} />
    </>
  );
}
