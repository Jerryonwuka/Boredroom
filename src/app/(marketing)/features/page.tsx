import Link from "next/link";
import { FileText, Laptop, MessagesSquare } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { HubPage } from "@/components/marketing/hub-page";
import { Section } from "@/components/marketing/section";
import { AttendanceMock, CallCard, EndOfDayReportMock, FollowUpMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_LINE } from "@/lib/marketing/site";

/**
 * /features: the section's index (owner request, 17 October 2026: SEO analysis, Section B). An intro with the entity
 * sentence and what is in the product (every item built; checked against the home page's sections the same day), then
 * the section's pages from the registry and the hub's cross-links. Owner: the product group.
 *
 * Pages v2 (owner feedback, 17 October 2026: product pages, not documents): a centred hero, every feature as a card with
 * its product picture, what else the workspace holds (the intro's unlinked items) as cards, then the cross-links. The
 * intro's words and links are kept, in the body.
 */
const PATH = "/features";
export const metadata = pageMetadata(PATH);

export default function Page() {
  return (
    <HubPage path={PATH} secondary={{ href: "/pricing", label: "See pricing" }}
      grid={{
        label: "All features",
        title: "Four features, one workspace",
        sub: <p>{ENTITY_SENTENCE} Everything a remote team needs to plan the day, do the work and show it is done sits in one workspace. {POSITIONING_LINE}</p>,
        columns: 2,
      }}
      visuals={{
        "/features/ai-assistant": <FollowUpMock />,
        "/features/attendance-timesheets": <AttendanceMock />,
        "/features/call-notes": <CallCard />,
        "/features/end-of-day-report": <EndOfDayReportMock />,
      }}
      after={
        <Section id="workspace" label="In one workspace" title="Also in the workspace" align="center"
          sub={<p><Link href="/features/ai-assistant">Brenda, a personal AI assistant</Link> for every person, <Link href="/features/attendance-timesheets">attendance and timesheets</Link> with confirmed time only, <Link href="/features/end-of-day-report">the end-of-day report</Link> written by Brenda for every lead, and <Link href="/features/call-notes">calls with consent-based AI meeting notes</Link> sit beside the rest of the work.</p>}>
          <CardGrid columns={3} items={[
            { icon: <MessagesSquare />, title: "Messages", body: "A direct thread with anyone, a channel per team, and voice notes." },
            { icon: <FileText />, title: "Docs", body: "For briefs, SOPs and notes, written alone or with Brenda." },
            { icon: <Laptop />, title: "Brenda desktop", body: "Brenda in the Mac's notch, or at the top of the screen on Windows." },
          ]} />
        </Section>
      }
    />
  );
}
