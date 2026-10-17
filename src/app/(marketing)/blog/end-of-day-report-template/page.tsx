import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { AsOf, Callout, ScrollTable, Steps } from "@/components/marketing/blocks";
import { CopyBlock } from "@/components/marketing/copy-block";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqSection } from "@/components/marketing/faq-section";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Cite, PageLink, SampleReport } from "@/components/marketing/blog/parts";
import { EndOfDayReportMock } from "@/components/marketing/blog/product-mocks";
import { DOWNLOAD_MD, DOWNLOAD_TXT, FILLED_EXAMPLES, SAMPLE_REPORTS, TEMPLATE_ONE_LINE, TEMPLATE_PLAIN, TEMPLATE_STRUCTURED } from "@/components/marketing/blog/templates";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /blog/end-of-day-report-template: the free template (owner request, 17 October 2026: SEO analysis; Content Plan page 2,
 * target keyword "end of day report template"). The template is on the page, ungated, in copy blocks (three versions),
 * with three filled-in examples, a before/after table, ungated downloads (.md and .txt, route handlers beside this page,
 * from the same text: components/marketing/blog/templates.ts) and a picture of the report Brenda writes.
 *
 * Deviation from the brief: it asks for Google Docs and Notion downloads. No public Google Doc or Notion page exists, so
 * none is linked (none invented); the page says how to open the plain-text file in Google Docs and import it into Notion
 * (Notion's own help page, read 17 October 2026).
 *
 * Owner feedback, 17 October 2026: pages v2. A designed header whose cover is the plain-text version filled in (the
 * design sample from the samples post: the blank template is printed right below, so the cover shows what it becomes;
 * review fix), the readable article unchanged, then a product band (the free generator, and Brenda writing
 * the report every day: the picture that was the figure in "When to stop using a template") and the related cards.
 */
const PATH = "/blog/end-of-day-report-template";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "template", label: "The template" },
  { id: "how-to-use", label: "How to use it" },
  { id: "sections", label: "What each section is for" },
  { id: "examples", label: "Filled-in examples" },
  { id: "download", label: "Download" },
  { id: "when-to-stop", label: "When to stop using a template" },
  { id: "faq", label: "FAQ" },
];

const FAQ = [
  {
    question: "What is the best format for an end-of-day report?",
    answer: "Four short sections in a fixed order: decisions waiting on someone, what changed since yesterday, what is blocked and on whom, and tomorrow. Decisions go first because they are what the reader acts on. Use plain text in chat and the structured version in a document or an email.",
  },
  {
    question: "How long should the template be?",
    answer: "As short as the team will keep filling in. The structured version is four headings with one or two lines under each, which most people can complete in five minutes. If nobody reads a section after a week, cut it.",
  },
  {
    question: "Can I use this template for a daily standup?",
    answer: "Yes, with one change: a standup looks forward from the start of the day, so swap the order to yesterday, today and blocked. Keep the decisions line if your team has one; it is the part a standup usually forgets.",
  },
];

export default function Page() {
  return (
    <>
      <ArticleHeader path={PATH} cover={<SampleReport kind="Filled in" title="The plain-text version, filled in" lines={SAMPLE_REPORTS.design.map((text) => ({ text }))} />} />
      <ArticleBody toc={TOC}>
        <p>
          Below is a free end-of-day report template in three versions. Copy one, change it to suit your team, or download the
          lot as a file. There is no email form. If you are new to the practice, start with <PageLink href="/blog/end-of-day-report">what
          an end-of-day report is</PageLink> and come back.
        </p>

        <h2 id="template">End-of-day report template (copy and paste)</h2>
        <h3>The plain-text version</h3>
        <p>For a message in a team channel. Four lines, one each for a decision, a change, a blocker and tomorrow.</p>
        <CopyBlock title="Plain-text template" text={TEMPLATE_PLAIN} filename="end-of-day-report-template.txt" />
        <h3>The structured version (with headings)</h3>
        <p>For a shared document, a wiki page or an email, where headings make it easy to scan. This is the end-of-day report format most teams settle on.</p>
        <CopyBlock title="Structured template (Markdown)" text={TEMPLATE_STRUCTURED} filename="end-of-day-report-template.md" />
        <h3>The one-line version, for teams that hate reports</h3>
        <p>When a full report is too much, one line still answers the question a lead would otherwise ask.</p>
        <CopyBlock title="One-line template" text={TEMPLATE_ONE_LINE} />

        <h2 id="how-to-use">How to use this template</h2>
        <Steps headings items={[
          { id: "step-1", title: "Step 1: pick the version that matches your team's size", body: <p>Under five people who talk every day: the one-line version. A team across time zones, or a lead with more than five reports: the structured one. In between, the plain-text version in your team channel.</p> },
          { id: "step-2", title: "Step 2: fill in the four sections", body: <p>One or two lines each. If a section is empty, say so: &ldquo;Nothing is blocked&rdquo; tells the reader something. Name people and dates rather than writing &ldquo;waiting on feedback&rdquo;.</p> },
          { id: "step-3", title: "Step 3: set a send time and stick to it", body: <p>Late afternoon on the team&rsquo;s main clock suits most teams, early enough for a lead to answer a decision before they log off. The same time every day is what makes people read it.</p> },
          { id: "step-4", title: "Step 4: review it for a week, then cut what nobody reads", body: <p>After a week, ask the readers which lines they used. Remove the rest. A shorter report that gets read beats a complete one that does not.</p> },
        ]} />

        <h2 id="sections">What each section is for</h2>
        <h3>Decisions waiting on you</h3>
        <p>The approvals and choices that hold up work, each with the person who decides and the deadline. It goes first because it is the one section a reader must act on today.</p>
        <h3>What changed since yesterday</h3>
        <p>Finished work, work sent for review, and anything that moved, such as a deadline. Only the changes: work that is where it was yesterday does not need a line.</p>
        <h3>Blocked, and on whom</h3>
        <p>What is stuck, who it waits on and the exact thing needed. A named blocker is a request someone can answer; an unnamed one is a worry nobody can act on.</p>
        <h3>Tomorrow</h3>
        <p>The first one or two things you will pick up. It lets the reader plan around you and gives you a start in the morning.</p>
        <p>Here is the difference those rules make, line by line:</p>
        <ScrollTable label="A weak end-of-day report and a good one, line by line">
          <table>
            <caption>Before and after: the same day, written two ways</caption>
            <thead><tr><th scope="col">Section</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>
              <tr><th scope="row">Decisions</th><td>Waiting on feedback.</td><td>Need David to pick pricing layout A or B by Thursday.</td></tr>
              <tr><th scope="row">Changed</th><td>Worked on design stuff all day, very busy.</td><td>Finished the settings icon set and handed it to Ben.</td></tr>
              <tr><th scope="row">Blocked</th><td>Still blocked on copy.</td><td>Pricing page copy: waiting on Chidi for the client&rsquo;s final text.</td></tr>
              <tr><th scope="row">Tomorrow</th><td>More of the same.</td><td>Usability test with three customers at 14:00.</td></tr>
              <tr><th scope="row">Hours</th><td>Online 9 hours.</td><td>Left out: hours belong on the timesheet.</td></tr>
            </tbody>
          </table>
        </ScrollTable>

        <h2 id="examples">Filled-in example</h2>
        <p>Three end-of-day report examples, each in the structured version. For seven more, with notes on every line, <PageLink href="/blog/sample-end-of-day-report">see filled-in examples</PageLink> in the sample reports post.</p>
        {FILLED_EXAMPLES.map((e) => (
          <div key={e.id}>
            <h3 id={e.id}>{e.heading}</h3>
            <CopyBlock className="mt-3" title={`${e.role}: filled-in example`} text={e.text} />
          </div>
        ))}

        <h2 id="download">Download the template</h2>
        <p>Every version, the three examples above and the seven <PageLink href="/blog/sample-end-of-day-report">sample end-of-day reports</PageLink> in one file, free to change and share.</p>
        <h3>Markdown / plain text</h3>
        <ul>
          <li><a href={DOWNLOAD_MD} download>Download the end-of-day report template as Markdown (.md)</a></li>
          <li><a href={DOWNLOAD_TXT} download>Download the end-of-day report template as plain text (.txt)</a></li>
        </ul>
        <h3>Google Docs</h3>
        <p>Upload the plain-text file to Google Drive and open it with Google Docs, or paste a copied block into a new document. The structured version&rsquo;s headings start with # signs; turn them into Docs headings with the style menu.</p>
        <h3>Notion</h3>
        <p>
          Notion imports Markdown directly: in Notion, open Settings, then Import, then Text &amp; Markdown, and choose the .md file
          (<Cite href="https://www.notion.com/help/import-data-into-notion">Notion&rsquo;s help page on importing</Cite>, <AsOf date="2026-10-17" />). The headings
          and lists arrive as Notion blocks.
        </p>

        <h2 id="when-to-stop">When to stop using a template</h2>
        <h3>The point where the report should write itself</h3>
        <p>
          A template is the manual version of a simple idea: the facts of the day, in the order a reader acts on them. Most of
          those facts already exist somewhere, in the tasks people finished, the work sent for review and the blockers they
          flagged. Once your team keeps its work in one place, retyping it every evening is the part to drop.
        </p>
        <p>
          You can <PageLink href="/free-tools/end-of-day-report-generator">generate an end-of-day report automatically</PageLink> from
          a few lines with our free tool, or go further and let <PageLink href="/features/ai-assistant">Brenda, the AI assistant that
          writes it for you</PageLink>, do it every day. In Boredroom she writes each team lead&rsquo;s report from what was recorded:
          decisions first, then what changed since yesterday, then each person&rsquo;s day, with no productivity score and nobody ranked.
        </p>
        <Callout title="Try it on your own team">
          <p>The Free plan covers one workspace of up to 5 people, with no card needed. <PageLink href="/pricing">Start free</PageLink> or compare the plans.</p>
        </Callout>

        <FaqSection path={PATH} items={FAQ} />
      </ArticleBody>
      <CtaBand
        className="mt-8 sm:mt-12"
        label="In Boredroom"
        title="The same four sections, with nobody typing them"
        sub={<p>Brenda writes each team lead&rsquo;s end-of-day report from what was recorded that day: decisions first, then what changed since yesterday, then each person&rsquo;s day. No productivity score, and nobody ranked.</p>}
        actions={<PrimaryCta secondary={{ href: "/free-tools/end-of-day-report-generator", label: "Turn your notes into a report" }} />}
        visual={<EndOfDayReportMock />}
      />
      <RelatedLinks title="Keep reading" label="Related" links={[
        { href: "/blog/end-of-day-report", label: "The end-of-day report guide" },
        { href: "/blog/sample-end-of-day-report", label: "Sample end-of-day reports, annotated" },
        { href: "/free-tools/end-of-day-report-generator", label: "Free end-of-day report generator" },
        { href: "/features/ai-assistant", label: "An AI assistant that writes the report" },
        { href: "/pricing", label: "Plans and pricing" },
      ]} />
    </>
  );
}
