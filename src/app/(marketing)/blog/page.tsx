import { HubPage } from "@/components/marketing/hub-page";
import { Section } from "@/components/marketing/section";
import { PageLink } from "@/components/marketing/blog/parts";
import { EndOfDayReportMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /blog: the section's index (owner request, 17 October 2026: SEO analysis, Section B). Lists the section's pages from the
 * registry and the hub's cross-links, with a short intro from the blog group: where to start, and the rule the posts keep
 * (every outside figure linked to its source with the date it was checked).
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred hero, the end-of-day report guide as the wide card with the
 * report Brenda writes, the other guides as cards, then "Where to start" (the intro, its words and links kept).
 */
const PATH = "/blog";
export const metadata = pageMetadata(PATH);

export default function Page() {
  return (
    <HubPage path={PATH} secondary={{ href: "/features/end-of-day-report", label: "The report Brenda writes" }}
      grid={{ label: "Every guide", title: "Reports, standups and the research" }}
      featured="/blog/end-of-day-report"
      visuals={{ "/blog/end-of-day-report": <EndOfDayReportMock /> }}
      after={
        <Section id="start" label="Where to start" title="New to written updates?" width="text">
          <div className="lp-sub mk-links space-y-5">
            <p>
              Plain, practical guides for running a remote team without watching it. New to written updates? Start with
              the <PageLink href="/blog/end-of-day-report">guide to end-of-day reports</PageLink>, then take
              the <PageLink href="/blog/end-of-day-report-template">free template</PageLink> or adapt one of
              the <PageLink href="/blog/sample-end-of-day-report">seven sample reports</PageLink>. Running a standup across time zones?
              The <PageLink href="/blog/asynchronous-standup">async standup guide</PageLink> has three templates to copy.
            </p>
            <p>
              Every figure we quote from someone else links to its source, with the date we checked it. The <PageLink href="/blog/remote-work-productivity-statistics">remote
              work productivity statistics</PageLink> collect them in one table.
            </p>
          </div>
        </Section>
      }
    />
  );
}
