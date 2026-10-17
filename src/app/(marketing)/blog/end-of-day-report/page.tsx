import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { CheckList, Definition, PullQuote, ScrollTable } from "@/components/marketing/blocks";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqSection } from "@/components/marketing/faq-section";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks } from "@/components/marketing/related-links";
import { PageLink, SampleReport } from "@/components/marketing/blog/parts";
import { EndOfDayReportMock } from "@/components/marketing/blog/product-mocks";
import { FollowUpMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";

/**
 * /blog/end-of-day-report: the pillar guide to end-of-day reports (owner request, 17 October 2026: SEO analysis; Content
 * Plan page 1, target keyword "end of day report"). The brief's outline, its definition box in the first 100 words, the
 * comparison table (report, standup, timesheet), an annotated example, the "what does not belong" list, a picture of
 * Boredroom's report (a coded mock: there are no screenshots) and the positioning line as a pull quote.
 *
 * Product claims are what the product does (server/services/daily-report.ts): Brenda writes the report for every team
 * lead at the time set in Settings, saves it as a private document in their Docs, decisions first, then what changed
 * since the last report, then each person's finished work, confirmed hours and attendance as plain facts. Deviation from
 * the brief: it lists "hours logged" under "does not belong"; Boredroom's report does show confirmed hours, so the page
 * says hours belong only as a plain fact from the timesheet, never as proof of effort. No numbers about others here.
 *
 * Owner feedback, 17 October 2026: pages v2. The post keeps its readable article (text, TOC, blocks) under a designed
 * header whose cover is the report Brenda writes (it was the figure at the foot of the Boredroom section), then a product
 * band (Brenda writes it for every lead, and answers "any update?" in between) and the related pages as cards.
 */
const PATH = "/blog/end-of-day-report";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "what-is", label: "What is an end-of-day report?" },
  { id: "why", label: "Why remote teams use them" },
  { id: "what-belongs", label: "What belongs in one" },
  { id: "who-and-when", label: "Who writes it, and when" },
  { id: "compared", label: "Report vs standup vs timesheet" },
  { id: "introduce", label: "Introducing it fairly" },
  { id: "mistakes", label: "Common mistakes" },
  { id: "boredroom", label: "How Boredroom handles it" },
  { id: "faq", label: "FAQ" },
];

const FAQ = [
  {
    question: "How long should an end-of-day report be?",
    answer: "Short enough to read in under a minute: usually four to eight lines. Lead with anything that needs a decision, then what changed, what is blocked and what comes next. If a section has nothing in it, say so in three words rather than filling it.",
  },
  {
    question: "Should end-of-day reports be mandatory?",
    answer: "Only if someone reads them and acts on them. A report that exists to prove people were working turns into a chore and then into a performance. Agree who reads it and what they do with it before you ask anyone to write one, and drop it if nobody does.",
  },
  {
    question: "Can an AI write an end-of-day report?",
    answer: "Yes, if it writes from real records rather than guesses. An assistant can read what was finished, sent for review, blocked and planned in the tools the team already uses, and put the decisions first. It should never infer effort from activity, and the people it describes should know what it reads.",
  },
  {
    question: "What is the difference between an end-of-day report and a daily report?",
    answer: "Mostly timing and name. A daily report can be written at any point and often covers a whole team or project. An end-of-day report is written at the close of the working day, about that day, so the reader starts tomorrow knowing what changed and what is waiting on them.",
  },
];

export default function Page() {
  return (
    <>
      <ArticleHeader path={PATH} cover={<EndOfDayReportMock />} />
      <ArticleBody toc={TOC}>
        <Definition term="An end-of-day report">
          is a short note written at the close of the working day that tells the people who depend on you what changed,
          what is blocked and on whom, what needs their decision, and what happens tomorrow. It replaces the questions a lead
          would otherwise ask one by one.
        </Definition>
        <p>
          Remote teams lose a surprising amount of time to the same small question: &ldquo;any update?&rdquo; An end-of-day report answers it
          once, in writing, before anyone has to ask. This guide covers what goes in one, what never should, who should write it,
          how it differs from a standup and a timesheet, and how to introduce it without it feeling like being watched. If you
          want to start straight away, there is a free <PageLink href="/blog/end-of-day-report-template">end-of-day report template</PageLink> you
          can copy.
        </p>

        <h2 id="what-is">What is an end-of-day report?</h2>
        <h3>The one-sentence definition</h3>
        <p>
          An end-of-day report is a written handover from today to tomorrow: what changed, what is stuck, what needs a decision and
          what comes next, in that order of urgency. Some teams call it an EOD report, a daily work report or a daily wrap-up. The
          name matters less than the job, which is to let the reader act without a meeting.
        </p>
        <h3>What an end-of-day report is not</h3>
        <p>It is easy to confuse the report with three things it sits next to:</p>
        <ul>
          <li><strong>Not a timesheet.</strong> A timesheet records hours against work, for pay, billing or planning. A report says what those hours changed.</li>
          <li><strong>Not a performance review.</strong> A review judges a person over months. A report describes a day&rsquo;s work and asks for nothing but decisions.</li>
          <li><strong>Not a status meeting.</strong> A meeting needs everyone at the same time. A report is read when the reader is ready, which is the point for a team spread across time zones.</li>
        </ul>
        <h3>Where the practice came from</h3>
        <p>
          Written handovers are older than remote work. Shift-based work has long relied on them: a nurse handing over a ward, an
          operations team handing over a site, a support desk passing the queue to the next region. The end-of-day report brings
          the same habit to knowledge work, where the &ldquo;next shift&rdquo; is often your lead, a colleague in another time zone, or
          simply you, tomorrow morning.
        </p>

        <h2 id="why">Why remote teams use end-of-day reports</h2>
        <h3>The &ldquo;any update?&rdquo; problem</h3>
        <p>
          In an office, a lead picks up most of what is happening by being in the room. Remotely, that turns into messages: &ldquo;how
          is the pricing page going?&rdquo;, &ldquo;did the client reply?&rdquo;, &ldquo;are you still blocked?&rdquo;. Each one interrupts someone, and
          each answer is scattered across a different thread. A report collects the answers in one place, once a day, so the
          questions stop.
        </p>
        <h3>Closing the timezone gap</h3>
        <p>
          When a designer in Lagos finishes as an engineer in Vancouver starts, the handover is the work. A report written at the
          end of one person&rsquo;s day is waiting at the start of the next person&rsquo;s, so nobody spends their morning waiting for a reply
          that was sent while they slept.
        </p>
        <h3>Giving leads a decision list instead of a status list</h3>
        <p>
          The most useful line in any report is the one that says &ldquo;this is waiting on you&rdquo;. Most status updates bury it under a
          list of everything that happened. Put decisions first and a lead can clear the day&rsquo;s blockers in five minutes, then read
          the rest if they have time.
        </p>
        <h3>What changes when nobody has to chase</h3>
        <p>
          The quiet benefit is trust. When updates arrive on their own, a lead no longer has to choose between asking and
          wondering, and the team no longer feels checked on. The report becomes the one place where progress is visible, which
          makes it easier to leave people alone the rest of the day.
        </p>

        <h2 id="what-belongs">What belongs in an end-of-day report</h2>
        <p>Four sections cover almost every role. Keep them in this order, because it is the order a reader acts in.</p>
        <h3>Decisions waiting on someone</h3>
        <p>
          Anything you cannot move without another person&rsquo;s answer: an approval, a choice between two options, a budget question.
          Name the person, the decision and the deadline. &ldquo;Need David to pick layout A or B by Thursday&rdquo; gets an answer;
          &ldquo;waiting on feedback&rdquo; does not.
        </p>
        <h3>What changed since yesterday</h3>
        <p>
          What you finished, sent for review, started or handed over, and anything that moved, such as a deadline. &ldquo;Changed&rdquo; is
          the right word: a reader does not need to hear about the work that is exactly where it was yesterday.
        </p>
        <h3>What is blocked, and on whom</h3>
        <p>
          A blocker without a name is a complaint. A blocker with a name and the exact thing you need is a request someone can
          fulfil: &ldquo;Pricing page copy: waiting on Chidi for the client&rsquo;s final text.&rdquo;
        </p>
        <h3>What is planned for tomorrow</h3>
        <p>
          One or two things, not a to-do list. Tomorrow&rsquo;s line tells the reader what to expect and gives you a starting point
          in the morning.
        </p>
        <h3>What does not belong (hours logged, activity counts, rankings)</h3>
        <p>This is the part most templates leave out, and the part that decides whether the report helps or harms:</p>
        <CheckList negative items={[
          <><strong>Hours as proof of effort.</strong> &ldquo;Worked 9 hours&rdquo; tells the reader nothing about what changed. If your team tracks time, the timesheet is the place for it, stated plainly, not as a defence.</>,
          <><strong>Activity counts.</strong> Keystrokes, messages sent, minutes active and apps opened measure motion, not results.</>,
          <><strong>Rankings and scores.</strong> A report that compares people becomes a competition to look busy.</>,
          <><strong>Everything you touched.</strong> If it did not change and nobody is waiting on it, leave it out.</>,
        ]} />
        <p>Here is a short report with a note on each line. You can <PageLink href="/blog/sample-end-of-day-report">see a sample end-of-day report</PageLink> for seven different roles in the companion post.</p>
        <SampleReport kind="Annotated example" title="A designer's end-of-day report" lines={[
          { text: "End-of-day report: Ada, Tuesday", note: "Who and when. No greeting needed." },
          { text: "Needs a decision: pricing layout A or B, from David, by Thursday", note: "Decision first, with the person and the deadline. This is the line David acts on." },
          { text: "Changed today: icon set finished and handed to Ben", note: "Finished work, and who has it now." },
          { text: "Changed today: onboarding illustrations moved to Monday", note: "A deadline that moved is news; say it before someone finds out." },
          { text: "Blocked: pricing page copy, waiting on Chidi for the client's text", note: "The blocker, the person and the exact thing needed." },
          { text: "Tomorrow: usability test with three customers at 14:00", note: "One line. Enough to plan around." },
        ]} />

        <h2 id="who-and-when">Who writes it, and when</h2>
        <h3>Self-written vs. assistant-written</h3>
        <p>
          Most teams start with each person writing their own. That works, but it costs everyone ten minutes at the most tired
          point of the day, and the quality drifts. The alternative is to have the report written from the records the team already
          keeps: tasks finished, work sent for review, blockers and their reasons, time confirmed. That is what
          <PageLink href="/features/ai-assistant">an AI assistant that writes the end-of-day report for you</PageLink> does, and it only works when
          it reads real work rather than guessing from activity.
        </p>
        <h3>The end-of-day window: when to send, and why timing matters</h3>
        <p>
          Pick one time and keep it. Late afternoon on the team&rsquo;s main clock works for most teams: late enough that the day&rsquo;s work
          is done, early enough that a lead can answer a decision before they log off. A report that arrives at a different time
          every day gets read at a different time every day, which is to say rarely.
        </p>
        <h3>One report per person vs. one report per lead</h3>
        <p>
          With five people, five short reports are fine. With fifteen, a lead reads fifteen notes and still has to work out what
          is waiting on them. At that size, one report per lead, gathered from everyone&rsquo;s work with the lead&rsquo;s decisions at the
          top, is easier to act on. Many teams use both: each person posts a short update, and the lead gets the summary.
        </p>

        <h2 id="compared">End-of-day report vs. daily standup vs. timesheet</h2>
        <h3>A comparison table</h3>
        <ScrollTable label="End-of-day report, daily standup and timesheet compared">
          <table>
            <caption>Three daily habits, five differences</caption>
            <thead>
              <tr><th scope="col">&nbsp;</th><th scope="col">End-of-day report</th><th scope="col">Daily standup</th><th scope="col">Timesheet</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Purpose</th><td>Hand today over to tomorrow; surface decisions</td><td>Coordinate today&rsquo;s work; spot blockers early</td><td>Record time for pay, billing or planning</td></tr>
              <tr><th scope="row">Who writes it</th><td>Each person, or an assistant for the lead</td><td>Each person, live or in writing</td><td>Each person, approved by a lead</td></tr>
              <tr><th scope="row">When</th><td>End of the working day</td><td>Start of the day</td><td>Daily or weekly</td></tr>
              <tr><th scope="row">What it contains</th><td>Decisions, changes, blockers, tomorrow</td><td>Yesterday, today, blockers</td><td>Hours against tasks or projects</td></tr>
              <tr><th scope="row">What it must never contain</th><td>Scores, rankings, activity counts</td><td>Long discussions; problem-solving belongs after</td><td>Guesses; time should be confirmed, not inferred</td></tr>
            </tbody>
          </table>
        </ScrollTable>
        <h3>When to use which</h3>
        <p>
          Use a standup when the team needs to coordinate before work starts, and an end-of-day report when the reader needs to
          act after it ends. If the team is spread across time zones, an <PageLink href="/blog/asynchronous-standup">asynchronous standup</PageLink> in
          the morning and a report at the end of the day often replace the daily call entirely. Keep the timesheet for what it
          is for: hours, not progress.
        </p>

        <h2 id="introduce">How to introduce end-of-day reports without it feeling like surveillance</h2>
        <h3>The framing that works: &ldquo;so nobody has to ask&rdquo;</h3>
        <p>
          People resist reports when they read as &ldquo;prove you were working&rdquo;. They accept them when the reason is &ldquo;so I stop
          interrupting you&rdquo;. Say the second one, and then behave like it: once reports arrive, stop sending the ad hoc check-ins
          they replace.
        </p>
        <h3>The three rules that keep it fair (no scores, no rankings, no activity inference)</h3>
        <ol>
          <li><strong>No scores.</strong> Nothing in the report turns a person into a number.</li>
          <li><strong>No rankings.</strong> The report never compares one person with another.</li>
          <li><strong>No activity inference.</strong> Effort is never guessed from mouse movement, screen time or how often someone is online. The report says what was done, not how busy someone looked.</li>
        </ol>
        <h3>What to tell the team on day one</h3>
        <p>
          Tell them who reads the report, what it is used for, and what it is not used for. Show them an example. Agree a trial,
          two weeks is enough, and ask afterwards what nobody reads so you can cut it. If you lead a team, there is more on
          this in <PageLink href="/usecases/team-leads">how team leads use Boredroom</PageLink>.
        </p>
        <PullQuote>No productivity score, no screen recording, nobody ranked.</PullQuote>

        <h2 id="mistakes">Common mistakes</h2>
        <h3>Turning the report into a productivity score</h3>
        <p>
          The moment a report feeds a score, people write for the score. Lines get longer, blockers get softer, and the one thing
          the report was for, an honest picture of the day, goes first.
        </p>
        <h3>Making it long</h3>
        <p>
          If it takes longer than a minute to read, the decisions get lost. Ask for four sections and one or two lines each. An
          empty section is fine: &ldquo;Nothing is blocked&rdquo; is useful information.
        </p>
        <h3>Making it mandatory for its own sake</h3>
        <p>
          A report nobody answers teaches people that nobody reads it. If a lead does not act on reports, either the lead or the
          format needs to change, not the people writing them.
        </p>
        <h3>Writing it for the manager instead of for the reader</h3>
        <p>
          The reader is whoever acts next: a lead, a colleague in another time zone, or you tomorrow. Write the lines they need,
          not the lines that look good.
        </p>

        <h2 id="boredroom">How Boredroom handles end-of-day reports</h2>
        <p>
          {ENTITY_SENTENCE} Nobody on the team writes the end-of-day report. Brenda does, from what was recorded in Boredroom
          that day, at the time the workspace sets.
        </p>
        <h3>Brenda writes one for every lead</h3>
        <p>
          Every team lead gets their own report about their teams, saved as a private document in their Docs, with a notification
          when it arrives. Owners and HR can receive one for the whole workspace. A lead can also ask for one during the day, and
          anyone on the team can ask their assistant to add a note to today&rsquo;s report in their own words.
        </p>
        <h3>Decisions first, then what changed</h3>
        <p>
          The report opens with what is waiting on the reader: reviews to decide, requests, time corrections and tasks blocked on
          them. Then it lists what changed since the last report, such as tasks newly blocked, unblocked, finished or running late,
          and then each person&rsquo;s day. Each line links to the task or page it came from, where there is one. The feature
          page has the details of <PageLink href="/features/end-of-day-report">Boredroom&rsquo;s automatic end-of-day report</PageLink>.
        </p>
        <h3>Plain counts, nobody ranked</h3>
        <p>
          Hours appear as they were confirmed on the timesheet, and attendance as clock-in times, as plain facts. There is no
          productivity score, no ranking and no activity tracking behind it, and Boredroom never records screens or calls. When
          you are ready to try it, <PageLink href="/pricing">see how Boredroom is priced</PageLink>: the Free plan covers a team of 5.
        </p>
        <FaqSection path={PATH} items={FAQ} />
      </ArticleBody>
      <CtaBand
        className="mt-8 sm:mt-12"
        label="In Boredroom"
        title="Brenda writes the report for every lead"
        sub={<p>Nobody on the team types it. At the time the workspace sets, Brenda writes each lead&rsquo;s report from what was recorded that day: decisions first, then what changed. In between, a person&rsquo;s Brenda answers &ldquo;any update?&rdquo; from their work, so nobody has to chase.</p>}
        actions={<PrimaryCta secondary={{ href: "/features/end-of-day-report", label: "How the automatic report works" }} />}
        visual={<FollowUpMock />}
      />
      <RelatedLinks title="Keep reading" label="Related" links={[
        { href: "/blog/end-of-day-report-template", label: "Copy the end-of-day report template" },
        { href: "/blog/sample-end-of-day-report", label: "Seven sample end-of-day reports" },
        { href: "/features/ai-assistant", label: "Brenda, the AI assistant that writes the report" },
        { href: "/blog/asynchronous-standup", label: "Run your standup without a meeting" },
        { href: "/usecases/team-leads", label: "Boredroom for team leads" },
        { href: "/pricing", label: "Boredroom pricing" },
      ]} />
    </>
  );
}
