import Link from "next/link";
import { ClipboardCheck, Eye, FileText, Gauge, History, Laptop, ListChecks, ListOrdered, MessageSquareReply, MonitorOff, ShieldCheck, Video, VideoOff } from "lucide-react";
import { CardGrid, LimitsGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { FeatureAccordion } from "@/components/marketing/feature-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { PricingSection, ProductCta, SEE_PRICING, TextBlock } from "@/components/marketing/product/parts";
import {
  AssistantsRow, BrendaHomePanel, CommitmentMock, EndOfDayReportMock, FollowUpMock, HeroCluster, MyDayMock, NotchMock, RecapMock, StandupCardMock,
} from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /features/ai-assistant: "AI assistant for teams" (owner request, 17 October 2026: SEO analysis; Content Plan page 10,
 * the site's main conversion page). The brief's outline (per person, what she does, how it works, what she will not do,
 * team vs one person, privacy, pricing, FAQ), its "does / never does" table, four numbered steps, the follow-up picture
 * with a text transcript, the plans and the call to action above the fold and after "What Brenda will not do".
 *
 * Every claim is built (checked 17 October 2026 against src/app/page.tsx FAIR and faq(), components/landing/
 * feature-sections.tsx, docs/design-system.md, desktop/README.md, server/services/daily-report.ts and orgs.ts
 * DEFAULT_NOTICE). The comparison with a one-person assistant describes the kind of tool, not a named product. No
 * integrations, no download link, no customer numbers: none exist.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the feature template
 * (spec §5.1): a split hero with the follow-up and a perched Brenda, "one per person" beside Brenda's home, what she does
 * as an accordion with a picture per row, the steps across the page, the limits grid and the does / never-does table on
 * a tinted band, the call to action, the comparison table, privacy cards, the live plans, the FAQ and related cards.
 * Every h2, the h3s that head content, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/features/ai-assistant";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "What is an AI assistant for teams?",
    answer: "An AI assistant for teams works inside the team's own work: its tasks, timers, messages and calls. In Boredroom every person has their own assistant, Brenda, who knows that person's day, answers colleagues' follow-ups from their real work, keeps track of what they promised and writes each lead's end-of-day report.",
  },
  {
    question: "Can an AI assistant take meeting notes without recording the call?",
    answer: "Yes. Boredroom never records calls. When someone turns on Brenda's notes, each person chooses Include me or Not me, and no answer counts as no. Only the words of people who agree are turned into text, on their own device. Everyone who joined gets the recap, and the transcript is deleted 7 days after the recap.",
  },
  {
    question: "How much does an AI assistant for teams cost?",
    answer: "Brenda comes with every Boredroom plan. Free costs nothing for 1 workspace of up to 5 people. Pro is $15 a month or $150 a year per workspace, for up to 5 workspaces of 50 people. Enterprise is $50 a month or $500 a year per workspace, with no limits. Prices are per workspace, not per person.",
  },
  {
    question: "Can my team lead read my chats with Brenda?",
    answer: "No. Only you can read your chats with her: not your lead, not the owner, not HR. They see a plain log of what assistants did, never what was said.",
  },
  {
    question: "Does Brenda act without asking?",
    answer: "Only if you choose Act without asking. Even then she asks before messaging everyone, a whole team or a channel of more than 8 people, most of what she does can be undone for 10 minutes, and anything that lands on someone else's list waits for them to accept it.",
  },
];

const FOLLOW_UP_TRANSCRIPT = <>Transcript of the picture: at 15:40, Olu&apos;s assistant, Max, asks Ben&apos;s Brenda &ldquo;Where is the landing page?&rdquo;, with the Landing page task attached. At 15:41 Ben&apos;s Brenda answers from Ben&apos;s work: &ldquo;On track: 3 of 4 sections done, due Friday.&rdquo; The answer is marked as written by AI from Ben&apos;s work.</>;

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>{ENTITY_SENTENCE}</p>}
        sub={<p>She knows each person&apos;s day, answers &ldquo;any update?&rdquo; from their real work, keeps track of what they promised and writes every lead&apos;s end-of-day report.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={POSITIONING_POINTS}
        visual={<HeroCluster primary={<FollowUpMock />} brenda="teal" pause caption={<AssistantsRow />} />}
      />

      <SplitSection id="per-person" label="Per person" title="One assistant per person, not one for the company"
        sub={<p>One assistant for the whole company has to answer everyone from the same documents, and it works for nobody in particular. Boredroom gives every person in the workspace their own assistant. Everyone names theirs and picks her colour from ten. By default she is Brenda.</p>}
        points={[
          { title: "Why per-person beats per-company", body: <p>An assistant that works for one person can be trusted by that person. Her chats, loose ends and preferences belong to them. When a lead asks what someone is working on, the answer comes from that person&apos;s own Brenda, built from their own work, and it shares only what the lead could already see. Nobody has to write a status update to feed a company bot.</p> },
          { title: "What Brenda knows about each person's day", body: <p>She works from what the person does in Boredroom: the to-dos they plan, the timer they start, the work they submit for review, their calls and their messages. Each morning she opens with what is waiting on them. Ask her to plan your day, set a reminder, start your timer or write a doc with you. Tell her how you like things done, in your own words, and she follows it. Only you see that list.</p> },
          { title: "What she never sees", body: <p>Boredroom does not record screens or calls, so there is nothing of that kind for her to read. Someone else&apos;s Brenda never shares your to-dos, your day plan, your documents, your messages or your chats with your assistant. Direct messages are never tracked for commitments. On a Mac, and only if your organisation allows it, she looks at your screen when you press her keys or her Look button, and never keeps what she sees.</p> },
        ]}
        bare visual={<BrendaHomePanel cards={3} />}
        visualCaption="Brenda's home in the browser: what is waiting on you, quick asks such as “Who's working?”, and a box to ask her anything."
      />

      <FeatureAccordion id="what-brenda-does" label="What she does" title="What Brenda does"
        sub={<p>Open a row to see it in the product.</p>}
        items={[
          {
            id: "answers", icon: <MessageSquareReply />, title: "Answers “any update?” from real work",
            body: <p>Ask yours what Ben is working on. Ben&apos;s Brenda answers from his work, and asks Ben once if his work doesn&apos;t answer it. You can also put @ before an assistant&apos;s name in a thread and it answers there. It is how leads <Link href="/solutions/stop-chasing-updates">stop chasing the team for updates</Link>.</p>,
            visual: <FollowUpMock />, caption: FOLLOW_UP_TRANSCRIPT,
          },
          {
            id: "commitments", icon: <ListChecks />, title: "Tracks commitments so they don't get lost",
            body: <p>When the workspace switches it on, Brenda notices promises made in channels and team chats (&ldquo;I&apos;ll send the deck Thursday&rdquo;) and asks the person whether to add each one to their to-dos. Nothing is added until they say yes. Your own Brenda also finds loose ends: things you promised, things asked of you and things you asked of others that never became a to-do. Only you see them.</p>,
            visual: <CommitmentMock />, caption: "Brenda notes a promise made in #Design and asks before adding it to a to-do list.",
          },
          {
            id: "report", icon: <FileText />, title: "Writes the end-of-day report",
            body: <p>Every team lead gets an <Link href="/blog/end-of-day-report">end-of-day report</Link> that nobody had to write. Brenda builds it at the time set in Settings, from what that lead is allowed to see: the decisions waiting on them, what changed since yesterday, and per person the confirmed hours, what they finished, what is in progress, anything overdue or blocked, and attendance. It is saved as a private document in their Docs. It gives plain counts, and nobody is scored. If you want to see the format first, read these <Link href="/blog/sample-end-of-day-report">sample end-of-day reports</Link>, or see everything in <Link href="/features/end-of-day-report">the automatic end-of-day report</Link>.</p>,
            visual: <EndOfDayReportMock />, caption: "A team lead's end-of-day report: decisions waiting first, then what changed since yesterday and each person's day.",
          },
          {
            id: "standup", icon: <ClipboardCheck />, title: "Drafts the daily standup",
            body: <p>She drafts the daily standup too. At the time a lead sets, each person&apos;s Brenda drafts their update from their own work, nothing is posted until they press Post, and the lead gets one rollup. It is an <Link href="/blog/asynchronous-standup">async standup without the meeting</Link>.</p>,
            visual: <StandupCardMock />, caption: "A standup update Brenda drafted from Ben's own work, waiting for him to press Post.",
          },
          {
            id: "call-notes", icon: <Video />, title: "Takes consent-based call notes",
            body: <p>Call anyone you can message, or ring the whole team from its channel. If someone turns on Brenda&apos;s notes, each person chooses Include me or Not me. Only the words of people who agree are written down, turned into text on their own device. After the call, everyone who joined gets a summary, the decisions and the action items, and each item waits for its person to accept it. Read more about <Link href="/features/call-notes">calls and AI meeting notes</Link>.</p>,
            visual: <RecapMock />, caption: "After a call, her notes list the decisions and action items, each waiting for its person.",
          },
          {
            id: "notch", icon: <Laptop />, title: "Sits in the notch on your Mac, or at the top of your screen on Windows",
            body: <p>Brenda desktop puts your timer, the morning briefing and notifications at the top of the screen, without opening a tab. Hold Option and Space (Alt and Space on Windows) and speak: your words are turned into text on your computer, and no audio leaves it. Calls ring there too, and during your quiet hours no card opens and nothing makes a sound. It links to your workspace with a code you approve in the browser, never a password.</p>,
            visual: <NotchMock />, caption: "Brenda desktop in a Mac's notch: the running timer and the morning briefing with three things waiting.",
          },
        ]}
      />

      <Section id="how-it-works" label="Getting started" title="How it works" align="center"
        sub={<p>Four steps from an empty workspace to a report nobody had to write.</p>}>
        <StepGrid columns={4} steps={[
          { title: "Step 1: everyone joins with one code", body: <p>The owner creates the workspace, makes the teams and puts a lead on each. Share one code, a link or an email invitation, and people land in the right team with the right role. Each meets their own Brenda the first time they come in.</p> },
          { title: "Step 2: Brenda learns each person's day", body: <p>People type a to-do, press Start and press Done. That is all she needs: their plan, their timers and their submissions tell her what they are working on, without a form or a status update.</p> },
          { title: "Step 3: follow-ups get answered without chasing", body: <p>Questions go to the person&apos;s assistant first. She answers from their work, passes messages and requests on, and asks the person only when their work doesn&apos;t answer it. Nothing lands on anyone&apos;s list until they accept it.</p> },
          { title: "Step 4: the end-of-day report writes itself", body: <p>At the time you set, each lead gets the day&apos;s report from Brenda, with the decisions waiting on them first. Owners and HR can get one for the whole organisation.</p> },
        ]} />
      </Section>

      <Section id="will-not" label="Her limits" title="What Brenda will not do" align="center" tone="tint"
        sub={<p>The rules are written into the product, and everyone can read them in the monitoring notice in their profile.</p>}>
        <LimitsGrid columns={4} items={[
          { icon: <Gauge />, title: "No productivity score", body: <p>Timers, heartbeats and logins are never treated as proof of work, so there is <Link href="/solutions/monitoring-without-scores">no productivity score</Link> for her to report. Uncertain time gets a question, not a penalty.</p> },
          { icon: <MonitorOff />, title: "No screen recording", body: <p>Boredroom doesn&apos;t record screens. Where your organisation allows screen help, Brenda for Mac sees your screen only when you press her keys, does something on it only when you ask and say yes, and never keeps what she sees. Your organisation cannot see it, or whether you used it.</p> },
          { icon: <VideoOff />, title: "No call recording", body: <p>Calls are never recorded. Their sound and video pass through the video provider only to reach the people on the call.</p> },
          { icon: <ListOrdered />, title: "No ranking people against each other", body: <p>Reports give plain counts. Nobody is ranked, and nothing compares one person with another.</p> },
        ]} />
        <ComparisonTable className="mt-12" layout="versus" rowHeader={null} label="What Brenda does and what she never does"
          caption="What Brenda does, and what she never does"
          columns={[{ key: "does", label: "Brenda does" }, { key: "never", label: "Brenda never does" }]}
          rows={[
            ["Answers follow-ups from a person's real work", "Shares their to-dos, day plan, documents, messages or chats"],
            ["Notes promises made in channels and team chats, when the workspace allows it", "Tracks direct messages, or adds anything without a yes"],
            ["Writes each lead's end-of-day report with plain counts", "Gives anyone a productivity score or ranks people"],
            ["Takes call notes for the people who say Include me", "Records a call, or writes down the words of anyone who said no or didn't answer"],
            ["Looks at your Mac screen when you press her keys", "Records your screen, keeps what she saw, or tells your organisation"],
            ["Asks before acting, unless you choose otherwise", "Messages everyone, a whole team or a channel of more than 8 people without asking"],
          ].map(([does, never]) => ({ cells: { does: { mark: "yes" as const, text: does }, never: { mark: "no" as const, text: never } } }))}
        />
      </Section>

      <ProductCta title="Give every person their own Brenda"
        sub={<p>Brenda comes with every plan, including Free. People type a to-do, press Start and press Done: that is all she needs.</p>}
        visual={<MyDayMock />} />

      <Section id="team-vs-one" label="Compared" title="AI assistant for teams vs an AI assistant for one person"
        sub={<p>A chat assistant that one person uses on their own is useful for writing and thinking. It works from what that person types or connects to it. A team assistant works from the team&apos;s shared record, and that changes what it can do.</p>}>
        <ComparisonTable layout="versus" label="A team assistant compared with a one-person assistant"
          caption="Brenda in Boredroom compared with a general assistant used by one person on their own"
          columns={[{ key: "brenda", label: "Brenda, one per person in a team", ours: true }, { key: "solo", label: "An assistant used by one person alone" }]}
          rows={[
            { label: "Where its answers come from", cells: { brenda: "The person's tasks, timers, submissions, calls and messages in Boredroom", solo: "What the person types or connects to it" } },
            { label: "Answers a lead's “any update?”", cells: { brenda: { mark: "yes", text: "Yes, from the person's work, sharing only what the lead could already see" }, solo: { mark: "no", text: "No: the lead still asks the person" } } },
            { label: "Passes requests between people", cells: { brenda: { mark: "yes", text: "Yes, and nothing lands on a list until its owner accepts" }, solo: { mark: "no" } } },
            { label: "Writes the lead's end-of-day report", cells: { brenda: { mark: "yes", text: "Yes, from what the lead may see" }, solo: { mark: "partial", markLabel: "Partly", text: "Only from what someone pastes in" } } },
          ]}
        />
        <TextBlock className="mt-12 border-t border-border pt-8" title="Why team context matters">
          <p>Most of a lead&apos;s questions are about other people&apos;s work: is it done, is it blocked, who is it waiting on. An assistant can only answer those from a shared record that it is allowed to read, under rules both sides know. That is why each Brenda answers from the work, within what the asker could already see, and why <Link href="/features/attendance-timesheets">attendance and timesheets</Link> live in the same place as the tasks.</p>
        </TextBlock>
      </Section>

      <Section id="privacy" label="Privacy" title="Privacy and consent" align="center" tone="tint">
        <CardGrid columns={3} items={[
          { icon: <ShieldCheck />, title: "Row-level security", body: <p>Each organisation is sealed: row-level security in the database keeps each company&apos;s data apart, even from privileged code. Reports are built as the person who receives them, so they never show more than that person&apos;s own pages would.</p> },
          { icon: <Eye />, title: "What assistants can see", body: <><p>Your assistant works for you. Owners and HR see a plain log of what assistants did, never what was said. Owners and HR can switch off what the workspace doesn&apos;t use, and you can switch off anything you don&apos;t want her to do for you.</p><p>Brenda runs on Claude: what you ask her, and what she reads to answer, is sent to Anthropic to write her reply. Only what you are allowed to see is sent. If you choose a natural voice, her words are sent to ElevenLabs to be spoken; otherwise she uses your computer&apos;s own voice.</p></> },
          { icon: <History />, title: "Transcripts deleted 7 days after the recap", body: <p>Only the people on the call can read a call&apos;s transcript, and it is deleted 7 days after the recap. A short version of the recap goes into the call&apos;s thread.</p> },
        ]} />
      </Section>

      <PricingSection link={{ href: "/pricing", label: "Every plan in full" }}>
        <CardGrid columns={2} items={[
          { title: "Free, Pro and Enterprise", body: <p>Brenda comes with every plan, including Free, and so do her notes on calls.</p> },
          { title: "Per workspace, not per person", body: <p>You pay for the workspace, and the plan sets how many people it holds. Joining someone else&apos;s workspace is always free. <Link href="/pricing">See pricing</Link> for what every plan includes, or <Link href="/compare/employee-monitoring-software">compare the alternatives</Link> before you choose.</p> },
        ]} />
      </PricingSection>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/usecases/team-leads", label: "How team leads use Brenda day to day" },
        { href: "/blog/end-of-day-report", label: "What goes in an end-of-day report" },
        { href: "/features/attendance-timesheets", label: "Remote team attendance and timesheets" },
        { href: "/solutions/monitoring-without-scores", label: "Monitoring without productivity scores" },
        { href: "/blog/asynchronous-standup", label: "How to run an async standup" },
        { href: "/compare/employee-monitoring-software", label: "Employee monitoring software, compared" },
      ]} />
    </>
  );
}
