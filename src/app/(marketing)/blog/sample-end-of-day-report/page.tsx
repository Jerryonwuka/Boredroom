import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { Callout, ScrollTable } from "@/components/marketing/blocks";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqSection } from "@/components/marketing/faq-section";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks } from "@/components/marketing/related-links";
import { PageLink, Points, SampleReport } from "@/components/marketing/blog/parts";
import { EndOfDayReportMock } from "@/components/marketing/blog/product-mocks";
import { DOWNLOAD_MD, SAMPLE_REPORTS } from "@/components/marketing/blog/templates";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /blog/sample-end-of-day-report: seven sample reports with notes (owner request, 17 October 2026: SEO analysis; Content
 * Plan page 3, target keyword "sample end of day report"). Each sample in its own block (SampleReport), followed by the
 * same four notes in the same order (the brief's "recurring annotation pattern": decision, changes, blocker, tomorrow)
 * and what to cut; a bad report with a line-by-line rewrite; a picture of the report Brenda writes (a coded mock with
 * made-up names: there are no screenshots). The samples' text lives in components/marketing/blog/templates.ts, so the
 * template download carries all seven (the brief's "downloadable bundle").
 *
 * Owner feedback, 17 October 2026: pages v2. A designed header whose cover is a weak report beside its rewrite (two
 * lines of each), the readable article unchanged, then a product band with the report Brenda writes (the picture that
 * closed the article) and the related cards.
 */
const PATH = "/blog/sample-end-of-day-report";
export const metadata = pageMetadata(PATH);

const TOC = [
  { id: "good-report", label: "What a good report looks like" },
  { id: "engineering", label: "Engineering" },
  { id: "support", label: "Customer support" },
  { id: "design", label: "Design" },
  { id: "sales", label: "Sales" },
  { id: "agency", label: "Agency and client work" },
  { id: "bad-report", label: "A bad one, and how to fix it" },
  { id: "one-line", label: "The one-line version" },
  { id: "faq", label: "FAQ" },
];

const FAQ = [
  {
    question: "How do you write a good end-of-day report?",
    answer: "Write it for the person who acts next. Put any decision you need first, with the person and the deadline; then what changed today; then what is blocked and on whom; then one line for tomorrow. Leave out hours, activity and anything that did not change.",
  },
  {
    question: "What should an end-of-day report include?",
    answer: "Four things: decisions waiting on someone, what changed since yesterday, what is blocked and who it waits on, and what comes first tomorrow. Name people and dates. If a section is empty, say so in a few words.",
  },
  {
    question: "How long should a sample end-of-day report be?",
    answer: "Four to six lines, like the samples on this page. That is enough to carry a decision, two changes, a blocker and tomorrow, and short enough to read in under a minute. On a quiet day, one line is fine.",
  },
];

/** A sample's lines as SampleReport wants them. */
const lines = (key: keyof typeof SAMPLE_REPORTS) => SAMPLE_REPORTS[key].map((text) => ({ text }));

export default function Page() {
  return (
    <>
      <ArticleHeader path={PATH} cover={
        // A weak report and its rewrite, two lines each (the rewrite section's own lines), not the engineering sample
        // that the first screen prints in full (review fix, 17 October 2026).
        <div className="grid gap-3">
          <SampleReport kind="Before" title="Sam, product engineer" lines={[SAMPLE_REPORTS.bad[1], SAMPLE_REPORTS.bad[3]].map((text) => ({ text }))} />
          <SampleReport kind="After" title="Sam, rewritten" lines={[SAMPLE_REPORTS.rewrite[2], SAMPLE_REPORTS.rewrite[3]].map((text) => ({ text }))} />
        </div>
      } />
      <ArticleBody toc={TOC}>
        <p>
          Seven sample end-of-day reports for different kinds of work, each followed by the same four notes so you can see the
          pattern rather than just copy the example. They use made-up people and work. If you want the theory first, start with
          the guide to the <PageLink href="/blog/end-of-day-report">end-of-day report</PageLink>.
        </p>

        <h2 id="good-report">What a good end-of-day report looks like</h2>
        <h3>The four things every good report does</h3>
        <ol>
          <li><strong>Decision first.</strong> Anything waiting on someone else, with their name and a deadline.</li>
          <li><strong>Changes, not activity.</strong> What was finished, sent or moved, never what kept you busy.</li>
          <li><strong>A named blocker.</strong> What is stuck, who it waits on, and the exact thing needed.</li>
          <li><strong>One line for tomorrow.</strong> Enough for the reader to plan around you.</li>
        </ol>
        <h3>The one thing that ruins a report</h3>
        <p>
          Writing it to look busy. Hours online, messages sent and lists of everything touched push the useful lines down the
          page, and the reader stops looking. Every note below comes back to this.
        </p>

        <h2 id="engineering">Sample end-of-day report: engineering</h2>
        <h3>The report</h3>
        <SampleReport title="Ben, backend engineer" lines={lines("engineering")} />
        <h3>Why it works (annotated)</h3>
        <Points items={[
          ["Decision first.", "The export question has a person, a time and a reason: the migration starts at 10:00."],
          ["Changes, not activity.", "“Merged” and “sent for review” are states a reader can check, not effort."],
          ["A named blocker.", "Olu knows exactly what to send: the database credentials."],
          ["One line for tomorrow.", "It forks on the decision, which tells Max why the decision matters."],
        ]} />
        <h3>What to cut</h3>
        <p>Commit counts, a list of every pull request and &ldquo;fixed some small bugs&rdquo;. Link the work instead; the reader can open it if they care.</p>

        <h2 id="support">Sample end-of-day report: customer support</h2>
        <h3>The report</h3>
        <SampleReport title="Kemi, support" lines={lines("support")} />
        <h3>Why it works (annotated)</h3>
        <Points items={[
          ["Decision first.", "A refund outside policy needs a lead; the amount and the reason are in the line."],
          ["Changes, not activity.", "The queue going from 58 to 22 is the day’s outcome in one number."],
          ["A named blocker.", "The deletions wait on a sign-off, and Ada is the person who can get it."],
          ["One line for tomorrow.", "Oldest tickets first is a plan a lead can agree with or change."],
        ]} />
        <h3>What to cut</h3>
        <p>Tickets touched per hour and average reply times belong in the help desk&rsquo;s own reports. The end-of-day report is for what someone needs to act on.</p>

        <h2 id="design">Sample end-of-day report: design</h2>
        <h3>The report</h3>
        <SampleReport title="Ada, product designer" lines={lines("design")} />
        <h3>Why it works (annotated)</h3>
        <Points items={[
          ["Decision first.", "“None today” is still a line: the reader knows they can skip to the rest."],
          ["Changes, not activity.", "The test result (2 of 3 missed the switcher) is the finding, not “ran a test”."],
          ["A named blocker.", "The copy waits on Chidi, and on one specific thing: the client’s final text."],
          ["One line for tomorrow.", "It follows from the finding, so the reader sees the plan and the reason together."],
        ]} />
        <h3>What to cut</h3>
        <p>Screenshots of every iteration. Link the design file once; the report should be readable without opening it.</p>

        <h2 id="sales">Sample end-of-day report: sales</h2>
        <h3>The report</h3>
        <SampleReport title="Priya, account executive" lines={lines("sales")} />
        <h3>Why it works (annotated)</h3>
        <Points items={[
          ["Decision first.", "The discount has a size, a deal and a deadline (Friday’s call)."],
          ["Changes, not activity.", "A demo that became a trial and a signed renewal are movement in the pipeline."],
          ["A named blocker.", "The security questionnaire waits on Ben, with the prospect’s deadline beside it."],
          ["One line for tomorrow.", "Two concrete things, both tied to deals already in the report."],
        ]} />
        <h3>What to cut</h3>
        <p>Calls made and emails sent. They measure effort, and they invite the wrong conversation; the pipeline changes are what the lead needs.</p>

        <h2 id="agency">Sample end-of-day report: agency / client work</h2>
        <h3>The report</h3>
        <SampleReport title="Tunde, account manager" lines={lines("agency")} />
        <h3>Why it works (annotated)</h3>
        <Points items={[
          ["Decision first.", "Scope creep is a money decision, so it goes to David with a deadline, not into the work."],
          ["Changes, not activity.", "The client’s choice and the moved launch date are the two facts the team must know."],
          ["A named blocker.", "The client is the blocker, and the line says what has been tried and what happens next."],
          ["One line for tomorrow.", "It closes the loop on both changes."],
        ]} />
        <h3>What to cut</h3>
        <p>Billable hours. They belong on the timesheet, where they can be checked and invoiced; in the report they only start an argument about effort.</p>

        <h2 id="bad-report">Sample end-of-day report: a bad one, and how to fix it</h2>
        <h3>The bad report</h3>
        <SampleReport kind="Before" title="Sam, product engineer" lines={lines("bad")} />
        <h3>Line-by-line rewrite</h3>
        <ScrollTable label="The bad report rewritten line by line">
          <table>
            <caption>Each weak line, what is wrong with it, and the rewrite</caption>
            <thead><tr><th scope="col">Before</th><th scope="col">The problem</th><th scope="col">After</th></tr></thead>
            <tbody>
              <tr><td>Hi all! Busy day today.</td><td>Says nothing, and frames the day as effort.</td><td>End-of-day report: Sam, Wednesday</td></tr>
              <tr><td>Worked on lots of things: emails, meetings, the dashboard, some bugs.</td><td>Activity, not change. Nothing a reader can check.</td><td>Changed today: fixed the two dashboard bugs customers reported (both linked)</td></tr>
              <tr><td>Online from 8 to 6, 47 messages sent.</td><td>Hours and counts as proof of work.</td><td>Removed. Hours, if tracked, go on the timesheet.</td></tr>
              <tr><td>Still waiting on some stuff from people.</td><td>No name, no thing; nobody can unblock it.</td><td>Blocked: the export button, waiting on Ben for the new file format</td></tr>
              <tr><td>Will keep going tomorrow.</td><td>No plan, and the real decision is hidden.</td><td>Needs a decision: ship on Friday without the date picker, or wait a week; from Max, by Thursday</td></tr>
            </tbody>
          </table>
        </ScrollTable>
        <SampleReport kind="After" title="Sam, rewritten" lines={lines("rewrite")} />
        <h3>The pattern behind the fix</h3>
        <p>
          Every fix does one of three things: it turns activity into a change, it turns something vague into a name and a date,
          or it brings a hidden decision to the top. The rewrite is shorter than the original and far more useful, which is the
          usual result.
        </p>

        <h2 id="one-line">Sample end-of-day report: the one-line version</h2>
        <SampleReport kind="One line" title="Ada, a quiet day" lines={lines("oneLine")} />
        <h3>When one line is enough</h3>
        <p>
          On a small team that talks every day, or on a day when nothing is waiting on anyone, one line carries everything. It
          still follows the pattern: what changed, what is blocked, what is next, and whether a decision is needed.
        </p>

        <Callout title="Take all seven with you">
          <p>
            <a href={DOWNLOAD_MD} download>Download the end-of-day report template</a> as a file: it holds the three blank
            versions and all seven samples on this page. Or open the <PageLink href="/blog/end-of-day-report-template">copy-and-paste template</PageLink> to
            pick one version.
          </p>
        </Callout>
        <p>
          If writing it every day is the hard part, our free <PageLink href="/free-tools/end-of-day-report-generator">end-of-day report
          generator</PageLink> turns a few notes into the same format. In Boredroom, there is <PageLink href="/features/ai-assistant">an
          assistant that writes the report for you</PageLink>: Brenda writes each team lead&rsquo;s report from what was recorded that day,
          decisions first, with no productivity score and nobody ranked.
        </p>

        <FaqSection path={PATH} items={FAQ} />
      </ArticleBody>
      <CtaBand
        className="mt-8 sm:mt-12"
        label="In Boredroom"
        title="Every lead gets one, written for them"
        sub={<p>Brenda writes each team lead&rsquo;s end-of-day report from the work recorded that day: decisions first, as in the samples, then what changed, then each person&rsquo;s day. Nobody types it, and nobody is ranked.</p>}
        actions={<PrimaryCta secondary={{ href: "/features/end-of-day-report", label: "See Boredroom's end-of-day report" }} />}
        visual={<EndOfDayReportMock />}
      />
      <RelatedLinks title="Keep reading" label="Related" links={[
        { href: "/blog/end-of-day-report", label: "What an end-of-day report is" },
        { href: "/blog/end-of-day-report-template", label: "The end-of-day report template" },
        { href: "/free-tools/end-of-day-report-generator", label: "Generate a report from your notes" },
        { href: "/features/ai-assistant", label: "Let Brenda write it for you" },
      ]} />
    </>
  );
}
