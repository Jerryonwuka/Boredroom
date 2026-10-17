import Link from "next/link";
import { BellRing, Bot, FileText, Radio, ShieldCheck, Users } from "lucide-react";
import { CardGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { SplitSection } from "@/components/marketing/split-section";
import { StepGrid } from "@/components/marketing/step-grid";
import { PricingSection, ProductCta, SEE_PRICING } from "@/components/marketing/product/parts";
import { CallCard, EndOfDayReportMock, HeroCluster, RecapMock } from "@/components/marketing/visuals";
import { pageMetadata } from "@/lib/marketing/metadata";
import { POSITIONING_POINTS } from "@/lib/marketing/site";

/**
 * /features/call-notes: team calls with consent-based AI meeting notes (review fix, 17 October 2026: SEO analysis,
 * Section B's starting count of 4 feature pages; the home page's #calls section in full).
 *
 * Built behaviour only, checked 17 October 2026 against server/services/calls.ts (who may call or join is who may write
 * in the conversation; owners, HR and team leads get no extra access to anyone's calls; a group call rings the people
 * who are online and available, not in quiet hours or another call), call-notes.ts (no notes without each person's own
 * yes; no audio leaves a device; only the people on the call read the lines; deleted 7 days after the recap; owners and
 * HR can switch notes off for the workspace), call-recap.ts (summary, decisions and action items from the lines of the
 * people who said yes only; sent to everyone who joined; a short version in the call's thread; each action item a
 * commitment its person must accept; someone who said Not me is never an owner), the home page's CALLS, FAIR and faq().
 * The video provider is not named on the site, so it is not named here. No recording, no integrations: none exist.
 *
 * Pages v2 (owner feedback, 17 October 2026: "like actual product pages, like the homepage"): the feature template
 * (spec §5.1): a split hero with a live call (its clock ticks; Pause under it), calls as cards, the notes as four steps
 * on a tinted band, the recap beside Brenda's notes, where the words go as four cards on a tinted band, the call to
 * action with the report the action items reach, notes vs a recording as a table, the live plans, the FAQ and related
 * cards. Every h2, every h3 that heads content, every link and its words are kept; the TOC is gone (V11).
 */
const PATH = "/features/call-notes";
export const metadata = pageMetadata(PATH);

const FAQ = [
  {
    question: "Does Boredroom record calls?",
    answer: "No. Calls are never recorded. Their sound and video pass through the video provider only to reach the people on the call. If someone turns on Brenda's notes, only the words of people who say Include me are turned into text, on their own device.",
  },
  {
    question: "What happens if one person says Not me?",
    answer: "Their words are never written down, and the notes carry on for everyone who said Include me. Someone who said Not me, or didn't answer, is never given an action item from the recap.",
  },
  {
    question: "How long are call transcripts kept?",
    answer: "Only the people who were on the call can read its transcript, and it is deleted 7 days after the recap. The recap itself, a summary with the decisions and the action items, goes to everyone who joined, and a short version goes into the call's thread.",
  },
  {
    question: "Can my team lead read the transcript of a call they weren't on?",
    answer: "No. Who can call or join is exactly who can write in that conversation, and only the people on the call can read its transcript. Owners, HR and team leads get no extra access to anyone's calls.",
  },
];

export default function Page() {
  return (
    <>
      <ProductHero path={PATH}
        lead={<p>Call anyone you can message, or ring the whole team from its channel, and share your screen.</p>}
        sub={<p>When you want notes, Brenda takes them only for the people who say Include me, written down on their own device.</p>}
        actions={<PrimaryCta secondary={SEE_PRICING} />}
        points={POSITIONING_POINTS}
        visual={<HeroCluster primary={<CallCard live />} pause
          caption="A call in #Design with Ada and Ben, 12 minutes in, with Brenda taking notes from both of them." />}
      />

      <Section id="calls" label="Calls" title="Calls for the whole team, on every plan"
        sub={<p>Calls start from the conversations people already have. Call someone from your direct thread with them, or start a group call from a team channel or a named channel. Who can call or join is exactly who can write in that conversation, so nobody is added to a call they couldn&apos;t read.</p>}>
        <CardGrid columns={2} items={[
          { icon: <BellRing />, title: "Ringing in the browser and in Brenda desktop", body: <p>A group call rings the people in the conversation who are online and available: not in quiet hours, not set to Do not disturb and not already on another call. Calls ring in the browser and in Brenda desktop, so people can accept or decline without finding the tab. Anyone on the call can share their screen.</p> },
          { icon: <ShieldCheck />, title: "No extra access for managers", body: <p>Owners, HR and team leads get no extra access to anyone&apos;s calls. A lead joins a call the same way everyone else does: by being in the conversation.</p> },
        ]} />
      </Section>

      <Section id="how-notes-work" label="Consent first" title="How consent-based AI meeting notes work" align="center" tone="tint"
        sub={<p>Nobody&apos;s words are written down without their own yes.</p>}>
        <StepGrid columns={4} steps={[
          { title: "Someone turns on Brenda's notes", body: <p>Anyone on the call can switch them on, where the workspace offers them, and switching them on counts as that person&apos;s own yes. Owners and HR can switch notes off for the whole workspace.</p> },
          { title: "Each person chooses Include me or Not me", body: <p>Everyone on the call is asked. No answer counts as no, and only the words of people who agree are written down.</p> },
          { title: "Words become text on each person's own device", body: <p>Each person&apos;s browser turns their own words into text. No audio is sent for transcription, and the call itself is never recorded.</p> },
          { title: "After the call, everyone who joined gets the recap", body: <p>A summary, the decisions and the action items, written from the notes of the people who said yes.</p> },
        ]} />
      </Section>

      <SplitSection id="recap" label="After the call" title="The recap: decisions and action items"
        sub={<>
          <p>After the call, Brenda sends everyone who joined a summary, the decisions and the action items, and a short version goes into the call&apos;s thread. Each action item with an owner becomes a commitment that waits for its person to accept it: nothing lands on anyone&apos;s list without their yes, and someone who said Not me is never given one.</p>
          <p>Accepted items show up where the rest of the work is: in the person&apos;s to-dos, and in their lead&apos;s <Link href="/features/end-of-day-report">automatic end-of-day report</Link> under commitments.</p>
        </>}
        visual={<RecapMock />}
        visualCaption="Brenda's notes from a call in #Design: a summary, one decision and two action items, each waiting for its person to accept."
      />

      <Section id="privacy" label="Privacy" title="Where the words go" align="center" tone="tint"
        sub={<p>The same rules run through the rest of the product: no screen recording, no call recording and no productivity score. Read how that works for a whole team in <Link href="/solutions/monitoring-without-scores">monitoring without productivity scores</Link>.</p>}>
        <CardGrid columns={4} items={[
          { icon: <FileText />, title: "Only text", body: <p>Only text reaches Boredroom: the lines each consenting person&apos;s own device wrote from their own microphone.</p> },
          { icon: <Users />, title: "Only the people on the call", body: <p>Only the people who were on the call can read the transcript, and it is deleted 7 days after the recap.</p> },
          { icon: <Bot />, title: "Only to write the recap", body: <p>Brenda runs on Claude: the notes of the people who agree are sent to Anthropic to write the recap.</p> },
          { icon: <Radio />, title: "Only passing through", body: <p>The call&apos;s sound and video pass through the video provider only to reach the people on the call.</p> },
        ]} />
      </Section>

      <ProductCta title="Calls on every plan, notes only with a yes"
        sub={<p>Accepted action items land in each person&apos;s to-dos and in their lead&apos;s end-of-day report.</p>}
        visual={<EndOfDayReportMock />} />

      <Section id="compared" label="Compared" title="AI meeting notes compared with recording the call"
        sub={<p>Recording a call keeps everything everyone said, whether or not they wanted it kept. Boredroom&apos;s notes keep less, by design.</p>}>
        <ComparisonTable layout="versus" label="Consent-based notes compared with a call recording"
          caption="Consent-based notes in Boredroom compared with a recording of the call"
          columns={[{ key: "recording", label: "A recording of the call" }, { key: "notes", label: "Brenda's notes in Boredroom", ours: true }]}
          rows={[
            { label: "Whose words are kept", cells: { recording: "Everyone who spoke", notes: "Only people who said Include me" } },
            { label: "What leaves each device", cells: { recording: "Audio, and often video", notes: "Text, written on the person's own device" } },
            { label: "How long it lasts", cells: { recording: "Until someone deletes it", notes: "The transcript is deleted 7 days after the recap" } },
            { label: "What people get afterwards", cells: { recording: "A file to watch or search", notes: "A summary, decisions and action items to accept" } },
          ]}
        />
        <p className="lp-text mk-links mt-8 max-w-2xl">Some meetings only exist to share status. Those you may not need at all: see how to <Link href="/solutions/fewer-status-meetings">replace status meetings with async updates</Link>.</p>
      </Section>

      <PricingSection link={{ href: "/pricing", label: "Compare the plans" }}
        sub={<><p>Calls, screen sharing and Brenda&apos;s notes are on every plan, including Free, along with <Link href="/features/ai-assistant">Brenda, the AI assistant for every person</Link>.</p><p>Prices are per workspace, not per person.</p></>} />

      <FaqAccordion path={PATH} items={FAQ} label="Questions" />

      <RelatedLinks title="Keep reading" label="Keep exploring" links={[
        { href: "/features/ai-assistant", label: "Brenda, an AI assistant for every person" },
        { href: "/features/end-of-day-report", label: "The end-of-day report Brenda writes" },
        { href: "/solutions/fewer-status-meetings", label: "Fewer status meetings" },
        { href: "/solutions/monitoring-without-scores", label: "Monitoring without a productivity score" },
        { href: "/pricing", label: "Plans and prices" },
      ]} />
    </>
  );
}
