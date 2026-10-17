import { ArticleBody } from "@/components/marketing/article";
import { ArticleHeader } from "@/components/marketing/article-header";
import { Callout, Definition, PullQuote, ScrollTable, Sources, type Source } from "@/components/marketing/blocks";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqSection } from "@/components/marketing/faq-section";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks } from "@/components/marketing/related-links";
import { StatBand } from "@/components/marketing/stat-band";
import { ReportsMock } from "@/components/marketing/visuals";
import { BarFigure } from "@/components/marketing/blog/bar-figure";
import { Cite, PageLink } from "@/components/marketing/blog/parts";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, formatDate } from "@/lib/marketing/site";

/**
 * /blog/remote-work-productivity-statistics: what published research says about remote work and productivity (owner
 * request, 17 October 2026: SEO analysis; Content Plan page 5, target keywords "work from home productivity statistics"
 * and "remote work productivity statistics"). Data-led: every figure on the page was read at its source on 17 October
 * 2026 (the lead's rule: only facts fetched from a primary or reputable source during the run, cited with a visible
 * link and an as-of date; nothing invented, nothing unsourced). The statistics table, three charts (BarFigure: each
 * bar labelled in text, captioned), the "how to read this" warning, a methodology section and the positioning line.
 *
 * Left out because they could not be verified at the source on 17 October 2026: the APA's 2023 Work in America figures
 * on monitoring (the site blocked the request), the ICO's own October 2023 news release (404; its figures are cited from
 * the Manchester Law Society's publication of the release), Choudhury et al.'s patent-examiner study and the QJE
 * version of the Ctrip paper (403; the NBER working paper was read instead), and WFH Research's latest survey figures
 * (connection refused).
 *
 * Owner feedback, 17 October 2026: pages v2. A designed header with no cover: three of the post's own headline figures
 * under it instead (each exactly as in the statistics table, with its source link and date), the readable article
 * unchanged, then a product band (monitoring without scores) and the related cards.
 */
const PATH = "/blog/remote-work-productivity-statistics";
export const metadata = pageMetadata(PATH);

const AS_OF = "2026-10-17";

const SRC = {
  ctrip: { title: "Does Working from Home Work? Evidence from a Chinese Experiment (NBER Working Paper 18871)", publisher: "Nicholas Bloom, James Liang, John Roberts and Zhichun Jenny Ying, National Bureau of Economic Research", url: "https://www.nber.org/papers/w18871", asOf: AS_OF, published: "March 2013", note: "Later published in the Quarterly Journal of Economics." },
  tripcom: { title: "Hybrid working from home improves retention without damaging performance", publisher: "Nicholas Bloom, Ruobing Han and James Liang, Nature 630, 920–925", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11208135/", asOf: AS_OF, published: "June 2024" },
  gibbs: { title: "Work from Home & Productivity: Evidence from Personnel & Analytics Data on IT Professionals", publisher: "Michael Gibbs, Friederike Mengel and Christoph Siemroth, Becker Friedman Institute, University of Chicago", url: "https://bfi.uchicago.edu/working-paper/work-from-home-productivity-evidence-from-personnel-analytics-data-on-it-professionals/", asOf: AS_OF, published: "July 2021" },
  atkin: { title: "Working from Home, Worker Sorting and Development (NBER Working Paper 31515)", publisher: "David Atkin, Antoinette Schoar and Sumit Shinde, National Bureau of Economic Research", url: "https://www.nber.org/papers/w31515", asOf: AS_OF, published: "July 2023, revised December 2023" },
  commute: { title: "Time Savings When Working from Home (NBER Working Paper 30866)", publisher: "Cevat Giray Aksoy, Jose Maria Barrero, Nicholas Bloom, Steven J. Davis, Mathias Dolls and Pablo Zarate, National Bureau of Economic Research", url: "https://www.nber.org/papers/w30866", asOf: AS_OF, published: "January 2023" },
  atus: { title: "American Time Use Survey: 2025 results", publisher: "U.S. Bureau of Labor Statistics", url: "https://www.bls.gov/news.release/atus.nr0.htm", asOf: AS_OF, published: "25 June 2026" },
  ons: { title: "Who are the hybrid workers?", publisher: "Office for National Statistics", url: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/articles/whoarethehybridworkers/2024-11-11", asOf: AS_OF, published: "11 November 2024" },
  paranoia: { title: "Hybrid Work Is Just Work. Are We Doing It Wrong? (Work Trend Index Pulse Report)", publisher: "Microsoft WorkLab", url: "https://www.microsoft.com/en-us/worklab/work-trend-index/hybrid-work-is-just-work", asOf: AS_OF, published: "22 September 2022", note: "Survey of 20,006 knowledge workers in 11 countries, July to August 2022." },
  wti2023: { title: "Will AI Fix Work? (2023 Work Trend Index)", publisher: "Microsoft WorkLab", url: "https://www.microsoft.com/en-us/worklab/work-trend-index/will-ai-fix-work", asOf: AS_OF, published: "9 May 2023", note: "Survey of 31,000 people in 31 countries." },
  wti2025: { title: "Breaking down the infinite workday (Work Trend Index special report)", publisher: "Microsoft WorkLab", url: "https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday", asOf: AS_OF, published: "17 June 2025", note: "Anonymised Microsoft 365 telemetry to 15 February 2025, and a survey of 31,000 workers." },
  mark: { title: "The Cost of Interrupted Work: More Speed and Stress (CHI 2008)", publisher: "Gloria Mark, Daniela Gudith and Ulrich Klocke, University of California, Irvine and Humboldt University of Berlin", url: "https://ics.uci.edu/~gmark/chi08-mark.pdf", asOf: AS_OF, published: "2008" },
  epm: { title: "A meta-analysis of the effects of electronic performance monitoring on work outcomes", publisher: "Daniel M. Ravid, Jerod C. White, David L. Tomczak, Ahleah F. Miles and Tara S. Behrend, Personnel Psychology 76, 5–40", url: "https://doi.org/10.1111/peps.12514", asOf: AS_OF, published: "2023" },
  // Review fix, 17 October 2026: cite the ICO's own release, not a repost. ico.org.uk has answered 404 for it since
  // February 2026 (Wayback Machine captures), so the link is the Internet Archive's copy of the ICO page from 15 November 2025.
  ico: { title: "ICO publishes guidance to ensure lawful monitoring in the workplace", publisher: "Information Commissioner's Office (archived copy, Internet Archive)", url: "https://web.archive.org/web/20251115001711/https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2023/10/ico-publishes-guidance-to-ensure-lawful-monitoring-in-the-workplace", asOf: AS_OF, published: "3 October 2023", note: "Survation survey of 1,012 UK adults, 1 to 3 August 2023, commissioned by the ICO. The ICO has since taken the page down." },
} satisfies Record<string, Source>;

type Row = { stat: string; figure: string; year: string; source: Source; label: string };

const STATS: Row[] = [
  { stat: "Performance change when call-centre staff worked from home full time (9-month randomised trial, Ctrip)", figure: "+13%", year: "2013", source: SRC.ctrip, label: "Bloom et al., NBER" },
  { stat: "Performance gain once staff could choose where to work (same firm, after the trial)", figure: "+22%", year: "2013", source: SRC.ctrip, label: "Bloom et al., NBER" },
  { stat: "Quit rate with two days a week at home vs. full time in the office (6-month randomised trial, 1,612 Trip.com staff)", figure: "4.80% vs. 7.20% (a third lower)", year: "2024", source: SRC.tripcom, label: "Bloom, Han and Liang, Nature" },
  { stat: "Effect of the same hybrid schedule on performance grades over two years of reviews", figure: "No significant difference", year: "2024", source: SRC.tripcom, label: "Bloom, Han and Liang, Nature" },
  { stat: "Managers' estimate of hybrid working's effect on productivity, before and after the trial", figure: "−2.6% before, +1.0% after", year: "2024", source: SRC.tripcom, label: "Bloom, Han and Liang, Nature" },
  { stat: "Productivity change when 10,000+ IT professionals worked from home (hours up, output slightly down)", figure: "−8% to −19%", year: "2021", source: SRC.gibbs, label: "Gibbs, Mengel and Siemroth, BFI" },
  { stat: "Rise in hours worked outside normal business hours, same study", figure: "+18%", year: "2021", source: SRC.gibbs, label: "Gibbs, Mengel and Siemroth, BFI" },
  { stat: "Productivity of data-entry workers randomly assigned to work from home vs. the office (India)", figure: "18% lower", year: "2023", source: SRC.atkin, label: "Atkin, Schoar and Shinde, NBER" },
  { stat: "Average commuting time saved per day worked from home (27 countries)", figure: "72 minutes", year: "2023", source: SRC.commute, label: "Aksoy et al., NBER" },
  { stat: "Share of that saved time spent on the job", figure: "40%", year: "2023", source: SRC.commute, label: "Aksoy et al., NBER" },
  { stat: "Employed people in the US who did some or all of their work at home on days they worked", figure: "35%", year: "2025", source: SRC.atus, label: "BLS, American Time Use Survey" },
  { stat: "Working adults in Great Britain who were hybrid working (autumn 2024)", figure: "28%", year: "2024", source: SRC.ons, label: "ONS" },
  { stat: "Employees who say they are productive at work", figure: "87%", year: "2022", source: SRC.paranoia, label: "Microsoft Work Trend Index" },
  { stat: "Leaders who say they have full confidence their team is productive", figure: "12%", year: "2022", source: SRC.paranoia, label: "Microsoft Work Trend Index" },
  { stat: "People who say they lack enough uninterrupted focus time in the workday", figure: "68%", year: "2023", source: SRC.wti2023, label: "Microsoft Work Trend Index" },
  { stat: "Share of time spent communicating rather than creating", figure: "57% vs. 43%", year: "2023", source: SRC.wti2023, label: "Microsoft Work Trend Index" },
  { stat: "How often the most-interrupted fifth of users are interrupted by meetings, emails or chats during core work hours", figure: "Every 2 minutes", year: "2025", source: SRC.wti2025, label: "Microsoft Work Trend Index" },
  { stat: "Change in meetings starting after 8 pm, year on year", figure: "+16%", year: "2025", source: SRC.wti2025, label: "Microsoft Work Trend Index" },
  { stat: "Studies pooled in a meta-analysis of electronic performance monitoring; evidence it improves performance", figure: "94 samples, 23,461 people; none found", year: "2023", source: SRC.epm, label: "Ravid et al., Personnel Psychology" },
  { stat: "People in the UK who would find monitoring at work intrusive", figure: "70%", year: "2023", source: SRC.ico, label: "ICO research" },
  { stat: "People who would feel comfortable taking a new job if they knew they would be monitored", figure: "19%", year: "2023", source: SRC.ico, label: "ICO research" },
];

/** Three of the headline figures for the band under the header: the same figures, words and sources as STATS. */
const HEADLINE = [
  { label: "Performance change, call-centre staff working from home", value: "+13%", source: SRC.ctrip, cite: "Bloom et al., NBER, 2013" },
  { label: "Quit rate, two days at home vs. full time in the office", value: "4.80% vs. 7.20%", source: SRC.tripcom, cite: "Bloom, Han and Liang, Nature, 2024" },
  { label: "Employees who say they are productive vs. leaders fully confident they are", value: "87% vs. 12%", source: SRC.paranoia, cite: "Microsoft Work Trend Index, 2022" },
];

const TOC = [
  { id: "short-answer", label: "The short answer" },
  { id: "at-a-glance", label: "Statistics at a glance" },
  { id: "output-vs-activity", label: "Output vs. activity" },
  { id: "hours", label: "Hours worked" },
  { id: "focus", label: "Focus and deep work" },
  { id: "trust", label: "Trust and visibility" },
  { id: "scores", label: "Why productivity scores fail" },
  { id: "measure", label: "Measuring without scoring" },
  { id: "faq", label: "FAQ" },
  { id: "methodology", label: "Methodology and sources" },
];

const FAQ = [
  {
    question: "Does remote work increase productivity?",
    answer: "Sometimes, and it depends on the work and the arrangement. A randomised trial of call-centre staff found a 13% performance gain from working at home, a trial of hybrid working at Trip.com found no difference in performance and a third fewer resignations, and studies of IT professionals and data-entry workers found productivity fell. There is no single number that answers the question.",
  },
  {
    question: "Is hybrid work more productive than working in the office?",
    answer: "The strongest evidence so far is a six-month randomised trial of 1,612 Trip.com employees, published in Nature in 2024: two days a week at home made no significant difference to performance grades over two years of reviews, while quit rates fell by a third.",
  },
  {
    question: "Does employee monitoring improve productivity?",
    answer: "A 2023 meta-analysis of 94 samples and 23,461 people in Personnel Psychology found no evidence that electronic performance monitoring improves performance, and found it is associated with more stress. Organisations that monitored more transparently and less invasively saw more positive attitudes from workers.",
  },
];

export default function Page() {
  return (
    <>
      <ArticleHeader
        path={PATH}
        after={<StatBand items={HEADLINE.map((h) => ({
          label: h.label,
          value: h.value,
          note: <><Cite href={h.source.url}>{h.cite}</Cite>, checked <time dateTime={AS_OF}>{formatDate(AS_OF)}</time></>,
        }))} />}
      />
      <ArticleBody toc={TOC}>
        <Definition term="The short answer:" label="Summary">
          working from home neither reliably raises nor lowers productivity. Controlled studies have found gains of 13%, no
          difference, and falls of 8% to 19%, depending on the job, the arrangement and what was measured. What the research does
          agree on is that how you measure work changes what you find.
        </Definition>
        <p>
          This page collects work from home productivity statistics from published research and official surveys. Every figure
          links to its source and was checked there on 17 October 2026. Where studies disagree, we show both sides rather than
          pick the one that suits an argument.
        </p>

        <h2 id="short-answer">The short answer: does remote work increase productivity?</h2>
        <h3>What the aggregate research says</h3>
        <p>
          The most quoted early result comes from a nine-month randomised trial at Ctrip, a Chinese travel agency, where call-centre
          volunteers who worked from home performed 13% better; about 9 points came from working more minutes per shift and 4
          from more calls per minute in a quieter place. When the firm then let staff choose where to work, the gain rose to 22%
          (<Cite href={SRC.ctrip.url}>Bloom et al., NBER, 2013</Cite>).
        </p>
        <p>
          The best recent evidence on hybrid working is a six-month randomised trial of 1,612 employees at Trip.com in 2021 and
          2022. Two days a week at home made no significant difference to performance grades over the next two years of reviews,
          or to promotions, and cut quit rates by a third (<Cite href={SRC.tripcom.url}>Bloom, Han and Liang, Nature, 2024</Cite>).
        </p>
        <BarFigure
          title="Quit rates in the Trip.com hybrid working trial"
          legend={[{ label: "Two days a week at home", tone: "accent" }, { label: "Full time in the office", tone: "neutral" }]}
          min={0}
          max={10}
          rows={[
            { label: "All employees", values: [{ series: "Hybrid", value: 4.8, display: "4.80%", tone: "accent" }, { series: "Office", value: 7.2, display: "7.20%" }] },
            { label: "Non-managers", values: [{ series: "Hybrid", value: 5.33, display: "5.33%", tone: "accent" }, { series: "Office", value: 8.59, display: "8.59%" }] },
            { label: "Women", values: [{ series: "Hybrid", value: 4.18, display: "4.18%", tone: "accent" }, { series: "Office", value: 9.19, display: "9.19%" }] },
            { label: "Longer commutes (above the median)", values: [{ series: "Hybrid", value: 2.89, display: "2.89%", tone: "accent" }, { series: "Office", value: 6.0, display: "6.00%" }] },
          ]}
          caption={<>Share of employees who quit during the six-month trial, by group: lower with the hybrid schedule in every group shown. Source: <Cite href={SRC.tripcom.url}>Bloom, Han and Liang, Nature, June 2024</Cite>.</>}
        />
        <h3>Where the research disagrees</h3>
        <p>
          Other careful studies point the other way. At a large Asian IT services company, more than 10,000 professionals worked
          longer hours from home, including 18% more outside normal business hours, while their output fell slightly, so
          productivity per hour dropped by 8% to 19% (<Cite href={SRC.gibbs.url}>Gibbs, Mengel and Siemroth, 2021</Cite>). In a
          randomised trial of data-entry workers in India, those assigned to work from home were 18% less productive than those in
          the office (<Cite href={SRC.atkin.url}>Atkin, Schoar and Shinde, NBER, 2023</Cite>).
        </p>
        <BarFigure
          title="Measured effect of working from home on productivity, by study"
          min={-25}
          max={25}
          rows={[
            { label: "Call-centre staff, full time at home", note: "Ctrip, randomised trial (2013)", values: [{ value: 13, display: "+13%" }] },
            { label: "Same firm, once staff could choose", note: "Ctrip, after the trial (2013)", values: [{ value: 22, display: "+22%" }] },
            { label: "Two days a week at home", note: "Trip.com, randomised trial: performance grades (2024)", values: [{ value: 0, display: "No difference" }] },
            { label: "IT professionals, full time at home", note: "Asian IT services firm: output per hour (2021)", values: [{ from: -8, value: -19, display: "−8% to −19%" }] },
            { label: "Data-entry workers, assigned to home", note: "India, randomised trial (2023)", values: [{ value: -18, display: "−18%" }] },
          ]}
          caption={<>Five results from four studies of different jobs and measures, so the bars are not directly comparable: that is the point. Sources: <Cite href={SRC.ctrip.url}>Bloom et al. 2013</Cite>, <Cite href={SRC.tripcom.url}>Bloom, Han and Liang 2024</Cite>, <Cite href={SRC.gibbs.url}>Gibbs et al. 2021</Cite>, <Cite href={SRC.atkin.url}>Atkin et al. 2023</Cite>.</>}
        />
        <h3>Why the question is harder to answer than it looks</h3>
        <p>
          Three things change the answer. The job: counting calls or keystrokes is easy, judging a designer&rsquo;s week is not. The
          arrangement: full time at home, two days a week and &ldquo;whenever you like&rdquo; are different treatments. And who chooses:
          the India study found that people who preferred home work were faster at baseline but lost more productivity at home,
          so studies where people pick their own arrangement measure selection as well as the arrangement.
        </p>

        <h2 id="at-a-glance">Remote work productivity statistics at a glance</h2>
        <h3>The headline numbers (table)</h3>
        <ScrollTable label="Remote work productivity statistics with sources">
          <table>
            <caption>Every figure on this page, with its year and source (checked 17 October 2026)</caption>
            <thead><tr><th scope="col">Statistic</th><th scope="col">Figure</th><th scope="col">Year</th><th scope="col">Source</th></tr></thead>
            <tbody>
              {STATS.map((r) => (
                <tr key={r.stat}>
                  <td>{r.stat}</td>
                  <td className="whitespace-nowrap font-medium text-foreground tabular-nums">{r.figure}</td>
                  <td className="tabular-nums">{r.year}</td>
                  <td><Cite href={r.source.url}>{r.label}</Cite></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
        <h3>How to read them</h3>
        <Callout title="Before you quote a number">
          <p>
            These figures come from different countries, jobs, years and methods. A randomised trial in one company is strong
            evidence about that company and weaker evidence about yours. Surveys measure what people say, telemetry measures what
            software sees, and neither measures output. Quote the figure with its source and year, and if you only quote the
            result that supports your view, say that other studies found otherwise.
          </p>
        </Callout>

        <h2 id="output-vs-activity">Output-based vs. activity-based measurement</h2>
        <h3>Why most productivity statistics measure the wrong thing</h3>
        <p>
          Much of what gets reported as productivity is activity: hours online, messages sent, meetings attended, minutes with a
          keyboard in use. Activity is easy to count because software records it anyway. But the IT study above shows the gap:
          hours went up and output did not. A measure that rewards being visibly busy will find remote workers busy, and say
          little about whether anything got done.
        </p>
        <h3>What changes when you measure output</h3>
        <p>
          The studies with the clearest results measured output directly: calls handled at Ctrip, records entered in the India
          trial, performance grades and promotions at Trip.com. Output measures are harder to build for knowledge work, but
          they ask the right question. For most teams the practical version is simple: what was finished, what was handed on, and
          what is stuck.
        </p>

        <h2 id="hours">What the data says about hours worked</h2>
        <h3>Working hours in remote vs. office settings</h3>
        <p>
          Working from home is now ordinary. In the US, 35% of employed people did some or all of their work at home on days they
          worked in 2025, and 51% of those with a bachelor&rsquo;s degree or higher did (<Cite href={SRC.atus.url}>BLS American Time Use
          Survey, June 2026</Cite>). In Great Britain, 28% of working adults were hybrid working in autumn 2024 (<Cite href={SRC.ons.url}>ONS,
          November 2024</Cite>). Where hours have been measured closely, remote work tends to stretch them rather than shrink
          them: the IT professionals worked 18% more outside normal business hours.
        </p>
        <h3>Meeting load and the calendar problem</h3>
        <p>
          People spend 57% of their time communicating, in meetings, email and chat, and 43% creating, according to
          Microsoft&rsquo;s 2023 survey of 31,000 people, which also named inefficient meetings the top disruptor of productivity
          (<Cite href={SRC.wti2023.url}>Work Trend Index, May 2023</Cite>). By 2025 its telemetry showed meetings starting after
          8 pm up 16% year on year, driven by work across time zones (<Cite href={SRC.wti2025.url}>Work Trend Index, June 2025</Cite>).
          Teams that move routine updates into writing, such as <PageLink href="/blog/asynchronous-standup">asynchronous
          standups</PageLink>, are attacking exactly this.
        </p>
        <h3>The commute-time reallocation</h3>
        <p>
          A survey across 27 countries found that working from home saves an average of 72 minutes a day in commuting, and that
          people give about 40% of that time back to their jobs and about 11% to caregiving (<Cite href={SRC.commute.url}>Aksoy et
          al., NBER, January 2023</Cite>). Some of the extra hours in remote work are, in other words, commute time turned into work
          time. If you want to see where your own hours go, our free <PageLink href="/free-tools/work-hours-calculator">work hours
          calculator</PageLink> adds them up from start, finish and break times.
        </p>

        <h2 id="focus">What the data says about focus and deep work</h2>
        <h3>Interruption frequency</h3>
        <p>
          Microsoft&rsquo;s 2025 telemetry found that the most-interrupted fifth of users (by the number of pings they receive) were
          interrupted by a meeting, email or chat every two minutes during core work hours, which it adds up to 275 times a day (<Cite href={SRC.wti2025.url}>Work Trend Index,
          June 2025</Cite>). In its 2023 survey, 68% of people said they did not have enough uninterrupted focus time in the
          workday (<Cite href={SRC.wti2023.url}>Work Trend Index, May 2023</Cite>). The IT study found the same pattern in its own
          data: time in meetings and coordination rose while uninterrupted work hours shrank considerably.
        </p>
        <h3>The cost of context switching</h3>
        <p>
          In a laboratory study, people who were interrupted finished their tasks in less time with no loss of quality, but
          reported more stress, frustration, time pressure and effort (<Cite href={SRC.mark.url}>Mark, Gudith and Klocke, CHI
          2008</Cite>). Interruptions do not always show up as lost output; they can show up as a more tiring day instead, which a
          productivity count will never see.
        </p>
        <h3>Why &ldquo;always available&rdquo; is not the same as productive</h3>
        <p>
          The same 2025 report found that by 10 pm, 29% of active workers were back in their inboxes. Being reachable late is
          activity, and it is easy to mistake for commitment. The studies that measured output found no sign that it is the same
          thing.
        </p>

        <h2 id="trust">What the data says about team trust and visibility</h2>
        <h3>The visibility gap</h3>
        <p>
          In a 2022 survey of 20,006 people in 11 countries, 87% of employees said they were productive at work, but only 12% of
          leaders said they had full confidence that their team was productive, and 85% of leaders said hybrid work had made it
          hard to be confident that people were being productive (<Cite href={SRC.paranoia.url}>Microsoft Work Trend Index,
          September 2022</Cite>). Microsoft called it &ldquo;productivity paranoia&rdquo;.
        </p>
        <BarFigure
          title="The visibility gap: how employees and leaders see productivity"
          min={0}
          max={100}
          rows={[
            { label: "Employees who say they are productive at work", values: [{ value: 87, display: "87%" }] },
            { label: "Leaders with full confidence their team is productive", values: [{ value: 12, display: "12%" }] },
            { label: "Leaders who say hybrid work made that confidence hard", values: [{ value: 85, display: "85%" }] },
          ]}
          caption={<>Survey of 20,006 knowledge workers in 11 countries, July to August 2022. Source: <Cite href={SRC.paranoia.url}>Microsoft Work Trend Index Pulse Report, September 2022</Cite>.</>}
        />
        <h3>Why managers default to surveillance</h3>
        <p>
          When leaders cannot see work, they reach for what they can see, and their expectations run ahead of the evidence.
          Before the Trip.com trial, managers expected hybrid working to cut productivity by 2.6% on average; after it, their
          estimate was a gain of 1.0% (<Cite href={SRC.tripcom.url}>Bloom, Han and Liang, 2024</Cite>). The worry came first and the
          data corrected it.
        </p>
        <h3>What the data says about surveillance and outcomes</h3>
        <p>
          A meta-analysis of 94 samples covering 23,461 people found no evidence that electronic performance monitoring improves
          performance. Monitoring was associated with more stress whatever form it took, and organisations that monitored more
          transparently and less invasively saw more positive attitudes from workers (<Cite href={SRC.epm.url}>Ravid et al.,
          Personnel Psychology, 2023</Cite>). Public opinion is in the same place: in research for the UK&rsquo;s Information
          Commissioner&rsquo;s Office, 70% of people said they would find monitoring at work intrusive, and only 19% would feel comfortable
          taking a new job if they knew they would be monitored (<Cite href={SRC.ico.url}>ICO, October 2023</Cite>). For how
          monitoring tools differ on this, see our <PageLink href="/compare/employee-monitoring-software">employee monitoring software
          comparison</PageLink>.
        </p>

        <h2 id="scores">The measurement trap: why productivity scores fail</h2>
        <h3>What a productivity score actually measures</h3>
        <p>
          A productivity score turns activity into a number: active minutes, apps used, keystrokes, time on sites someone has
          labelled productive. It measures how work looks to software, not what it produced, which is the gap the IT study
          found between hours and output.
        </p>
        <h3>The gaming problem</h3>
        <p>
          Once a number is used to judge people, people work on the number. A score based on activity rewards staying visibly
          busy, being online late and answering quickly, and it penalises the long, quiet stretches where hard problems get
          solved. The people best at their jobs are rarely the ones best at looking busy.
        </p>
        <h3>The trust cost</h3>
        <p>
          The monitoring meta-analysis found more stress and no performance gain. The ICO research found that most people find
          monitoring intrusive and few would choose a job that comes with it. A score that costs trust and buys no output is a
          bad trade, however precise it looks.
        </p>

        <h2 id="measure">How to measure remote productivity without scoring people</h2>
        <h3>Measure outcomes, not activity</h3>
        <p>
          Count what was finished, sent for review and delivered, and how long work waits on other people. These are the things a
          lead can change. If you track hours, keep them as hours, confirmed by the person, for pay and planning, not as a
          judgement.
        </p>
        <h3>Ask, don&rsquo;t infer</h3>
        <p>
          If you want to know why something is late, ask the person, and make asking cheap. Inferring effort from screen time or
          mouse movement replaces a two-line answer with a guess. An honest &ldquo;blocked on the client&rdquo; tells you more than any
          activity graph.
        </p>
        <h3>The end-of-day report as a measurement substitute</h3>
        <p>
          A short daily <PageLink href="/blog/end-of-day-report">end-of-day report</PageLink> gives a lead the facts a score pretends
          to: what changed, what is blocked and on whom, and what needs their decision, in the team&rsquo;s own words and records. {ENTITY_SENTENCE} Brenda
          writes that report for every team lead from the work recorded that day, with plain counts, nobody ranked, and no screen
          or call recording behind it. That is what <PageLink href="/solutions/monitoring-without-scores">monitoring without
          productivity scores</PageLink> looks like in practice, and it is one part of the <PageLink href="/features/ai-assistant">AI
          assistant for teams</PageLink> every person gets.
        </p>
        <PullQuote>No productivity score, no screen recording, no call recording.</PullQuote>

        <FaqSection path={PATH} items={FAQ} />

        <h2 id="methodology">Methodology and sources</h2>
        <h3>How these figures were compiled</h3>
        <p>
          We used peer-reviewed papers, working papers from the National Bureau of Economic Research and the Becker Friedman
          Institute, official statistics from the US Bureau of Labor Statistics and the UK Office for National Statistics,
          Microsoft&rsquo;s published Work Trend Index research, and research commissioned by the UK Information Commissioner&rsquo;s Office.
          Each figure was read at the source linked below on 17 October 2026 and is quoted as the source states it, with its own
          caveats. We left out figures we could not check at a primary source that day. Boredroom makes software in this
          area; none of these sources is connected to us.
        </p>
        <h3>Last updated</h3>
        <p>17 October 2026. We will update the page when the sources publish new figures.</p>
        <Sources items={Object.values(SRC)} />
      </ArticleBody>
      <CtaBand
        className="mt-8 sm:mt-12"
        label="In Boredroom"
        title="Measure the work, not the activity"
        sub={<p>Leads see confirmed hours, finished work and blockers as plain facts, and Brenda writes each lead&rsquo;s end-of-day report from the work recorded that day. No productivity score, and nobody ranked.</p>}
        actions={<PrimaryCta secondary={{ href: "/solutions/monitoring-without-scores", label: "Monitoring without scores, in practice" }} />}
        visual={<ReportsMock />}
      />
      <RelatedLinks title="Keep reading" label="Related" links={[
        { href: "/solutions/monitoring-without-scores", label: "Employee monitoring without productivity scores" },
        { href: "/compare/employee-monitoring-software", label: "Compare employee monitoring software" },
        { href: "/blog/asynchronous-standup", label: "Async standups: a practical guide" },
        { href: "/blog/end-of-day-report", label: "The end-of-day report guide" },
        { href: "/features/ai-assistant", label: "An AI assistant for every person" },
        { href: "/free-tools/work-hours-calculator", label: "Free work hours calculator" },
      ]} />
    </>
  );
}
