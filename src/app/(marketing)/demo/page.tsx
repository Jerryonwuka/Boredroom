import Link from "next/link";
import { CalendarCheck, FileText, ShieldCheck, UsersRound } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { CardGrid } from "@/components/marketing/card-grid";
import { DemoForm } from "@/components/marketing/demo-form";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { StepGrid } from "@/components/marketing/step-grid";
import { pageMetadata } from "@/lib/marketing/metadata";
import { POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /demo: Book a demo (owner request, 17 November 2026: "on the website, I want us to have book a demo"). The form sits
 * in the hero, so it is the first thing on the page; it sends the request to Boredroom (server/admin/demo.ts), and the
 * team emails the person to agree a time. No calendar is embedded: nothing here promises a slot the team has not agreed.
 * Under it: what happens next, what the demo covers (each a thing Boredroom does today) and the questions.
 *
 * The length ("about 30 minutes") and "a video call" are the owner's to change here if demos run differently.
 */
const PATH = "/demo";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "Does a demo cost anything?",
    answer: "No. The demo is free, and you don't need an account or a card to book one.",
  },
  {
    question: "How long is a demo?",
    answer: "About 30 minutes on a video call, with time for your questions. Tell us in the form if you need longer or want a particular part covered.",
  },
  {
    question: "Who should join the demo?",
    answer: "Whoever would run Boredroom for your team: usually the owner, a team lead or HR. Bring anyone who has questions about what is and isn't tracked.",
  },
  {
    question: "Can I try Boredroom without a demo?",
    answer: "Yes. The Free plan covers one workspace with up to five people, and you can create it yourself whenever Boredroom is open for sign-ups.",
  },
] as const;

export default function DemoPage() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>See Boredroom with someone from the team: the workspace, Brenda and the end-of-day report, on your questions rather than a script.</p>}
        sub={<p>Send the form and we email you to agree a time. About 30 minutes, on a video call, free.</p>}
        points={POSITIONING_POINTS}
        visual={(
          <div className="w-full min-w-0 rounded-[20px] border border-border bg-background p-5 shadow-chart sm:p-6">
            <DemoForm />
          </div>
        )}
      />

      <Section id="next" label="What happens" title="What happens after you send it">
        <StepGrid columns={3} steps={[
          { title: "You send the form", body: <p>Tell us who you are, how big the team is and when suits you. It takes a minute.</p> },
          { title: "We agree a time", body: <p>We email you at the address you gave, with times in your time zone, and send a link for the call.</p> },
          { title: "We show you Boredroom", body: <p>A live walkthrough, with your questions answered as we go. Nothing to install first.</p> },
        ]} />
      </Section>

      <Section id="covers" label="The demo" title="What the demo covers" tone="tint"
        sub="Tell us in the form what matters most and we start there.">
        <CardGrid columns={3} items={[
          { icon: <UsersRound />, title: "The workspace", body: <p>Tasks, timers and updates for the whole team in one place, and what each role sees: owner, HR, team lead and staff.</p> },
          { icon: <BrendaGlyph />, title: "Brenda", body: <p>The <Link href="/features/ai-assistant">AI assistant</Link> every person gets: her morning briefing, her follow-ups and what she can do in your connected apps.</p> },
          { icon: <FileText />, title: "The end-of-day report", body: <p>The <Link href="/features/end-of-day-report">report</Link> Brenda writes for every lead from the day&apos;s work, so nobody has to chase updates.</p> },
          { icon: <CalendarCheck />, title: "Attendance and timesheets", body: <p><Link href="/features/attendance-timesheets">Clock-ins, late arrivals and confirmed hours</Link>, and the timesheet they add up to.</p> },
          { icon: <ShieldCheck />, title: "What is and isn't tracked", body: <p>What staff see about themselves and what a lead sees. There is no productivity score, and no screen or call recording.</p> },
        ]} />
      </Section>

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/pricing", label: "Pricing" },
        { href: "/features", label: "Features" },
      ]} />
    </>
  );
}
