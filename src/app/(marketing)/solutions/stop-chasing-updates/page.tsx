import Link from "next/link";
import { CircleCheck, EyeOff, Flag, Lock, MessageSquareReply, MessagesSquare, ShieldCheck, SquareCheckBig } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { FeatureAccordion } from "@/components/marketing/feature-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { ProductCta } from "@/components/marketing/product/parts";
import { BrendaHomePanel, CommitmentMock, EndOfDayReportMock, FollowUpMock, HeroCluster, MessagesDemo, StandupCardMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /solutions/stop-chasing-updates: a problem-led page (review fix, 17 October 2026: SEO analysis, Section B's starting
 * count of 3 solution pages). The problem: a lead's day goes on "any update?". The answer is built: each person's
 * assistant answers follow-ups from their work within what the asker could already see, and asks the person once when
 * the work doesn't say; "Ask for an update" opens a thread with the task attached; a blocked task names who it waits
 * on; commitments made in channels are noted with the person's yes; the standup and the end-of-day report. Checked
 * 17 October 2026 against the home page's sections and faq(), /features/ai-assistant and /usecases/team-leads (both
 * checked against the services the same day). No statistics, so no sources are needed; nothing about other products.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the solution template
 * (spec §5.2): a split hero with a follow-up answered from the work (its transcript under it), why leads chase on a
 * tinted band, how the work answers as an accordion (Brenda's home, the messages with the task attached, the report
 * with what is blocked on the lead), promises beside the commitment card, the rules as cards with the chasing vs asking
 * table on a tinted band, the call to action, the steps, the FAQ and related cards. Every h2, every h3 that heads
 * content, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/solutions/stop-chasing-updates";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "How do I stop chasing my team for updates?",
    answer: "Make the answer available without asking the person. In Boredroom, each person's assistant, Brenda, answers “any update?” from their tasks, timers and submissions, and asks them only when the work doesn't say. Add a standup drafted from their work and an end-of-day report, and most follow-ups never need sending.",
  },
  {
    question: "What does someone else's assistant share about me?",
    answer: "Only facts about your work that the person asking could already see. It never shares your to-dos, your day plan, your documents, your messages or your chats with your assistant. When your work doesn't answer the question, it asks you.",
  },
  {
    question: "Does this mean more monitoring?",
    answer: "No. The answers come from the work people already do in Boredroom: the tasks they plan, the timers they start and the work they submit. There is no screen recording, no call recording and no productivity score.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>&ldquo;Any update?&rdquo;, &ldquo;Is it done yet?&rdquo;, &ldquo;What are you waiting on?&rdquo;. Most of these questions already have an answer somewhere in the work.</p>}
        sub={<p>{ENTITY_SENTENCE} Hers answer from that work, so leads stop chasing and people stop being chased.</p>}
        actions={<PrimaryCta secondary={{ href: "/features/ai-assistant", label: "Meet Brenda" }} />}
        points={POSITIONING_POINTS}
        visual={<HeroCluster primary={<FollowUpMock />}
          caption={<>Transcript of the picture: at 15:40, Olu&apos;s assistant, Max, asks Ben&apos;s Brenda &ldquo;Where is the landing page?&rdquo;, with the task attached. At 15:41 Ben&apos;s Brenda answers from Ben&apos;s work: &ldquo;On track: 3 of 4 sections done, due Friday.&rdquo;</>} />}
      />

      <Section id="why" label="The problem" title="Why leads end up chasing people" width="text" tone="tint">
        <div className="lp-text mk-links space-y-4 text-[17px] leading-7">
          <p>On a remote team you can&apos;t see who is stuck from across the room. The facts exist, in a task, a draft or a half-finished timer, but the lead can&apos;t read them, so they ask. Every ask interrupts someone, and every answer is retyped from work that already says it.</p>
          <p>Watching people harder doesn&apos;t fix it. A screenshot shows a window, not whether the deck is finished or who it is waiting on. The fix is to let the work itself answer, under rules the person can trust.</p>
        </div>
      </Section>

      <FeatureAccordion id="how" label="How it works" title="How the work answers instead"
        items={[
          {
            id: "assistant", icon: <MessageSquareReply />, title: "Ask the person's assistant, not the person",
            body: <p>Ask your Brenda what Ben is working on. Ben&apos;s Brenda answers from his tasks, timers and submissions, sharing only what you could already see, and asks Ben once if his work doesn&apos;t answer it. In a thread, put @ before an assistant&apos;s name and it answers there.</p>,
            visual: <BrendaHomePanel cards={0} />, bare: true, caption: "Brenda's home for a lead: quick asks such as “Who's working?”, and a box to ask her anything.",
          },
          {
            id: "ask-for-update", icon: <SquareCheckBig />, title: "Ask for an update with the task attached",
            body: <p>&ldquo;Ask for an update&rdquo; on a task opens a thread with the task attached and the question ready, so nobody has to work out which piece of work you mean.</p>,
            visual: <MessagesDemo />, caption: "Messages with the task attached. The threads can be opened.",
          },
          {
            id: "blocked", icon: <Flag />, title: "Blocked work names who it waits on",
            body: <p>A task marked blocked names who it is waiting on, and their assistant brings them the question. In the lead&apos;s <Link href="/features/end-of-day-report">end-of-day report</Link>, anything blocked on the lead comes first.</p>,
            visual: <EndOfDayReportMock />, caption: "A lead's end-of-day report: “Chidi is blocked on you” sits under Decisions for you, first.",
          },
        ]}
      />

      <SplitSection id="promises" label="Promises" title="Promises that don't get lost in the chat"
        sub={<p>Half of chasing is about things someone said they would do. When the workspace switches it on, Brenda notices promises made in channels and team chats, such as &ldquo;I&apos;ll send the deck Thursday&rdquo;, and asks the person whether to add each one to their to-dos. Nothing is added until they say yes. Action items from <Link href="/features/call-notes">AI meeting notes on calls</Link> wait for their person the same way.</p>}
        visual={<CommitmentMock />}
        visualCaption="Brenda notes Ada's promise in #Design to send the deck on Thursday, and asks Ada before adding it to her to-dos."
      />

      <Section id="rules" label="The rules" title="The rules that make it fair" align="center" tone="tint"
        sub={<p>An assistant that answers for someone only works if that person can trust it. These rules are written into the product:</p>}>
        <CardGrid columns={3} items={[
          { icon: <EyeOff />, title: "Only what you could already see", body: "Answers share only what the person asking could already see." },
          { icon: <Lock />, title: "Private things stay private", body: "To-dos, day plans, documents, messages and chats with Brenda are never shared." },
          { icon: <MessagesSquare />, title: "Direct messages stay out", body: "Direct messages are never tracked for commitments." },
          { icon: <CircleCheck />, title: "Nothing without a yes", body: "Nothing lands on anyone's list until they accept it." },
          { icon: <ShieldCheck />, title: "No score, no recording", body: "No productivity score, no screen recording and no call recording." },
        ]} />
        <p className="lp-text mk-links mx-auto mt-8 max-w-2xl text-center">That is the same line Boredroom draws everywhere: see <Link href="/solutions/monitoring-without-scores">employee monitoring without productivity scores</Link>.</p>
        <ComparisonTable className="mt-12" layout="matrix" rowHeader="Question" label="Chasing compared with asking the work"
          caption="The same question, chased or answered from the work"
          columns={[{ key: "chasing", label: "Chasing" }, { key: "boredroom", label: "In Boredroom", ours: true }]}
          rows={[
            { label: "Is it done yet?", cells: { chasing: "A message, then a wait", boredroom: "The person's Brenda answers from the task" } },
            { label: "What are you waiting on?", cells: { chasing: "A conversation to find out", boredroom: "The blocked task names who it waits on" } },
            { label: "Did you send the deck?", cells: { chasing: "Scrolling back through the chat", boredroom: "The promise became a to-do when they said yes" } },
            { label: "What happened today?", cells: { chasing: "Asking everyone at 17:30", boredroom: "The end-of-day report, written for the lead" } },
          ]}
        />
      </Section>

      <ProductCta title="Let the work answer “any update?”"
        sub={<p>Brenda for every person, a standup drafted from their work and a report for every lead.</p>}
        visual={<StandupCardMock />} />

      <Section id="setup" label="Getting started" title="Getting started" align="center"
        sub={<p>Three steps from an empty workspace to answers that come from the work.</p>}>
        <StepGrid columns={3} steps={[
          { title: "Bring the team in with one code", body: <p>The owner creates the workspace and the teams, puts a lead on each, and shares one code, a link or an email invitation. Everyone meets their own Brenda.</p> },
          { title: "Work in tasks and timers", body: <p>People type a to-do, press Start and press Done. That is all their Brenda needs to answer for them.</p> },
          { title: "Switch on the standup", body: <p>Leads choose the days and times, and each person&apos;s Brenda drafts their update for them to post. If status meetings are the bigger cost, see how to <Link href="/solutions/fewer-status-meetings">replace status meetings</Link>.</p> },
        ]} />
        <p className="lp-text mk-links mx-auto mt-8 max-w-2xl text-center">Brenda comes with every plan, priced per workspace rather than per person. <Link href="/pricing">See the plans</Link>, or follow <Link href="/usecases/team-leads">a team lead&apos;s day without chasing</Link>.</p>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/usecases/team-leads", label: "Boredroom for team leads" },
        { href: "/features/ai-assistant", label: "One AI assistant for every person" },
        { href: "/blog/asynchronous-standup", label: "Async standups, explained" },
        { href: "/features/end-of-day-report", label: "The automatic end-of-day report" },
        { href: "/solutions/fewer-status-meetings", label: "Fewer status meetings" },
      ]} />
    </>
  );
}
