import { HubPage } from "@/components/marketing/hub-page";
import { ReportPreview, WorkHoursPreview } from "@/components/marketing/tools/tool-previews";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /free-tools: the section's index (owner request, 17 October 2026: SEO analysis, Section B). The registry lists the
 * tools and the hub's cross-links; the intro says the one thing every tool here shares: it runs in the browser, with no
 * sign-up, no AI and nothing sent or kept.
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred hero with the tools' facts as check chips, the two tools as large
 * cards under the line they share ("They run in your browser", its words kept), each led by a still of the tool's own
 * result (tool-previews.tsx: review fix, the cards were text only), then the cross-links.
 */
const PATH = "/free-tools";
export const metadata = pageMetadata(PATH);

export default function Page() {
  return (
    <HubPage
      path={PATH}
      lead={<p>Two free tools for the sums and the writing a remote team does every day: hours worked, with breaks and overtime, and the end-of-day report. No sign-up and no email.</p>}
      actions={null}
      points={["No sign-up", "Nothing leaves your browser", "Free"]}
      grid={{
        label: "Both tools",
        title: "They run in your browser",
        sub: <p>Each tool works on your device. Nothing you type is sent to Boredroom or anyone else, and nothing is kept: reload the page and it&apos;s gone. Copy or download the result to keep it.</p>,
        columns: 2,
      }}
      visuals={{
        "/free-tools/work-hours-calculator": <WorkHoursPreview />,
        "/free-tools/end-of-day-report-generator": <ReportPreview />,
      }}
    />
  );
}
