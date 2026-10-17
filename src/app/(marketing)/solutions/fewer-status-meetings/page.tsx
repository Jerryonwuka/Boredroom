import Link from "next/link";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { ProductCta, SEE_PRICING } from "@/components/marketing/product/parts";
import { CallCard, EndOfDayReportMock, HeroCluster, StandupCardMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_LINE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /solutions/fewer-status-meetings: a problem-led page (review fix, 17 October 2026: SEO analysis, Section B's starting
 * count of 3 solution pages). The problem: meetings held only to share status. The answer is built: the Workroom (who
 * is working now, on what, for how long and who is on a call, from the timers people start; owners, HR and team leads),
 * the standup each person's Brenda drafts from their work (nothing posted until they press Post; one rollup for the
 * lead), the end-of-day report, follow-ups answered from the work, and calls with consent-based notes for the
 * conversations that need one. Checked 17 October 2026 against the home page's sections (dashboard-section.tsx,
 * feature-sections.tsx), /usecases/team-leads and server/services/daily-report.ts. No statistics, nothing about other
 * products.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the solution template
 * (spec §5.2): a split hero with a drafted standup (the old caption under it), what status meetings are for, where
 * each answer lives as a table on a tinted band, the standup as four steps (the paragraph's own facts in order), the
 * meetings worth keeping beside a call on a tinted band, the call to action, the switch as three steps, the FAQ and
 * related cards. Every h2, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/solutions/fewer-status-meetings";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "How do you replace a status meeting?",
    answer: "Answer its questions from the work instead. In Boredroom the Workroom shows who is working on what, each person's Brenda drafts their standup from their own work for them to post, the lead gets one rollup, and Brenda writes the end-of-day report. Keep a call for the conversations that need one.",
  },
  {
    question: "Do people still have to write a standup update?",
    answer: "No. Their Brenda drafts it from their work under Yesterday, Today and Blocked. They read it, edit it if they like, and press Post, or skip the day. Nothing is posted until they do.",
  },
  {
    question: "Can staff see the Workroom?",
    answer: "No. The Workroom and the dashboard are for owners, HR and team leads. Staff get My Day, their own plan, timers and to-dos.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>A status meeting asks the same questions every day: who is doing what, what is finished and what is stuck.</p>}
        sub={<p>{ENTITY_SENTENCE} She answers those questions from the work, so the meetings you keep are for conversations.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={POSITIONING_POINTS}
        visual={<HeroCluster primary={<StandupCardMock />}
          caption="A standup card: Brenda has drafted Ben's update for Design from his own work. Nothing is posted until Ben presses Post; the lead's rollup reads 5 of 6 posted." />}
      />

      <Section id="what-they-are-for" label="The problem" title="What status meetings are for" width="text">
        <div className="lp-text mk-links space-y-4 text-[17px] leading-7">
          <p>Most status meetings exist to answer three questions: what did each person do, what will they do next, and what is in their way. Those answers already sit in the work, in the tasks people finished, the timers they ran and the work they sent for review. A meeting turns them back into speech, at a time that suits nobody across time zones.</p>
          <p>Moving the update into writing is the idea behind an <Link href="/blog/asynchronous-standup">asynchronous standup</Link>. Boredroom goes one step further: nobody has to write it from scratch.</p>
        </div>
      </Section>

      <Section id="where-answers-live" label="Where it lives" title="Where each answer lives instead" tone="tint"
        sub={<p>Status comes only from what people do in Boredroom. {POSITIONING_LINE}</p>}>
        <div className="mk-links">
          <ComparisonTable layout="matrix" rowHeader="The question" label="Status meeting questions and where Boredroom answers them"
            caption="The questions a status meeting asks, and where Boredroom answers them"
            columns={[{ key: "where", label: "Where the answer is" }, { key: "who", label: "Who sees it" }]}
            rows={[
              { label: "Who is working, and on what?", cells: { where: "The Workroom: who is working now, on what, for how long, and who is on a call, from the timers people start", who: "Owners, HR and team leads" } },
              { label: "What did everyone do yesterday, and what's next?", cells: { where: "The standup: each person's Brenda drafts it, they post it", who: "The team, and one rollup for the lead" } },
              { label: "What is blocked, and on whom?", cells: { where: "Blocked tasks name who they wait on; the rollup lists blockers", who: "The lead, and the person it waits on" } },
              { label: "What happened today?", cells: { where: <>The <Link href="/features/end-of-day-report">end-of-day report Brenda writes</Link></>, who: "Each team lead; the owner and HR for the whole organisation" } },
              { label: "Is that piece of work on track?", cells: { where: "Ask the person's Brenda: she answers from their work", who: "Whoever could already see that work" } },
            ]}
          />
        </div>
      </Section>

      <Section id="standup" label="The standup" title="The daily standup, without the meeting" align="center"
        sub={<p>Nothing is posted until the person presses Post.</p>}>
        <StepGrid columns={4} steps={[
          { title: "The lead switches it on", body: <p>A lead switches the standup on in the team&apos;s Standup tab and chooses the days and times.</p> },
          { title: "Brenda drafts each update", body: <p>At that time, each person&apos;s Brenda drafts their update from their real work, under Yesterday, Today and Blocked.</p> },
          { title: "Each person posts, edits or skips", body: <p>The draft is private: nothing is posted until the person presses Post, and they can edit it or skip the day.</p> },
          { title: "The lead gets one rollup", body: <p>At the rollup time the lead gets one card: who posted, the blockers they named and who each waits on, and who has no update.</p> },
        ]} />
      </Section>

      <SplitSection id="keep" label="Worth keeping" title="The meetings worth keeping" tone="tint"
        sub={<>
          <p>Not every meeting is a status meeting. A design review, a hard decision or a conversation about how someone is doing needs people talking. For those, call anyone you can message or ring the whole team from its channel, on every plan. If you want notes, Brenda takes them only for the people who say Include me, and the call is never recorded: see <Link href="/features/call-notes">AI meeting notes with consent</Link>.</p>
          <p>Between meetings, the follow-ups that used to fill them get answered from the work too. Here is how to <Link href="/solutions/stop-chasing-updates">stop chasing your team for updates</Link>.</p>
        </>}
        visual={<CallCard />}
        visualCaption="A call in #Design with Ada and Ben, 12 minutes in, with Brenda taking notes from both of them."
      />

      <ProductCta title="Keep the conversations, drop the status round"
        sub={<p>Each person&apos;s Brenda drafts their standup and writes every lead&apos;s report; calls stay for the conversations.</p>}
        visual={<EndOfDayReportMock />} />

      <Section id="switch" label="Getting started" title="Making the switch" align="center"
        sub={<p>Three steps, starting with one more week of the meeting.</p>}>
        <StepGrid columns={3} steps={[
          { title: "Keep the meeting for one more week", body: <p>Switch on the standup alongside it, and compare the rollup with what the meeting covered.</p> },
          { title: "Read the end-of-day report", body: <p>At the end of each day, open the report in your Docs and see what it already knows: decisions waiting on you first, then what changed.</p> },
          { title: "Turn the meeting into a conversation", body: <p>Once the rollup covers the status, drop the daily meeting or keep it shorter, for the things that need people talking.</p> },
        ]} />
        <p className="lp-text mk-links mx-auto mt-8 max-w-2xl text-center">The standup, the end-of-day report and calls are on every plan, with Brenda for every person and prices per workspace. <Link href="/pricing">See the plans</Link>, or read how <Link href="/usecases/team-leads">team leads run their day with Boredroom</Link>.</p>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/blog/asynchronous-standup", label: "How to run an async standup" },
        { href: "/features/end-of-day-report", label: "The end-of-day report for every lead" },
        { href: "/solutions/stop-chasing-updates", label: "Stop chasing for updates" },
        { href: "/features/call-notes", label: "Calls with consent-based notes" },
        { href: "/features/ai-assistant", label: "Brenda, the AI assistant for teams" },
      ]} />
    </>
  );
}
