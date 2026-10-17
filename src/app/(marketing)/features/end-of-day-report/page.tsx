import Link from "next/link";
import { Clock, UsersRound } from "lucide-react";
import { CheckList } from "@/components/marketing/blocks";
import { CardGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { PricingSection, ProductCta } from "@/components/marketing/product/parts";
import { EndOfDayReportMock, HeroCluster, ReportsMock, StandupCardMock, VisualStage } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /features/end-of-day-report: the report Brenda writes for every lead (review fix, 17 October 2026: SEO analysis,
 * Section B's starting count of 4 feature pages). The blog explains end-of-day reports in general
 * (/blog/end-of-day-report) and the free generator builds one from your own notes; this page is the product feature.
 *
 * Built behaviour only, checked 17 October 2026 against server/services/daily-report.ts: who gets one (every lead of a
 * live team, about their teams; the owner and HR, about the whole organisation, while the organisation keeps that on);
 * built as the recipient under row-level security, so it never shows more than their own pages; the order ("Decisions
 * for you", "Changed since yesterday", Updates, Notes from the team, Standup, Commitments, then per person: confirmed
 * hours, finished and sent for review, in progress, overdue or blocked, attendance; then what needs attention); saved as
 * a private document in Docs ("Daily reports"), announced with a notification; asked for during the day it lands only on
 * the person asking and is refreshed until they edit it; a figure it could not read says "not available", never 0;
 * plain counts, nobody ranked. The time (18:00 unless owners or HR change it) from the team-leads page's check of
 * brenda.ts. The email is left out: it depends on mail being set up.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the feature template
 * (spec §5.1): a split hero with the top of the report (cut with the peek fade), what the report is, what is in it
 * beside the whole report (review fix: the picture matches the words) with its three rules, who gets it and when as two
 * cards on a tinted band, what the team can add as steps beside the standup card (the third step), the call to action,
 * the three ways compared in a table on a tinted band, the live plans, the FAQ and related cards. Every h2, every h3
 * that heads content, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/features/end-of-day-report";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "Who writes the end-of-day report in Boredroom?",
    answer: "Brenda does, from what was recorded in Boredroom that day: tasks, timers, submissions, attendance, standups and commitments. Nobody on the team has to write anything for it, though anyone can ask their assistant to add a note.",
  },
  {
    question: "Can a lead see more in the report than in the app?",
    answer: "No. The report is built as the person who receives it, under the same row-level security as their own pages, so it never shows more than they could already see.",
  },
  {
    question: "Does the report score or rank people?",
    answer: "No. It gives plain counts and facts: hours, finished work, what is blocked, attendance. Nobody is scored and nothing compares one person with another.",
  },
  {
    question: "Can I get the report before the end of the day?",
    answer: "Yes. Ask Brenda for it, or use the button in Settings. That report lands only on you, and it is refreshed each time you ask until you edit it. The end-of-day run refreshes it a last time and sends it.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>{ENTITY_SENTENCE}</p>}
        sub={<p>At the end of each day she writes every team lead a report nobody had to write: the decisions waiting on them first, then what changed since yesterday, and each person&apos;s hours, finished work and attendance. Plain counts, and nobody is scored.</p>}
        actions={<PrimaryCta secondary={{ href: "/blog/sample-end-of-day-report", label: "See a sample report" }} />}
        points={POSITIONING_POINTS}
        visual={<HeroCluster caption="A sample end-of-day report for a team lead."
          primary={<div className="mk-peek max-h-[480px] overflow-hidden [--peek-h:480px]"><EndOfDayReportMock /></div>} />}
      />

      <Section id="what-it-is" label="The idea" title="An end-of-day report nobody had to write" width="text">
        <div className="lp-text mk-links space-y-4 text-[17px] leading-7">
          <p>An end-of-day report tells a lead what happened today and what needs them tomorrow. Written by hand, it costs each person time at the end of the day, and it is only as good as what they remember. If you want the background, read <Link href="/blog/end-of-day-report">what an end-of-day report is and how to write one</Link>.</p>
          <p>In Boredroom the facts are already recorded as the day goes on: the to-dos people plan, the timers they start, the work they submit for review and their clock-ins. Brenda turns them into the report at the time set in Settings, so the people doing the work don&apos;t stop to describe it.</p>
        </div>
      </Section>

      <SplitSection id="whats-in-it" label="What is in it" title="What is in the report"
        points={[
          { title: "Decisions for you, first", body: <p>Right under the headline comes what waits on the reader: work to review, requests and follow-ups waiting for them, time corrections for team leads, and blocked tasks whose reason names them.</p> },
          { title: "What changed since yesterday", body: <p>Newly blocked, unblocked, deadlines moved later, newly late and finished, compared with the previous report. Tasks that didn&apos;t change are left out, so the report gets shorter on a quiet day.</p> },
          { title: "Each person's day", body: <p>Per person: confirmed hours, what they finished and sent for review, what is in progress and how far along, anything overdue or blocked, and attendance, such as a late clock-in or no clock-in on a working day. Hours come from the same confirmed time as the <Link href="/features/attendance-timesheets">attendance and timesheets</Link>.</p> },
          { title: "Standups and commitments", body: <p>A lead who runs a standup sees each team&apos;s rollup, with the blockers people named. Commitments accepted today, including action items from <Link href="/features/call-notes">consent-based call notes</Link>, are listed with the open ones past their due date.</p> },
        ]}
        visual={<EndOfDayReportMock />}
        visualCaption="A sample report: the decisions waiting on the lead first, then what changed since yesterday, then each person's day."
      >
        <div className="rounded-[20px] border border-border bg-fill-0 p-6">
          <CheckList className="lp-text mk-links" items={[
            "Every line links its source when there is one: the task, the review, the attendance record.",
            "A figure the report couldn't read says “not available”, never 0.",
            "Plain counts: nobody is scored, and nothing ranks one person against another.",
          ]} />
        </div>
      </SplitSection>

      <Section id="who-gets-it" label="Delivery" title="Who gets it, and when" align="center" tone="tint">
        <CardGrid columns={2} items={[
          { icon: <UsersRound />, title: "Every lead, and the owner and HR", body: <p>Every team lead gets one about their own teams. The owner and HR can get one about the whole organisation. Each report is built as the person who receives it, so it never shows more than their own pages would.</p> },
          { icon: <Clock />, title: "At 18:00, or the time you set", body: <p>It arrives at the time set in Settings, 18:00 unless the owner or HR change it, saved as a private document in the reader&apos;s Docs under Daily reports, with a notification. Need it sooner? Ask Brenda for it, or use the button in Settings: that report lands only on you, and it is refreshed each time you ask until you edit it.</p> },
        ]} />
      </Section>

      <Section id="team-adds" label="From the team" title="What the team can add" align="center"
        sub={<p>Nobody has to write the report, but anyone can add to it.</p>}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start lg:gap-12">
        <StepGrid columns={1} steps={[
          { title: "A note for today's report", body: <p>Anyone can tell their assistant &ldquo;Put this in today&apos;s team report&rdquo; and what to say. It appears under Notes from the team, readable only by the people who may already see that person&apos;s records: their team leads, the owner and HR.</p> },
          { title: "Updates collected before the report", body: <p>If the owner or HR switch it on, the workspace&apos;s assistant asks each person&apos;s assistant what they worked on today, a set time before the report, and the answers go in under Updates.</p> },
          { title: "The standup, drafted from real work", body: <p>When a lead switches on the standup, each person&apos;s Brenda drafts their update and they press Post. Read how an <Link href="/blog/asynchronous-standup">asynchronous standup</Link> works.</p> },
        ]} />
        <figure className="min-w-0 text-left">
          <div className="lp-sticky">
            <VisualStage><StandupCardMock /></VisualStage>
            <figcaption className="mt-3 text-meta font-normal text-secondary">A standup Brenda drafted from Ben&apos;s own work. The lead&apos;s report carries each team&apos;s rollup, with the blockers people named.</figcaption>
          </div>
        </figure>
        </div>
      </Section>

      <ProductCta title="A report for every lead, written by Brenda"
        sub={<p>The decisions waiting on them first, then what changed, then each person&apos;s day. It comes with every plan, including Free.</p>}
        visual={<ReportsMock />} />

      <Section id="compared" label="Compared" title="Compared with writing the report yourself" tone="tint">
        <ComparisonTable layout="matrix" rowHeader="Way" label="Ways to produce an end-of-day report"
          caption="Three ways to produce an end-of-day report"
          columns={[{ key: "who", label: "Who does the work" }, { key: "facts", label: "Where the facts come from" }]}
          rows={[
            { label: "A template filled in by hand", cells: { who: "Each person, at the end of the day", facts: "Their memory and notes" } },
            { label: "Boredroom's free generator", cells: { who: "You type a few lines; it tidies them", facts: "What you type" } },
            { label: "Brenda's end-of-day report", cells: { who: "Nobody: it is written for every lead", facts: "Tasks, timers, submissions, attendance and standups recorded that day" } },
          ]}
        />
        <p className="lp-text mk-links mt-8 max-w-3xl">Not on Boredroom yet? Start with the <Link href="/blog/end-of-day-report-template">end-of-day report template</Link> or the <Link href="/free-tools/end-of-day-report-generator">free end-of-day report generator</Link>. If your day goes on chasing people for the same facts, see how to <Link href="/solutions/stop-chasing-updates">stop chasing your team for updates</Link>.</p>
      </Section>

      <PricingSection link={{ href: "/pricing", label: "See every plan" }}
        sub={<><p>The end-of-day report comes with every plan, including Free, because it is written by <Link href="/features/ai-assistant">Brenda, the AI assistant for teams</Link>.</p><p>Prices are per workspace, not per person.</p></>} />

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/blog/sample-end-of-day-report", label: "Sample end-of-day reports" },
        { href: "/usecases/team-leads", label: "A team lead's day with Boredroom" },
        { href: "/solutions/fewer-status-meetings", label: "Replace status meetings" },
        { href: "/features/ai-assistant", label: "The AI assistant who writes it" },
        { href: "/blog/end-of-day-report", label: "End-of-day reports, explained" },
      ]} />
    </>
  );
}
