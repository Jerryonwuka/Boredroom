import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { CheckList, Definition, ScrollTable, Sources, Steps } from "@/components/marketing/blocks";
import { CopyBlock } from "@/components/marketing/copy-block";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqSection } from "@/components/marketing/faq-section";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Cite, PageLink } from "@/components/marketing/blog/parts";
import { EndOfDayReportMock, StandupCardMock } from "@/components/marketing/blog/product-mocks";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";

/**
 * /blog/asynchronous-standup: how to run a daily standup without a meeting (owner request, 17 October 2026: SEO
 * analysis; Content Plan page 4, target keywords "asynchronous standup" and "daily standup software"). The brief's
 * outline: the sync/async comparison table, three copyable templates, the "use async if / stay synchronous if" decision
 * table, an honest failure-mode section (including surveillance), a tool checklist that names no competitor, and a
 * picture of Boredroom's standup card (a coded mock: there are no screenshots).
 *
 * Product claims follow the built standup (lib/standup.ts, server/services/standup.ts; owner decisions, 8–9 October
 * 2026: option B): off until a lead, the owner or HR switches it on for a team; at the post time (09:30 by default,
 * weekdays, the workspace's clock) each person's own assistant drafts their update from their real work under
 * Yesterday, Today and Blocked; nothing is posted until the person presses Post (or they edit it or skip the day); at
 * the cutoff (12:00 by default) the lead gets one rollup: who posted, the blockers named and on whom, and who has no
 * update, in one neutral list; nobody is chased. Others' facts: the Scrum Guide and Microsoft's Work Trend Index, read
 * on 17 October 2026 and cited on the page.
 *
 * Owner feedback, 17 October 2026: pages v2. A designed header whose cover is Boredroom's standup card (the figure that
 * sat in "How Boredroom's standup works"), the readable article unchanged, then a product band pairing the morning
 * standup with the end-of-day report (the article's own advice: async standup in the morning, report at the end of the
 * day) and the related cards.
 */
const PATH = "/blog/asynchronous-standup";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "what-is", label: "What is an asynchronous standup?" },
  { id: "when", label: "When async works, and when it doesn't" },
  { id: "questions", label: "The questions, rewritten" },
  { id: "setup", label: "Step-by-step setup" },
  { id: "templates", label: "Templates and examples" },
  { id: "failure-modes", label: "Common failure modes" },
  { id: "tools", label: "What to look for in a tool" },
  { id: "faq", label: "FAQ" },
  { id: "sources", label: "Sources" },
];

const FAQ = [
  {
    question: "Is an async standup better than a daily standup?",
    answer: "It depends on the team. Async is better for teams across several time zones or with long stretches of focused work, because nobody has to stop at the same moment. A live standup is better when people need to unblock each other in real time. Many teams post updates in writing and keep a short call once or twice a week.",
  },
  {
    question: "How do you keep an async standup from becoming a status report?",
    answer: "Keep it short, fixed to three or four questions, and make someone responsible for acting on the blockers by a set time. Ask for changes and blockers rather than everything someone did. If nobody responds to what people post, the format is the problem, not the people.",
  },
  {
    question: "What is the best tool for an async standup?",
    answer: "One that drafts from the work people already record, lets each person approve what is posted, collects blockers with who they wait on, and gives the lead one summary instead of a channel to read. It should never score answers or rank people. Plain chat works for small teams.",
  },
];

const MINIMAL = `Yesterday: [what changed]
Today: [the one or two things you will do]
Blocked: [what, and who it waits on] (or: nothing)
Need: [a decision or answer, from whom, by when] (or: nothing)`;

const ENGINEERING = `Since yesterday:
- Merged: [change, with link]
- In review: [change], with [reviewer]

Today:
- [Ticket or task], aiming to [finish / open for review]

Blocked:
- [What], waiting on [name] for [the exact thing]

Need:
- [Decision], from [name], by [time]`;

const CROSS_FUNCTIONAL = `Team: [your team]   Day: [day]

Done or moved since yesterday:
- [Outcome], [who it helps or who has it now]

Today's priority:
- [One thing], because [why it matters to another team]

Blocked, and on whom:
- [What]: waiting on [name, team] for [the exact thing]

Other teams should know:
- [A change that affects them: a date, a decision, a release]`;

export default function Page() {
  return (
    <>
      <ArticleHeader path={PATH} cover={<StandupCardMock />} />
      <ArticleBody toc={TOC}>
        <Definition term="An asynchronous standup">
          is a daily standup held in writing instead of on a call: each person posts a short update by a set time, answering
          the same few questions, and the team reads and responds when it suits them. It keeps the standup&rsquo;s purpose, spotting
          blockers early, without making everyone stop at the same moment.
        </Definition>
        <p>
          This guide explains when an async standup works and when it does not, how to rewrite the classic questions for
          writing, how to set one up in five steps, three templates to copy, the ways it usually fails, and what to look for in
          daily standup software if you want help running it.
        </p>

        <h2 id="what-is">What is an asynchronous standup?</h2>
        <h3>The definition</h3>
        <p>
          An async standup replaces the daily call with a written check-in. Everyone answers the same short set of questions in
          a shared place, usually a team channel or a dedicated tool, inside a window such as &ldquo;by 11:00&rdquo;. Someone, normally the
          team lead, reads the answers and acts on the blockers.
        </p>
        <h3>How it differs from a synchronous standup</h3>
        <ScrollTable label="Synchronous and asynchronous standups compared">
          <table>
            <caption>Live standup and async standup, side by side</caption>
            <thead><tr><th scope="col">&nbsp;</th><th scope="col">Synchronous standup</th><th scope="col">Asynchronous standup</th></tr></thead>
            <tbody>
              <tr><th scope="row">Time cost</th><td>Everyone&rsquo;s time at once, plus the break in focus around it</td><td>A few minutes each, when it suits them</td></tr>
              <tr><th scope="row">Timezone fit</th><td>Hard beyond two or three time zones; someone is always early or late</td><td>Works across any spread, with a window instead of a time</td></tr>
              <tr><th scope="row">Who benefits</th><td>Teams that unblock each other in conversation</td><td>Distributed teams and people doing long, focused work</td></tr>
              <tr><th scope="row">Failure mode</th><td>Runs long; turns into problem-solving for two people while the rest wait</td><td>Turns into a status report nobody reads, or quietly stops</td></tr>
              <tr><th scope="row">Record</th><td>Nothing written unless someone takes notes</td><td>A written record of every update and blocker</td></tr>
            </tbody>
          </table>
        </ScrollTable>
        <h3>Why the format exists</h3>
        <p>
          The daily standup comes from Scrum, where the Daily Scrum is a 15-minute event for the people doing the work. The
          current <Cite href="https://scrumguides.org/scrum-guide.html">Scrum Guide</Cite> (November 2020) sets its purpose as
          inspecting progress towards the sprint goal and leaves the structure to the team: the famous three questions are a
          habit, not a rule. That freedom is what makes a written version legitimate. When a team spans continents, a meeting at
          one time is a cost the format never required.
        </p>

        <h2 id="when">When async standups work, and when they don&rsquo;t</h2>
        <h3>Good fit: distributed teams, deep-work cultures, 3+ timezones</h3>
        <p>
          Async works best when finding a meeting time is already hard. That is common: in Microsoft&rsquo;s telemetry, about 30% of
          meetings span more than one time zone, up 8 percentage points since 2021 (<Cite href="https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday">Work
          Trend Index, June 2025</Cite>). It also suits teams where a morning call breaks the best hours of focus.
        </p>
        <h3>Bad fit: teams that need real-time unblocking</h3>
        <p>
          If people block each other many times a day, such as during an incident, a launch week or early in a project, waiting
          for a written answer costs more than a call. New teams also gain from hearing each other before they rely on writing.
        </p>
        <h3>The hybrid model most teams actually land on</h3>
        <p>Written updates every day, and a short live call once or twice a week for the things writing does badly: tone, disagreement and getting to know each other.</p>
        <ScrollTable label="When to use an async standup and when to stay synchronous">
          <table>
            <caption>A quick decision table</caption>
            <thead><tr><th scope="col">Use async if…</th><th scope="col">Stay synchronous if…</th></tr></thead>
            <tbody>
              <tr><td>The team spans three or more time zones</td><td>Everyone shares working hours and a call is cheap</td></tr>
              <tr><td>Most work is long, focused stretches</td><td>Work is tightly coupled and changes by the hour</td></tr>
              <tr><td>The call regularly runs past 15 minutes</td><td>The team is new and still learning how to work together</td></tr>
              <tr><td>People already write clearly in the team channel</td><td>You are in an incident or a launch week</td></tr>
              <tr><td>The lead wants a written record of blockers</td><td>Blockers are usually solved in the conversation itself</td></tr>
            </tbody>
          </table>
        </ScrollTable>

        <h2 id="questions">The three questions, and why they need rewriting for async</h2>
        <h3>What did you do yesterday?</h3>
        <p>
          In a call this invites a tour of the day. In writing it becomes a list of activity nobody reads. Ask instead: <strong>what
          changed since yesterday?</strong> Finished, sent for review, handed over, moved. Work that is where it was can be left out.
        </p>
        <h3>What will you do today?</h3>
        <p>
          Keep it to one or two things. A full plan for the day goes stale by lunchtime; the priority is what other people plan
          around.
        </p>
        <h3>Is anything blocked?</h3>
        <p>
          The most important question, and the one that suffers most in writing. &ldquo;Waiting on some feedback&rdquo; is easy to post
          and impossible to act on. Ask for <strong>what is blocked and on whom</strong>, with the exact thing needed.
        </p>
        <h3>The fourth question async standups need</h3>
        <p>
          <strong>What do you need from someone, and by when?</strong> In a live standup, a question gets asked out loud. In writing it
          needs its own line, or it waits until tomorrow. This is the same &ldquo;decisions first&rdquo; idea at the heart of a good <PageLink href="/blog/end-of-day-report">end-of-day
          report</PageLink>, which is the standup&rsquo;s natural partner at the other end of the day.
        </p>

        <h2 id="setup">How to run an async standup: a step-by-step setup</h2>
        <Steps headings items={[
          { id: "step-1", title: "Step 1: pick the channel and the window", body: <p>One place for updates, such as a team channel or a dedicated tool, and a window everyone can meet in their own morning, for example &ldquo;posted by 11:00 on the team&rsquo;s main clock&rdquo;.</p> },
          { id: "step-2", title: "Step 2: set the deadline and the consequence", body: <p>Say what happens at the deadline: the lead reads everything and answers the blockers. The consequence is that blockers get handled, not that latecomers get chased.</p> },
          { id: "step-3", title: "Step 3: define what “blocked” means", body: <p>Agree that a blocker names a person and a thing. &ldquo;Slow builds&rdquo; is a complaint; &ldquo;waiting on Ben for staging access&rdquo; is a blocker.</p> },
          { id: "step-4", title: "Step 4: decide who reads it", body: <p>Name the person who reads every update and responds to the blockers by a set time. Without that, writing a standup feels like talking to an empty room.</p> },
          { id: "step-5", title: "Step 5: review after two weeks", body: <p>Ask what people read and what they skipped, which blockers got solved and which did not. Cut questions nobody uses, and add a live call back if something is missing.</p> },
        ]} />

        <h2 id="templates">Async standup templates and examples</h2>
        <h3>The minimal template</h3>
        <CopyBlock title="Minimal async standup template" text={MINIMAL} />
        <h3>The engineering template</h3>
        <CopyBlock title="Engineering async standup template" text={ENGINEERING} />
        <h3>The cross-functional template</h3>
        <CopyBlock title="Cross-functional async standup template" text={CROSS_FUNCTIONAL} />

        <h2 id="failure-modes">Common failure modes</h2>
        <h3>The standup that becomes a status report nobody reads</h3>
        <p>
          Updates grow longer, nobody responds, and people start writing for the record rather than for each other. The fix is
          a reader who acts and a format short enough to read in a minute.
        </p>
        <h3>The standup that becomes a second meeting</h3>
        <p>
          Threads under every update turn into long discussions. Move anything that needs more than two replies into its own
          conversation or a short call, and keep the standup for the updates. If the goal is fewer meetings overall, see how
          to <PageLink href="/solutions/fewer-status-meetings">replace status meetings with async updates</PageLink>.
        </p>
        <h3>The standup that becomes a surveillance tool</h3>
        <p>
          This is the failure that does the most damage. It starts when the standup is used to check who posted on time, who
          wrote the least, or who seemed busy, and it ends with people writing to protect themselves. A standup should show
          blockers so they can be cleared. It should never feed a score, a ranking or a record of who was slow to post. If someone
          has no update, that is a conversation, not a data point. There is more on why activity-based measurement backfires in
          our <PageLink href="/blog/remote-work-productivity-statistics">remote work productivity statistics</PageLink>.
        </p>
        <h3>The standup that quietly dies</h3>
        <p>
          A few people stop posting, then a few more, and after a month the channel is empty. It nearly always means the updates
          were not used. Revive it by acting on what is posted, or end it on purpose and replace it with something that fits.
        </p>

        <h2 id="tools">Async standup tools: what to look for</h2>
        <h3>The four requirements</h3>
        <CheckList items={[
          <><strong>It drafts from real work.</strong> The update starts from what people already recorded (tasks finished, sent for review, blocked) so nobody retypes their day.</>,
          <><strong>The person approves what is posted.</strong> Nothing goes out in someone&rsquo;s name without their say, and they can edit or skip.</>,
          <><strong>Blockers carry a name.</strong> Each blocker says who it waits on, and that person hears about it.</>,
          <><strong>The lead gets one summary.</strong> One rollup at the deadline, not a channel to scroll.</>,
        ]} />
        <h3>What to avoid</h3>
        <CheckList negative items={[
          "Scores, streaks or leaderboards for posting",
          "Automatic reminders that chase people again and again",
          "Inferring effort from activity, screen time or how often someone is online",
          "Drafts that managers can read before the person has approved them",
        ]} />
        <h3>How Boredroom&rsquo;s standup works</h3>
        <p>
          {ENTITY_SENTENCE} Standup is off until a team lead, the owner or HR switches it on for a team. Then, each weekday at the time they
          set, every person&rsquo;s own assistant drafts their update from their real work, under Yesterday, Today and Blocked. The
          draft is private. Nothing is posted until the person presses Post; they can edit it or skip the day. At the cutoff the
          lead gets one rollup: who posted, the blockers they named and who each waits on, and who has no update, in one neutral
          list. Nobody is chased, and a blocker that names the lead also appears in their end-of-day report. It is part of
          the <PageLink href="/features/ai-assistant">AI assistant for teams</PageLink> every person gets, alongside <PageLink href="/features/attendance-timesheets">attendance
          and timesheets</PageLink> that keep hours out of the standup altogether.
        </p>
        <p>
          If you lead a team, see <PageLink href="/usecases/team-leads">how team leads use Boredroom</PageLink> day to day,
          or <PageLink href="/pricing">see the plans</PageLink>: the AI assistant, standup included, is on every plan, including Free.
        </p>

        <FaqSection path={PATH} items={FAQ} />

        <h2 id="sources">Sources</h2>
        <Sources items={[
          { title: "The 2020 Scrum Guide", publisher: "Ken Schwaber and Jeff Sutherland, scrumguides.org", url: "https://scrumguides.org/scrum-guide.html", asOf: "2026-10-17", published: "November 2020" },
          { title: "Breaking down the infinite workday (Work Trend Index special report)", publisher: "Microsoft WorkLab", url: "https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday", asOf: "2026-10-17", published: "17 June 2025", note: "Microsoft 365 telemetry to 15 February 2025." },
        ]} />
      </ArticleBody>
      <CtaBand
        className="mt-8 sm:mt-12"
        label="In Boredroom"
        title="The standup in the morning, the report at the end of the day"
        sub={<p>Brenda drafts each person&rsquo;s standup from their own work and posts nothing until they press Post. At the end of the day she writes each lead&rsquo;s report, decisions first, and a blocker that names the lead is in it.</p>}
        actions={<PrimaryCta secondary={{ href: "/solutions/fewer-status-meetings", label: "Fewer status meetings" }} />}
        visual={<EndOfDayReportMock />}
      />
      <RelatedLinks title="Keep reading" label="Related" links={[
        { href: "/blog/end-of-day-report", label: "The end-of-day report, the standup's partner" },
        { href: "/features/ai-assistant", label: "Brenda, an AI assistant for every person" },
        { href: "/blog/remote-work-productivity-statistics", label: "What the research says about remote work" },
        { href: "/features/attendance-timesheets", label: "Remote team attendance and timesheets" },
        { href: "/usecases/team-leads", label: "Boredroom for team leads" },
        { href: "/pricing", label: "Pricing" },
      ]} />
    </>
  );
}
