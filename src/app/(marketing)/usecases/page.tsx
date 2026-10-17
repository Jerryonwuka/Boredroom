import Link from "next/link";
import { Building2, User, UsersRound } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { HubPage } from "@/components/marketing/hub-page";
import { Section } from "@/components/marketing/section";
import { BrendaHomePanel } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";

/**
 * /usecases: the section's index (owner request, 17 October 2026: SEO analysis, Section B). An intro on the product's four
 * real roles (owner, HR, team lead, staff) and what each gets, then the section's pages from the registry (team leads
 * so far) and the hub's cross-links. Owner: the product group.
 *
 * Pages v2 (owner feedback, 17 October 2026): a centred hero, the team leads' page as a wide card with a lead's Brenda
 * home, then every role in one workspace as cards (the intro's list, its words and link kept).
 */
const PATH = "/usecases";
export const metadata = pageMetadata(PATH);

export default function Page() {
  return (
    <HubPage path={PATH} secondary={{ href: "/pricing", label: "What it costs" }}
      grid={{ label: "By role", title: "Boredroom for team leads", columns: 2 }}
      featured="/usecases/team-leads"
      visuals={{ "/usecases/team-leads": <BrendaHomePanel cards={0} /> }}
      after={
        <Section id="roles" label="Every role" title="Every role, one workspace" align="center"
          sub={<p>{ENTITY_SENTENCE} Everyone in a workspace has one of four roles, and each gets something different from it.</p>}>
          <CardGrid columns={3} items={[
            { icon: <UsersRound />, title: "Team leads", body: <>Team leads get answers to &ldquo;any update?&rdquo; from their people&apos;s work, one standup rollup a day, reviews of work and time corrections, and an end-of-day report about their teams. Read <Link href="/usecases/team-leads">how team leads use Boredroom</Link>.</> },
            { icon: <Building2 />, title: "Owners and HR", body: "Owners and HR set the schedule and the rules, see attendance for everyone, and can get the end-of-day report for the whole organisation." },
            { icon: <User />, title: "Staff", body: "Staff plan the day in one line, press Start and Done, and have their own Brenda who answers follow-ups for them. Their chats with her are theirs alone." },
          ]} />
        </Section>
      }
    />
  );
}
