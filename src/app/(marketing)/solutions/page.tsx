import Link from "next/link";
import { EyeOff, ShieldCheck, VideoOff } from "lucide-react";
import { LimitsGrid } from "@/components/marketing/card-grid";
import { HubPage } from "@/components/marketing/hub-page";
import { Section } from "@/components/marketing/section";
import { FollowUpMock, ReportsMock, StandupCardMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE, POSITIONING_LINE, POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /solutions: the section's index (owner request, 17 October 2026: SEO analysis, Section B). An intro on the problem the
 * section solves (visibility into a remote team without surveillance), then the section's pages from the registry and
 * the hub's cross-links. Owner: the product group.
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred hero, the problem (the intro, its links kept), every solution as
 * a card led by its product picture (review fix: the cards were icon-only), and the three things Boredroom never does
 * (the positioning line as limits, in the home page's words).
 */
const PATH = "/solutions";
export const metadata = pageMetadata(PATH);

/** The positioning line's three points, each with the home page's own words for it (app/page.tsx FAIR). */
const NEVER: Record<(typeof POSITIONING_POINTS)[number], { icon: React.ReactNode; body: string }> = {
  "No productivity score": { icon: <ShieldCheck />, body: "Timers, heartbeats and logins are never treated as proof of work. Reports give plain counts, and nobody is ranked." },
  "No screen recording": { icon: <EyeOff />, body: "Boredroom doesn't record screens. Brenda for Mac sees your screen only when you press her keys, and never keeps what she sees." },
  "No call recording": { icon: <VideoOff />, body: "Calls are never recorded. Brenda takes notes only for the people who say yes, written down on their own device." },
};

export default function Page() {
  return (
    <HubPage path={PATH} secondary={{ href: "/pricing", label: "Plans and prices" }}
      visuals={{
        "/solutions/monitoring-without-scores": <ReportsMock />,
        "/solutions/stop-chasing-updates": <FollowUpMock />,
        "/solutions/fewer-status-meetings": <StandupCardMock />,
      }}
      grid={{ label: "Every solution", title: "Visibility without surveillance", sub: <p>Three problems remote leads know well, and how Boredroom answers each one from the work itself.</p> }}
      after={
        <Section id="never" label="The limits" title="What Boredroom never does" align="center" tone="tint">
          <LimitsGrid columns={3} items={POSITIONING_POINTS.map((p) => ({ title: p, icon: NEVER[p].icon, body: NEVER[p].body }))} />
        </Section>
      }>
      <Section id="problem" label="The problem" title="Knowing what a remote team is doing, without watching it" width="text">
        <div className="lp-sub mk-links space-y-5">
          <p>Leading a remote team means knowing who is in, what is being worked on, what is finished and what is stuck. Activity-based monitoring tools answer it by measuring input: keyboard and mouse use, the apps and websites open, sometimes screenshots. {ENTITY_SENTENCE} It answers from the work itself: the tasks people plan, the timers they start and the work they submit.</p>
          <p>{POSITIONING_LINE} Start with <Link href="/solutions/monitoring-without-scores">what employee monitoring without productivity scores looks like</Link>, including what Boredroom records and what it never does. Then see how to <Link href="/solutions/stop-chasing-updates">stop chasing your team for updates</Link> and how to <Link href="/solutions/fewer-status-meetings">replace status meetings with async updates</Link>.</p>
        </div>
      </Section>
    </HubPage>
  );
}
