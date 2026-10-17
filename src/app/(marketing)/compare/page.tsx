import Link from "next/link";
import { CalendarCheck, ListChecks, ShieldCheck } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { AS_OF, HUB_ORDER, TOOLS } from "@/components/marketing/compare/data";
import { HubPage } from "@/components/marketing/hub-page";
import { Section } from "@/components/marketing/section";
import { VersusLockup } from "@/components/marketing/versus-lockup";
import { pageMetadata } from "@/lib/marketing/metadata";
import { formatDate } from "@/lib/marketing/site";

/**
 * /compare: the section's index (owner request, 17 October 2026: SEO analysis, Section B). The compare group's intro says
 * how the comparisons are made (the same nine questions, vendors' own pages, a date on every fact); the cards and the
 * hub's cross-links come from the registry.
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred hero, the category comparison as the wide card, the three
 * head-to-heads each with its "Boredroom vs …" lockup (names only, no other company's logo), then how the comparisons
 * are made as three cards (the intro's words, its link kept).
 */
const PATH = "/compare";
export const metadata = pageMetadata(PATH);

/** A head-to-head card's picture: the lockup on the canvas. */
function Versus({ them }: { them: string }) {
  return (
    <div aria-hidden className="grid h-36 place-items-center rounded-2xl border border-border bg-background">
      <VersusLockup them={them} size="sm" />
    </div>
  );
}

/** The category card's picture: the six tools it compares, by name (no logos). */
function SixTools() {
  return (
    <div role="img" aria-label={`The six tools compared: ${HUB_ORDER.map((id) => TOOLS[id].name).join(", ")}.`} className="rounded-2xl border border-border bg-background p-5">
      <div aria-hidden>
        <p className="text-sm font-semibold text-foreground">Six tools, nine questions</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {HUB_ORDER.map((id) => (
            <li key={id} className="flex h-10 items-center justify-center rounded-xl border border-border bg-fill-0 px-3 text-sm font-medium text-foreground">{TOOLS[id].name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <HubPage path={PATH} secondary={{ href: "/pricing", label: "Boredroom pricing" }}
      grid={{
        label: "Every comparison",
        title: "The category, then head to head",
        sub: <p>Start with the <Link href="/compare/employee-monitoring-software">overview of the whole category</Link>, or go straight to a head-to-head.</p>,
      }}
      featured="/compare/employee-monitoring-software" featuredSpan="row"
      visuals={{
        "/compare/employee-monitoring-software": <SixTools />,
        "/compare/boredroom-vs-activtrak": <Versus them={TOOLS.activtrak.name} />,
        "/compare/boredroom-vs-hubstaff": <Versus them={TOOLS.hubstaff.name} />,
        "/compare/boredroom-vs-time-doctor": <Versus them={TOOLS.timedoctor.name} />,
      }}
      after={
        <Section id="method" label="How we compare" title="The same questions, from the vendors' own pages" align="center" tone="tint">
          <CardGrid columns={3} items={[
            { icon: <ListChecks />, title: "The same nine questions", body: "What a tool records, whether it scores people, whether calls are recorded, who knows it is running, how it handles attendance and timesheets, whether each person gets an AI assistant, how it is priced, what you can try for free, and who it suits." },
            { icon: <ShieldCheck />, title: "The vendors' own pages", body: "Facts about other products come from their own pricing and help pages, linked on each page. We say plainly where another tool is the better choice." },
            { icon: <CalendarCheck />, title: "A date on every fact", body: <>Every fact about another product was read on <time dateTime={AS_OF}>{formatDate(AS_OF)}</time>, and each page says so beside it.</> },
          ]} />
        </Section>
      }
    />
  );
}
