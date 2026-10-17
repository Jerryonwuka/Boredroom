import Link from "next/link";
import { CalendarCheck, ClipboardCheck, FileText, Inbox, ListChecks, MessageSquareReply, Moon, Sunrise } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { FeatureAccordion } from "@/components/marketing/feature-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { StepGrid } from "@/components/marketing/step-grid";
import { ProductCta, SEE_PRICING } from "@/components/marketing/product/parts";
import {
  BrendaHomePanel, CommitmentMock, EndOfDayReportMock, FollowUpMock, NotchMock, ReportsMock, StandupCardMock, TimesheetCorrectionMock,
} from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /usecases/team-leads (owner request, 17 October 2026: SEO analysis; the use-case page the build spec adds, D14). Not in
 * the Content Plan, so the outline follows a lead's day with the features a lead actually has: the morning opener, the
 * standup rollup, follow-ups answered by people's assistants, reviews of work and time corrections, the end-of-day report,
 * and what a lead can and cannot see. Checked 17 October 2026 against components/landing/*, docs/design-system.md
 * (standup, commitments, personal assistants), server/services/daily-report.ts, reports.ts, attendance.ts and brenda.ts
 * (the report's default time, 18:00, set by owners and HR in Settings).
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the use-case template
 * (spec §5.3): a split hero with a lead's Brenda home, what changes as five cards on a tinted band, a lead's day as an
 * accordion with a picture per moment, what a lead can and can't see as a table on a tinted band, the call to action,
 * the setup steps, the FAQ and related cards. Every h2, every h3 that heads content, every link and its words are kept;
 * the TOC is gone (V11).
 */
const PATH = "/usecases/team-leads";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "Does Boredroom replace the daily standup meeting?",
    answer: "It can. When a lead switches on the standup for a team, each person's Brenda drafts their update from their own work at the time the lead sets. Nothing is posted until the person presses Post, and the lead gets one rollup with who posted and who is blocked. Keep a call for the conversations that need one.",
  },
  {
    question: "Will my team feel monitored?",
    answer: "Boredroom records the tasks people plan, the timers they start, the work they submit and their clock-ins. It doesn't record screens or calls, and it gives nobody a productivity score. Everyone can read the monitoring notice in their profile, and only they can read their chats with Brenda.",
  },
  {
    question: "Can I get the team report before the end of the day?",
    answer: "Yes. Ask Brenda for it, or use the button in Settings. That report lands only on you, and it is refreshed each time you ask until you edit it. The end-of-day run refreshes it a last time and sends it.",
  },
];

/** A row of the can / can't table: a "yes" fact and a "no" fact. */
const seeRow = (can: string, cannot: string) => ({ cells: { can: { mark: "yes" as const, text: can }, cannot: { mark: "no" as const, text: cannot } } });

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>You lead a remote team. Your day goes on asking people for updates, checking who is in and writing up what happened.</p>}
        sub={<p>{ENTITY_SENTENCE} Here is how a team lead&apos;s day works with her, without chasing anyone.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={POSITIONING_POINTS}
        visual={<BrendaHomePanel cards={0} />}
      />

      <Section id="what-changes" label="What changes" title="What changes for a team lead" align="center" tone="tint"
        sub={<><p>The questions you stop sending are the ones whose answers already exist in the work: &ldquo;Any update on the homepage?&rdquo;, &ldquo;Is it done yet?&rdquo;, &ldquo;What are you waiting on?&rdquo;, &ldquo;Did anyone start the audit?&rdquo;. In Boredroom each person&apos;s own assistant answers those from their tasks, timers and submissions, and asks the person only when their work doesn&apos;t say.</p><p>What you get instead of the chasing:</p></>}>
        <CardGrid columns={3} items={[
          { icon: <MessageSquareReply />, title: "Follow-ups answered", body: "Answers to follow-ups from real work, within what you could already see" },
          { icon: <ClipboardCheck />, title: "One rollup", body: "One standup rollup a day, drafted by each person's Brenda and posted by them" },
          { icon: <Inbox />, title: "Reviews in one place", body: "Reviews of submitted work and time corrections, in one place" },
          { icon: <CalendarCheck />, title: "Attendance", body: "Today's attendance and the month view for your teams" },
          { icon: <FileText />, title: "The report", body: "An end-of-day report that nobody had to write" },
        ]} />
      </Section>

      <FeatureAccordion id="a-day" label="A lead's day" title="A day as a team lead with Boredroom"
        sub={<p>From the morning opener to the evening report. Open a moment to see it.</p>}
        items={[
          {
            id: "morning", icon: <Sunrise />, title: "Morning: what is waiting on you",
            body: <p>Your Brenda opens the day with what is waiting on you: work and time corrections to review, requests and questions from other people&apos;s assistants, answers to the follow-ups you sent, and your own tasks due today or overdue. The attendance board shows who has clocked in, who is late and who hasn&apos;t started.</p>,
            visual: <NotchMock />, caption: "Brenda desktop in a Mac's notch: the running timer and the morning briefing with three things waiting.",
          },
          {
            id: "standup", icon: <ClipboardCheck />, title: "Mid-morning: the standup rollup",
            body: <p>Switch on the standup in your team&apos;s Standup tab and choose the days and times. Each person&apos;s Brenda drafts their update (yesterday, today, blocked) from their own work, and nothing is posted until they press Post. At the rollup time you get one card: how many posted, what they said, and who is blocked on whom. If you are new to the idea, read <Link href="/blog/asynchronous-standup">how an asynchronous standup works</Link>, or how it helps <Link href="/solutions/fewer-status-meetings">replace status meetings</Link>.</p>,
            visual: <StandupCardMock />, caption: "Ben's update, drafted by his Brenda from his own work; the lead's rollup reads 5 of 6 posted.",
          },
          {
            id: "follow-ups", icon: <MessageSquareReply />, title: "During the day: follow-ups without chasing",
            body: <p>Ask your Brenda what someone is working on, and their Brenda answers from their work. &ldquo;Ask for an update&rdquo; on a task opens a thread with the task attached and the question ready. A task marked blocked names who it waits on, and their assistant brings them the question. That is how you <Link href="/solutions/stop-chasing-updates">stop chasing your team for updates</Link>.</p>,
            visual: <FollowUpMock />,
            caption: <>Transcript of the picture: Olu&apos;s assistant, Max, asks Ben&apos;s Brenda &ldquo;Where is the landing page?&rdquo; at 15:40, with the task attached. A minute later Ben&apos;s Brenda answers from Ben&apos;s work: &ldquo;On track: 3 of 4 sections done, due Friday.&rdquo;</>,
          },
          {
            id: "reviews", icon: <Inbox />, title: "Reviews: submitted work and time corrections",
            body: <p>When someone presses Done on a task you review, the work comes to you. Time corrections come to you too: a person proposes the time they want counted on their own task, with a reason, and it counts only once you approve it. Rejecting needs a reason. You can never approve your own records, and owners and HR can see reviews but leave the decision to you. See <Link href="/features/attendance-timesheets">how attendance and timesheets work</Link>.</p>,
            visual: <TimesheetCorrectionMock />, caption: "Ada's correction for 25 uncertain minutes, waiting for her team lead to approve or reject it.",
          },
          {
            id: "commitments", icon: <ListChecks />, title: "Commitments you can rely on",
            body: <p>When the workspace switches it on, Brenda notes promises made in channels and team chats and asks each person whether to add them to their to-dos. You see the ones they accepted, and the open ones past their due date.</p>,
            visual: <CommitmentMock />, caption: "Brenda notes Ada's promise in #Design to send the deck on Thursday, and asks Ada before adding it to her to-dos.",
          },
          {
            id: "evening", icon: <Moon />, title: "Evening: the end-of-day report",
            body: <p>At the time set in Settings (18:00 unless your owner or HR changes it), Brenda sends you the day&apos;s report about your teams, saved as a private document in your Docs. Decisions for you come first, then what changed since yesterday, the standup, and per person the confirmed hours, finished work, work in progress, anything overdue or blocked, and attendance. It gives plain counts, and nobody is scored. See <Link href="/features/end-of-day-report">everything in Brenda&apos;s end-of-day report</Link>, read <Link href="/blog/end-of-day-report">what goes in an end-of-day report</Link>, or start from an <Link href="/blog/end-of-day-report-template">end-of-day report template</Link> if your team writes its own today.</p>,
            visual: <EndOfDayReportMock />, caption: "A team lead's end-of-day report: decisions waiting first, then what changed since yesterday and each person's day.",
          },
        ]}
      />

      <Section id="visibility" label="Visibility" title="What you can see, and what you can't" tone="tint"
        sub={<p>A lead&apos;s view is wide enough to help and stops where the person&apos;s own space begins. The database enforces it, not just the screens.</p>}>
        <ComparisonTable layout="versus" rowHeader={null} label="What a team lead can and cannot see"
          caption="What a team lead sees in Boredroom"
          columns={[{ key: "can", label: "You can see" }, { key: "cannot", label: "You can't see" }]}
          rows={[
            seeRow("Your teams' attendance today and by month", "Anyone's screen: Boredroom doesn't record screens"),
            seeRow("Your people's confirmed hours and timesheets", "A productivity score: there isn't one"),
            seeRow("Work submitted for review, and time corrections", "Their chats with their Brenda"),
            seeRow("Standup posts and the rollup", "Direct messages between other people"),
            seeRow("Commitments people accepted", "Their loose ends and their preferences"),
            seeRow("Call recaps from calls you joined", "Anything said by someone who chose Not me on a call"),
          ]}
        />
      </Section>

      <ProductCta title="Lead the team without chasing it"
        sub={<p>Brenda for every person, one standup rollup a day and a report every evening.</p>}
        visual={<ReportsMock />} />

      <Section id="setup" label="Getting started" title="Setting up your team" align="center"
        sub={<p>Four steps from the first invitation to your first report.</p>}>
        <StepGrid columns={4} steps={[
          { title: "The owner makes your team and puts you on it as lead", body: <p>Then shares one code, a link or an email invitation. People land in the right team with the right role.</p> },
          { title: "Everyone meets their own Brenda", body: <p>Each person names theirs and picks her colour the first time they come in.</p> },
          { title: "Switch on the standup", body: <p>In the team&apos;s Standup tab: the days, when drafts arrive and when the rollup comes.</p> },
          { title: "Read the first report", body: <p>At the end of the first day, open the report in your Docs and see what it already knows.</p> },
        ]} />
        <p className="lp-text mk-links mx-auto mt-8 max-w-2xl text-center">Every plan includes Brenda for every person, with prices per workspace rather than per person. <Link href="/pricing">See the plans</Link>, or read how <Link href="/features/ai-assistant">Brenda works as an AI assistant for teams</Link>.</p>
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/features/ai-assistant", label: "The AI assistant for every person" },
        { href: "/blog/end-of-day-report", label: "The end-of-day report, explained" },
        { href: "/blog/asynchronous-standup", label: "Run a standup without the meeting" },
        { href: "/blog/end-of-day-report-template", label: "A free end-of-day report template" },
        { href: "/features/attendance-timesheets", label: "Attendance and timesheets" },
        { href: "/pricing", label: "Boredroom pricing" },
      ]} />
    </>
  );
}
