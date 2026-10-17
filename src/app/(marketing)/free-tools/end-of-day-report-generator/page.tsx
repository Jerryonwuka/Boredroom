import Link from "next/link";
import { Ban, Signpost } from "lucide-react";
import { AnimatedCalendarDays, AnimatedEyeOff, AnimatedListChecks, AnimatedListTodo, AnimatedRefreshCw, AnimatedShieldCheck } from "@/components/ui/animated-icons";
import { ToolSquare } from "@/components/ui/tool-tile";
import { CardGrid } from "@/components/marketing/card-grid";
import { CopyBlock } from "@/components/marketing/copy-block";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { ToolShell } from "@/components/marketing/tool-shell";
import { EndOfDayReportMock } from "@/components/marketing/visuals";
import { EodReportGenerator } from "@/components/marketing/tools/eod-report-generator";
import { EXAMPLES, buildReport, reportFilename, type ReportInput } from "@/components/marketing/tools/eod-report";
import { TypedBlock, toolJsonLd } from "@/components/marketing/tools/tool-parts";
import { arrive } from "@/components/landing/parts";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";

/**
 * /free-tools/end-of-day-report-generator (owner request, 17 October 2026: SEO analysis, Content Plan page 14, target
 * keyword "end of day report generator"). The generator first, without a login; the privacy statement next to it and
 * again in full (what is stored: nothing; for how long: until the tab is reloaded); the four parts it writes; how to
 * write a good input; three worked examples built by the same template on the server (so they match the tool exactly);
 * the bridge to Brenda's own end-of-day report; the common questions (FAQPage from the same list). No AI: a template.
 *
 * Owner feedback, 17 October 2026: pages v2 (the free-tool template): a compact centred hero, the generator as the
 * centrepiece straight under it in the ToolShell (its facts on the tray's bar), then the page's own sections as product
 * sections: the steps across the page, the privacy statement as a wide card on a tinted band, the four parts and the
 * input advice as cards, each example as "what was typed" beside "what the generator wrote", the bridge to Brenda's
 * report beside a picture of it, and the questions. Every word and link of the page is kept.
 */
const PATH = "/free-tools/end-of-day-report-generator";
export const metadata = pageMetadata(PATH);

const FAQ = [
  { question: "Is the generator free?", answer: "Yes. There's no sign-up, no email and no limit on how many reports you write. It's a template that runs in your browser, so there's nothing to pay for." },
  { question: "Does it store what I type?", answer: "No. Nothing is sent to Boredroom or anyone else, and nothing is saved in your browser. Reload or close the page and it's gone, so copy or download the report to keep it." },
  { question: "Can it write a standup update too?", answer: "Yes. Choose Standup update and the same boxes become Yesterday, Today, Blockers and Waiting on a decision, ready to paste into a standup channel." },
  { question: "Does it use AI?", answer: "No. It tidies and arranges your own words with a fixed template, so the same input always gives the same report. In Boredroom, Brenda writes each lead's end-of-day report from the work itself, with nobody typing it." },
];

/** An example's boxes as they were typed, before the tidy-up. */
function typed(i: ReportInput): string {
  return [
    ["Decisions waiting on someone", i.decisions], ["What changed since yesterday", i.changed], ["Blocked, and on whom", i.blocked], ["Tomorrow", i.tomorrow],
  ].map(([label, v]) => `${label}:\n${v.trim() || "(left empty)"}`).join("\n\n");
}

export default function Page() {
  return (
    <>
      <ProductHero
        path={PATH}
        layout="center"
        compact
        lead={<p>Type a few bullet points: what changed, what&apos;s waiting on whom, what&apos;s blocked and what&apos;s next.</p>}
        sub={<p>You get a clear end-of-day report, or a standup update, to copy or download.</p>}
        jsonLd={[toolJsonLd(PATH, "End-of-day report generator", ["End-of-day reports from bullet points", "Standup updates", "Plain text or Markdown", "Copy or download", "Runs in the browser; nothing sent or stored"])]}
      />
      <ToolShell title="End-of-day report generator" facts={["No sign-up", "No AI", "Nothing leaves your browser"]}>
        <EodReportGenerator />
      </ToolShell>

      <Section id="how-to-use" label="Three steps" title="How to use it" align="center" className="pt-12 sm:pt-16">
        <StepGrid columns={3} steps={[
          { title: "Write a line per item", body: <p>In each box, one thing a line. Bullet points are enough. Add your hours if you report them; the <Link href="/free-tools/work-hours-calculator">work hours calculator</Link> works them out.</p> },
          { title: "Pick what you're writing", body: <p>An end-of-day report or a standup update, in plain text or Markdown.</p> },
          { title: "Copy it or download it", body: <p>Paste it into a chat channel or an email, or save it as a file.</p> },
        ]} />
      </Section>

      <Section id="privacy" tone="tint" label="Privacy" title="What happens to what you type" align="center">
        <div data-lp-arrive className="mx-auto flex max-w-3xl flex-col gap-5 rounded-[20px] border border-border bg-background p-6 sm:flex-row sm:p-8">
          <div className="lp-item shrink-0" style={arrive(0)}><ToolSquare><AnimatedShieldCheck /></ToolSquare></div>
          <div className="lp-item min-w-0" style={arrive(1)}>
            <p className="text-base font-semibold text-foreground">Nothing is stored, anywhere</p>
            <p className="lp-text mt-1.5">The report is put together by code running in this browser tab. There is no AI behind it and no server it sends to. What you type stays in the tab&apos;s memory only while the page is open: reload or close it and it&apos;s gone. Copy puts the report on your clipboard and Download saves a file on your device. Neither reaches Boredroom.</p>
          </div>
        </div>
      </Section>

      <Section id="produces" label="The four parts" title="What the generator produces"
        sub={<p>The same four parts every time, in the order a lead reads them, under a line of plain counts (3 changes, 1 decision waiting, nothing blocked) and your hours if you add them. Counts, not a score. It&apos;s the shape of the report Brenda writes for leads in Boredroom: decisions first, because they&apos;re what someone else is waiting on. New to these? Start with <Link href="/blog/end-of-day-report">what an end-of-day report is</Link>.</p>}>
        <CardGrid columns={4} items={[
          { icon: <Signpost />, title: "Decisions waiting on someone", body: <p>Anything that can&apos;t move until someone says yes or no, with that person&apos;s name. It goes first because it&apos;s the part a reader has to act on.</p> },
          { icon: <AnimatedRefreshCw />, title: "What changed since yesterday", body: <p>What was finished, shipped, started or moved. Changes, not a diary: &ldquo;Refund webhook live in staging&rdquo;, not &ldquo;worked on webhooks&rdquo;.</p> },
          { icon: <Ban />, title: "Blocked, and on whom", body: <p>What&apos;s stuck, and who or what it&apos;s waiting on. A blocker with a name on it gets cleared sooner than one without.</p> },
          { icon: <AnimatedCalendarDays />, title: "Tomorrow", body: <p>The first thing or two you&apos;ll pick up, so a clash shows up tonight rather than at 10am.</p> },
        ]} />
      </Section>

      <Section id="input" label="Writing tips" title="How to write a good input" align="center">
        <CardGrid columns={3} items={[
          { icon: <AnimatedListTodo />, title: "Bullet points are enough", body: <p>One line an item. Dashes, asterisks, bullets and list numbers at the start of a line are tidied away (a figure such as 2.5 hours stays as it is), the first letter is capitalised and a stray full stop is dropped, so you can paste from wherever you keep notes.</p> },
          { icon: <AnimatedListChecks />, title: "What to include", body: <p>Outcomes and names. &ldquo;Pricing copy: waiting on Ama&rdquo; tells the reader what to do; &ldquo;pricing copy pending&rdquo; doesn&apos;t. Numbers when you have them: tickets closed, sections done.</p> },
          { icon: <AnimatedEyeOff />, title: "What to leave out", body: <p>How busy the day was, a list of meetings, and anything private about a customer or a colleague. A report is often read in a shared channel by people who need to act on it.</p> },
        ]} />
      </Section>

      <Section id="examples" label="Examples" title="End-of-day report examples"
        sub={<p>Three made-up examples, put through the generator exactly as it would. &ldquo;Try an example&rdquo; above loads each one so you can change it. For more, read a <Link href="/blog/sample-end-of-day-report">sample end-of-day report</Link> with notes, or start from the <Link href="/blog/end-of-day-report-template">end-of-day report template</Link>.</p>}>
        <div className="space-y-14 sm:space-y-16">
          {EXAMPLES.map((ex) => (
            <div key={ex.id} data-lp-arrive>
              <h3 className="lp-item text-base font-semibold text-foreground" style={arrive(0)}>{ex.label}</h3>
              <div className="lp-item mt-4 grid items-start gap-3 md:grid-cols-2" style={arrive(1)}>
                <TypedBlock title="What was typed" text={typed(ex.input)} />
                <CopyBlock title="What the generator wrote" text={buildReport(ex.input)} filename={reportFilename(ex.input, "eod", "text")} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <SplitSection
        id="automatic"
        tone="tint"
        label="In Boredroom"
        title="From generator to automatic reports"
        visual={<EndOfDayReportMock />}
        visualCaption="The report Brenda writes for a team lead, drawn from the product with made-up names."
        points={[
          { title: "Why the manual version stops working", body: <p>Written by hand, the end-of-day report is the first thing dropped on a busy day and the last thing anyone wants to do at six. It&apos;s only as complete as the writer&apos;s memory, and a lead with eight people reads eight different formats.</p> },
          { title: "How Brenda writes it without you typing anything", body: <>
            <p>{ENTITY_SENTENCE} At the end of each day she writes an end-of-day report for every team lead from the work itself: the decisions waiting on them first (reviews to decide, requests, time corrections, blocked tasks that name them), then what changed since yesterday, then each person&apos;s confirmed hours, finished work and attendance. Nobody types it and nobody is scored: it gives plain counts, and the time it arrives is set in the workspace&apos;s settings. Anyone can still add a line by telling their Brenda to put it in today&apos;s team report.</p>
            <p>Meet <Link href="/features/ai-assistant">Brenda, the AI assistant that writes it for you</Link>, or <Link href="/pricing">see pricing</Link>.</p>
          </> },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3"><PrimaryCta /></div>
      </SplitSection>

      <FaqAccordion path={PATH} title="Common questions" label="Questions" items={FAQ} />

      <RelatedLinks title="Next" label="Keep exploring" links={[
        { href: "/features/ai-assistant", label: "Brenda, the AI assistant that writes it for you" },
        { href: "/blog/end-of-day-report-template", label: "End-of-day report template" },
        { href: "/blog/sample-end-of-day-report", label: "Sample end-of-day reports" },
        { href: "/blog/end-of-day-report", label: "What an end-of-day report is" },
        { href: "/free-tools/work-hours-calculator", label: "Work hours calculator" },
        { href: "/pricing", label: "See pricing" },
      ]} />
    </>
  );
}
