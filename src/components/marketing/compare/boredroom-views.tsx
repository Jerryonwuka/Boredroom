import { FeatureCard, FeatureText } from "@/components/landing/parts";
import { AttendanceMock, MyDayMock, ReportsMock } from "@/components/marketing/visuals";
import { Section } from "@/components/marketing/section";

/**
 * What Boredroom looks like to the people in it (owner request, 17 October 2026: SEO analysis; the Content Plan asks for
 * "screenshots of the interface, with alt text"). Boredroom has no screenshots to show: these are the landing page's
 * coded views of the product, each a role="img" with its own description. Other vendors' interfaces are not shown: we
 * have no right to their screenshots, and the pages link to their own sites instead.
 *
 * Three cards: what a staff member sees (My Day), what a lead sees (attendance), and what the hours are made of
 * (confirmed time, not activity). `intro` is the line under the heading, written per page.
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred head with a neutral label chip, the three product cards across
 * the full width from 1024px (two-then-one is avoided: one column below that, centred).
 */
export function BoredroomViews({ id = "what-boredroom-looks-like", title = "What Boredroom looks like to the people using it", label = "In the product", intro, tone }: {
  id?: string;
  title?: string;
  label?: string;
  intro: React.ReactNode;
  tone?: "plain" | "tint";
}) {
  return (
    <Section id={id} label={label} title={title} sub={intro} align="center" tone={tone}>
      <div className="mx-auto grid max-w-xl gap-3 lg:max-w-none lg:grid-cols-3">
        <FeatureCard>
          <MyDayMock />
          <FeatureText title="What a staff member sees">My Day: their to-dos, the timer they started, and Done. No activity bar, no score, no screenshots of them waiting for review.</FeatureText>
        </FeatureCard>
        <FeatureCard order={1}>
          <AttendanceMock />
          <FeatureText title="What a lead sees">Clock-ins against the schedule the workspace set, late arrivals by the minute, the month at a glance.</FeatureText>
        </FeatureCard>
        <FeatureCard order={2}>
          <ReportsMock />
          <FeatureText title="What the hours are made of">Confirmed time from the timers people start and stop. A gap is asked about, not counted against anyone.</FeatureText>
        </FeatureCard>
      </div>
    </Section>
  );
}
