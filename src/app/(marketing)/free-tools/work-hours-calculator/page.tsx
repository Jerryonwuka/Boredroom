import Link from "next/link";
import { Split } from "lucide-react";
import { AnimatedCalendarDays, AnimatedHourglass, AnimatedMoon, AnimatedTimer } from "@/components/ui/animated-icons";
import { Callout, Sources, type Source } from "@/components/marketing/blocks";
import { CardGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { ToolShell } from "@/components/marketing/tool-shell";
import { ReportsMock } from "@/components/marketing/visuals";
import { toolJsonLd } from "@/components/marketing/tools/tool-parts";
import { WorkHoursCalculator } from "@/components/marketing/tools/work-hours-calculator";
import { arrive } from "@/components/landing/parts";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";

/**
 * /free-tools/work-hours-calculator (owner request, 17 October 2026: SEO analysis, Content Plan page 13, target keyword
 * "work hours calculator"). The calculator first, working without a login; then how the sums are done, the timesheet
 * cases (a full week, split and overnight shifts), breaks, the common questions (FAQPage from the same list), and the
 * bridge to Boredroom's attendance and timesheets. Overtime and break rules are quoted only from the primary sources
 * listed at the foot (US Department of Labor, California's Labor Commissioner, GOV.UK), read on 17 October 2026.
 * Boredroom itself does not calculate overtime, so the page never says it does.
 *
 * Owner feedback, 17 October 2026: pages v2 (the free-tool template): a compact centred hero, the calculator as the
 * centrepiece straight under it in the ToolShell (above the fold at 1440 × 900, its facts on the tray's bar), then the
 * page's own sections as product sections: the steps across the page, the sums beside the decimal table, the three
 * overtime rules as cards with their sources, the timesheet cases and breaks as cards, the questions, the bridge to
 * Boredroom beside a picture of confirmed hours, the caveat and the sources. Every word and link of the page is kept.
 */
const PATH = "/free-tools/work-hours-calculator";
export const metadata = pageMetadata(PATH);

const DECIMALS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

const FAQ = [
  { question: "How do I calculate hours worked?", answer: "Take the start time away from the end time, then take off any unpaid break. For 08:30 to 17:00 with a 30-minute break: 8 hours 30 minutes, minus 30 minutes, is 8 hours. For a week, work out each day and add them up." },
  { question: "How do I convert minutes to decimal hours?", answer: "Divide the minutes by 60. 45 minutes is 0.75 hours, 20 minutes is 0.33 and 10 minutes is 0.17, so 7 hours 45 minutes is 7.75 hours." },
  { question: "How is overtime calculated?", answer: "It depends on your contract and the law where you work. A common rule is time over 40 hours in a week, and some places add time over 8 hours in a day. Overtime pay is the overtime hours times your hourly rate times the overtime rate, such as 1.5 for time and a half." },
  { question: "Does the calculator save what I type?", answer: "No. It runs in your browser, sends nothing anywhere and keeps nothing: reload the page and the times are gone. Copy the summary or download the CSV to keep them." },
];

const SOURCES = {
  dolOvertime: { title: "Overtime Pay", publisher: "U.S. Department of Labor, Wage and Hour Division", url: "https://www.dol.gov/agencies/whd/overtime", asOf: "2026-10-17" },
  dolHours: { title: "Fact Sheet #22: Hours Worked Under the Fair Labor Standards Act", publisher: "U.S. Department of Labor, Wage and Hour Division", url: "https://www.dol.gov/agencies/whd/fact-sheets/22-flsa-hours-worked", asOf: "2026-10-17", published: "revised July 2008" },
  california: { title: "Overtime", publisher: "California Department of Industrial Relations, Labor Commissioner's Office", url: "https://www.dir.ca.gov/dlse/faq_overtime.htm", asOf: "2026-10-17" },
  ukOvertime: { title: "Overtime: your rights", publisher: "GOV.UK", url: "https://www.gov.uk/overtime-your-rights", asOf: "2026-10-17" },
  ukHours: { title: "Maximum weekly working hours", publisher: "GOV.UK", url: "https://www.gov.uk/maximum-weekly-working-hours", asOf: "2026-10-17" },
  ukBreaks: { title: "Rest breaks at work", publisher: "GOV.UK", url: "https://www.gov.uk/rest-breaks-work", asOf: "2026-10-17" },
} satisfies Record<string, Source>;

/** An overtime card's source line: the rule's own official page(s). */
function RuleSource({ items }: { items: readonly Source[] }) {
  return (
    <p className="mk-links text-meta font-normal text-secondary">
      Source: {items.map((s, i) => <span key={s.url}>{i ? ", " : ""}<a href={s.url} rel="noopener">{s.publisher === "GOV.UK" ? `GOV.UK, ${s.title}` : s.title}</a></span>)}
    </p>
  );
}

/** A point beside the decimal table: an h3 and its text, between hairlines (the home page's point list). */
function Point({ title, children, i }: { title: string; children: React.ReactNode; i: number }) {
  return (
    <li className="py-6">
      <div data-lp-arrive className="lp-item" style={arrive(i)}>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="lp-text mt-1.5">{children}</p>
      </div>
    </li>
  );
}

export default function Page() {
  return (
    <>
      <ProductHero
        path={PATH}
        layout="center"
        compact
        lead={<p>Add start and end times and unpaid breaks for a day or a full week.</p>}
        sub={<p>You get the hours worked in hours and minutes and in decimal hours, and overtime with the rule spelled out.</p>}
        jsonLd={[toolJsonLd(PATH, "Work hours calculator", ["Hours worked for a day or a week", "Several shifts a day", "Overnight shifts", "Unpaid breaks", "Daily and weekly overtime", "Decimal hours and hours and minutes", "Pay before tax", "CSV download"])]}
      />
      <ToolShell title="Work hours calculator" facts={["No sign-up", "Nothing you type leaves your browser", "Free"]}>
        <WorkHoursCalculator />
      </ToolShell>

      <Section id="how-to-use" label="Four steps" title="How to use it" align="center" className="pt-12 sm:pt-16">
        <StepGrid columns={4} steps={[
          { title: "Choose one day or a full week", body: <p>One day is quickest on a phone. A full week shows each day&apos;s total and applies a weekly overtime limit.</p> },
          { title: "Type each shift", body: <p>A start time, an end time and any unpaid break in minutes. Times can be 09:00, 9am or 17:30. Worked two stretches in a day? Add a shift.</p> },
          { title: "Set the overtime rule", body: <p>Overtime after so many hours a day, a week, or both. Add an hourly rate if you want pay before tax.</p> },
          { title: "Check it and keep it", body: <p>Open &ldquo;Show the working&rdquo; to see every sum, then copy the summary or download the CSV for a spreadsheet or a timesheet.</p> },
        ]} />
      </Section>

      <Section id="how-calculated" label="The sums" title="How work hours are calculated">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16">
          <ul className="max-w-xl divide-y divide-border border-y border-border">
            <Point i={0} title="Start time, end time and breaks">A shift&apos;s hours are its end time minus its start time, minus any unpaid break. 09:00 to 17:30 is 8 hours 30 minutes; take off a 30-minute lunch and that&apos;s 8 hours worked. The calculator counts in whole minutes and only converts at the end, so small roundings never add up across a week.</Point>
            <Point i={1} title="Decimal hours vs. hours and minutes">7:45 and 7.75 are the same amount of time written two ways. Timesheets usually show hours and minutes; payroll and invoices usually want decimal hours, because those can be multiplied by a rate. To convert, divide the minutes by 60: 45 ÷ 60 = 0.75, so 7 hours 45 minutes is 7.75 hours.</Point>
          </ul>
          <ComparisonTable
            label="Minutes as decimal hours"
            caption="Minutes as decimal hours, to two places"
            rowHeader="Minutes"
            minWidth="0"
            columns={[{ key: "d1", label: "Decimal hours" }, { key: "m2", label: "Minutes" }, { key: "d2", label: "Decimal hours" }]}
            rows={DECIMALS.slice(0, 6).map((m, i) => ({
              label: m,
              cells: { d1: (m / 60).toFixed(2), m2: <span className="font-medium text-foreground">{DECIMALS[i + 6]}</span>, d2: (DECIMALS[i + 6] / 60).toFixed(2) },
            }))}
          />
        </div>

        <div className="mt-16 sm:mt-20">
          <div data-lp-arrive className="max-w-2xl">
            <h3 className="lp-item font-display text-[24px] font-normal leading-[30px] tracking-[-0.02em] text-foreground" style={arrive(0)}>Overtime rules</h3>
            <p className="lp-text lp-item mt-3" style={arrive(1)}>There is no single overtime rule: it depends on the law where you work and on your contract. Three examples, from the official sources listed at the end of this page:</p>
          </div>
          <CardGrid className="mt-8" columns={3} variant="cards" headingLevel="h4" items={[
            { title: "United States (federal)", body: <p>The Fair Labor Standards Act requires overtime at no less than 1.5 times the regular rate for hours over 40 in a workweek. There is no federal daily limit, and weekends aren&apos;t overtime by themselves.</p>, footer: <RuleSource items={[SOURCES.dolOvertime]} /> },
            { title: "California", body: <p>Adds a daily rule: hours over 8 in a workday are paid at 1.5 times, and hours over 12 at double time, as well as the 40-hour week.</p>, footer: <RuleSource items={[SOURCES.california]} /> },
            { title: "United Kingdom", body: <p>There is no legal right to overtime pay; your contract sets it. Your average pay for all the hours you work can&apos;t fall below the National Minimum Wage, and the working week is limited to 48 hours on average unless you opt out.</p>, footer: <RuleSource items={[SOURCES.ukOvertime, SOURCES.ukHours]} /> },
          ]} />
          <p className="lp-text mt-6 max-w-3xl">The calculator takes a daily limit, a weekly limit or both. With both, no minute is counted twice: daily overtime comes first, and the weekly limit applies to the hours that weren&apos;t already overtime. It&apos;s a calculator, not legal advice, so check the rule in your contract.</p>
        </div>
      </Section>

      <Section id="timesheet" label="Timesheets" title="Timesheet calculator" align="center"
        sub={<p>A full week, a split shift or a night shift: how to enter each one.</p>}>
        <CardGrid columns={3} items={[
          { icon: <AnimatedCalendarDays />, title: "Adding a full week", body: <p>Switch to &ldquo;A full week&rdquo; and fill in each day. Every day shows its own total, and the result adds up the week and applies the weekly limit. Download the CSV to paste the week into a spreadsheet, one row a shift, with the totals at the bottom.</p> },
          { icon: <Split />, title: "Handling split shifts", body: <p>Worked 07:00 to 11:00 and again 16:00 to 20:00? Add a second shift on that day. The gap between the two isn&apos;t counted, so there&apos;s no need to enter it as a break.</p> },
          { icon: <AnimatedMoon />, title: "Handling overnight shifts", body: <p>Type an end time earlier than the start, such as 22:00 to 06:00, and the shift ends the next day: 8 hours. The whole shift counts on the day it started, which is how most rotas record a night shift. If your employer splits night shifts at midnight, enter 22:00 to 24:00 on one day and 00:00 to 06:00 on the next.</p> },
        ]} />
      </Section>

      <Section id="breaks" tone="tint" label="Breaks" title="Break time and unpaid breaks" align="center">
        <CardGrid columns={2} items={[
          { icon: <AnimatedHourglass />, title: "What counts as a break", body: <p>Enter only unpaid breaks, the time you&apos;re off the clock. Paid breaks are working time, so leave them in the shift. The rules differ by country. In the UK, someone working more than 6 hours a day has the right to one uninterrupted 20-minute rest break, and whether it&apos;s paid depends on the contract. Under the US federal rules, short rest breaks of about 20 minutes or less count as hours worked, while a real meal break, typically 30 minutes or more with no duties, generally doesn&apos;t.</p>, footer: <RuleSource items={[SOURCES.ukBreaks, SOURCES.dolHours]} /> },
          { icon: <AnimatedTimer />, title: "How breaks affect overtime thresholds", body: <p>Overtime is worked out after breaks come off. 09:00 to 18:00 is 9 hours on the clock; with an unpaid hour for lunch it&apos;s 8 hours worked, so a daily limit of 8 gives no overtime. Without the lunch break, the same day has an hour of overtime.</p> },
        ]} />
      </Section>

      <FaqAccordion path={PATH} title="Common questions" label="Questions" items={FAQ} />

      <SplitSection
        id="to-timesheet"
        tone="tint"
        label="In Boredroom"
        title="From calculator to timesheet"
        visual={<ReportsMock />}
        visualCaption="Confirmed hours for a team, by day: only time people confirmed counts."
        points={[
          { title: "Why manual calculation breaks down", body: <p>A calculator is fine for one person&apos;s week. Across a team it stops working: someone forgets Tuesday, a night shift is split two different ways, a correction is made in a spreadsheet nobody can trace, and payroll&apos;s totals stop matching the timesheets. If you report your day as well as your hours, the <Link href="/free-tools/end-of-day-report-generator">end-of-day report generator</Link> turns a few bullet points into one, and our guide explains <Link href="/blog/end-of-day-report">what goes in an end-of-day report</Link>.</p> },
          { title: "How Boredroom calculates it automatically", body: <>
            <p>{ENTITY_SENTENCE} People clock in and work on their tasks, and the clock runs on the task they started and pauses when they do. Timesheets count only confirmed time: if a laptop sleeps, the gap is marked uncertain and the person is asked what happened, rather than the time being counted or held against them. A correction counts once a lead approves it, the approved version stays, and the CSV export adds up to the same totals.</p>
            <p>Attendance is checked against the clock-in and clock-out times you set, with a grace period. No productivity score, no screen recording, no call recording. See <Link href="/features/attendance-timesheets">remote team attendance and timesheets</Link> in Boredroom, or <Link href="/pricing">see pricing</Link>: the Free plan is for up to 5 people.</p>
          </> },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3"><PrimaryCta /></div>
      </SplitSection>

      <Section id="sources" title="Sources" width="text" label="Where the rules come from">
        <Callout title="A calculator, not advice">
          <p>The rules quoted here are summaries of the sources below as of 17 October 2026. Your contract, and the law where you work, decide your overtime and breaks.</p>
        </Callout>
        <div className="mk-links mt-6 rounded-[20px] border border-border p-6 text-secondary">
          <Sources items={Object.values(SOURCES)} />
        </div>
      </Section>

      <RelatedLinks title="Next" label="Keep exploring" links={[
        { href: "/features/attendance-timesheets", label: "Remote team attendance and timesheets" },
        { href: "/free-tools/end-of-day-report-generator", label: "End-of-day report generator" },
        { href: "/blog/end-of-day-report", label: "The end-of-day report, explained" },
        { href: "/pricing", label: "See pricing" },
      ]} />
    </>
  );
}
