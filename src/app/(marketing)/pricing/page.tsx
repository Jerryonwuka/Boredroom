import Link from "next/link";
import { Ban, Building2, Calculator, CalendarClock, CreditCard, EyeOff, Hourglass, PackageOpen, RotateCcw, UserPlus, UserRound, UsersRound, VideoOff } from "lucide-react";
import { WRAP, FeatureCard, FeatureText } from "@/components/landing/parts";
import { Pricing } from "@/components/landing/pricing";
import { Sources } from "@/components/marketing/blocks";
import { CardGrid, LimitsGrid } from "@/components/marketing/card-grid";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { AttendanceMock, FollowUpMock, RecapMock } from "@/components/marketing/visuals";
import { PLANS, usd as compareUsd } from "@/components/marketing/compare/data";
import { getLaunchState } from "@/components/marketing/launch";
import { landingPlans } from "@/components/marketing/plans";
import {
  FALLBACK_PLANS, PER_SEAT, TEAM_SIZES, everyPlanHas, isFree, limit, limitsSentence, money, planFor, pricingFaq, sameFeatures,
} from "@/components/marketing/tools/pricing-facts";
import type { PublicPlan } from "@/lib/plans";
import { pageMetadata } from "@/lib/marketing/metadata";

/**
 * /pricing as a real page (owner request, 17 October 2026: SEO analysis, Section B: "/pricing must become a real URL";
 * Content Plan page 15, target keyword "remote team management software pricing"). The live plans as the home page shows
 * them (per workspace, the Monthly/Yearly switch, launch-aware buttons), every limit as a number in a table, why the
 * price is per workspace with the cost at 10, 50 and 200 people beside two per-seat prices fetched from the vendors' own
 * pages (cited, dated), what every plan includes, what no plan ever includes, the free plan, trials and billing as the
 * code does them (services/workspace-limit.ts, lib/entitlements.ts, admin/billing*.ts), the FAQ with its FAQPage from
 * the same list, and the pages a buyer compares against. The words and numbers come from the plans table
 * (pricing-facts.ts), so a price change in the Control Center changes the page; FALLBACK_PLANS only when the table
 * can't be read. The SoftwareApplication with the three offers is in the hero's graph (a pricing page is a product page).
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): the pricing template (pages-design spec
 * §5.7): a centred hero with the plan cards straight under it, the plans as cards and their limits as a table (plans as
 * columns, none of them "ours"), why per workspace as two cards over the cost table, what every plan includes with the product
 * pictures, what no plan includes as the limits grid, the free plan and billing as cards, the questions as an accordion
 * (the same FAQPage from the same list), then the pages a buyer compares against. Every word, number and link is kept.
 */
const PATH = "/pricing";
export const metadata = pageMetadata(PATH);

const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-GB")}`;

/** Time Doctor's per-user prices, from the comparison pages' data so /pricing and /compare agree (review fix, 17 October 2026). */
const TIME_DOCTOR_PRICES = (() => {
  const m = [PLANS.timedoctorBasicMonthly, PLANS.timedoctorStandardMonthly, PLANS.timedoctorPremiumMonthly].map((p) => compareUsd(p.perPerson));
  const y = [PLANS.timedoctorBasicAnnual, PLANS.timedoctorStandardAnnual, PLANS.timedoctorPremiumAnnual].map((p) => compareUsd(p.perPerson));
  return `${m[0]}, ${m[1]} or ${m[2]} a month billed monthly, or ${y[0]}, ${y[1]} or ${y[2]} billed annually`;
})();

/** "Free: 1 workspace, 5 people, 2 GB" / "Pro: US$15 a month, 5 workspaces, 50 people, 150 GB" */
function planHeading(p: PublicPlan): string {
  const parts = [
    !isFree(p) ? `${money(p.monthly_price, p.currency)} a month` : "",
    p.max_workspaces === null && p.max_users === null && p.max_storage_bytes === null ? "unlimited workspaces, people and storage" : [
      `${limit.workspaces(p).toLowerCase()} workspace${p.max_workspaces === 1 ? "" : "s"}`,
      `${limit.people(p).toLowerCase()} people`,
      p.max_storage_bytes === null ? "unlimited storage" : limit.storage(p),
    ].join(", "),
  ].filter(Boolean);
  return `${p.name}: ${parts.join(", ")}`;
}

function planLine(p: PublicPlan): string {
  if (isFree(p)) return `For a small team trying Boredroom out, or a team of up to ${p.max_users ?? "any number of"} people that needs nothing more. No card and no end date.`;
  const yearly = `${money(p.annual_price, p.currency)} a year if you pay yearly`;
  const trial = p.trial_days ? ` A ${p.trial_days}-day free trial.` : "";
  if (p.max_users === null) return `For a company of teams: ${limitsSentence(p)}. ${yearly}.${trial}`;
  return `For a team of up to ${p.max_users} people, or several teams in up to ${p.max_workspaces ?? "any number of"} workspaces, each priced on its own. ${yearly}.${trial}`;
}

/** A plan card's icon by its place in the price order: one person's team, several teams, a company of them. */
function planIcon(p: PublicPlan) {
  if (isFree(p)) return <UserRound />;
  return p.max_users === null ? <Building2 /> : <UsersRound />;
}

/** The three pictures in "What's included" share one height from 1024px, the taller ones cut with the peek fade, so the
 *  three titles sit on one line (review fix, 17 October 2026). Below 1024px the cards stack and keep their full pictures. */
const PEEK = "mk-peek min-w-0 [--peek-h:9999px] lg:h-[300px] lg:overflow-hidden lg:[--peek-h:300px]";

export default async function PricingPage() {
  const [{ signedIn, waitlist, maintenance }, live] = await Promise.all([getLaunchState(), landingPlans()]);
  const plans = live.length ? live : FALLBACK_PLANS;
  const sorted = [...plans].sort((a, b) => a.monthly_price - b.monthly_price);
  const free = sorted.find(isFree);
  const faq = pricingFaq(sorted);
  const same = sameFeatures(sorted);
  const every = (flag: string) => everyPlanHas(sorted, flag);
  // "10 months' price for 12", said only when every paid plan has the same yearly deal.
  const paidMonths = [...new Set(sorted.filter((p) => !isFree(p) && p.monthly_price > 0).map((p) => Math.round(p.annual_price / p.monthly_price)))];
  const yearlyMonths = paidMonths.length === 1 && paidMonths[0] < 12 ? paidMonths[0] : null;
  const pro = sorted.find((p) => !isFree(p) && p.max_users !== null);
  const trials = sorted.filter((p) => p.trial_days);

  return (
    <>
      <ProductHero path={PATH} layout="center" compact
        lead={<p>Start free with one workspace. Move to Pro when you run several teams, or to Enterprise when you run a company of them. Every plan is priced per workspace, not per person, and every limit is on this page.</p>}
        actions={<PrimaryCta secondary={{ href: "#per-workspace", label: "Cost at 10, 50 and 200 people" }} />} />

      <div className={`${WRAP} mt-6 sm:mt-8`}>
        <Pricing plans={plans} waitlist={waitlist} maintenance={maintenance} signedIn={signedIn} />
      </div>

      <Section id="plans" label="The plans" title="Plans and pricing" align="center" sub={same ? "Three plans with the same features. They differ in how many workspaces, people and files they hold." : "Three plans, priced per workspace. They differ in what they hold and what they turn on."}>
        <CardGrid columns={3} items={sorted.map((p) => ({ icon: planIcon(p), title: planHeading(p), body: <p>{planLine(p)}</p> }))} />
        <ComparisonTable className="mt-12" label="The plans side by side" rowHeader="Limit" layout="matrix" minWidth="36rem"
          caption="The plans side by side, per workspace, in US dollars"
          columns={sorted.map((p) => ({ key: p.code, label: p.name }))}
          rows={[
            { label: "Price, paid monthly", cells: Object.fromEntries(sorted.map((p) => [p.code, isFree(p) ? "Free" : `${money(p.monthly_price, p.currency)} a month`])) },
            { label: "Price, paid yearly", cells: Object.fromEntries(sorted.map((p) => [p.code, isFree(p) ? "Free" : `${money(p.annual_price, p.currency)} a year`])) },
            { label: "Workspaces you can own", cells: Object.fromEntries(sorted.map((p) => [p.code, limit.workspaces(p)])) },
            { label: "People per workspace", cells: Object.fromEntries(sorted.map((p) => [p.code, limit.people(p)])) },
            { label: "File storage", cells: Object.fromEntries(sorted.map((p) => [p.code, limit.storage(p)])) },
            { label: "Free trial", cells: Object.fromEntries(sorted.map((p) => [p.code, isFree(p) ? "Not needed" : p.trial_days ? `${p.trial_days} days` : "None"])) },
            { label: "Card needed", cells: Object.fromEntries(sorted.map((p) => [p.code, isFree(p) ? "No" : "To pay for the plan"])) },
          ]}
          footnote={<p className="lp-text">{yearlyMonths ? `Paying yearly costs ${yearlyMonths} months' price for 12. ` : ""}Joining someone else&apos;s workspace is always free.</p>} />
      </Section>

      <Section id="per-workspace" label="Per workspace" title="Why we charge per workspace, not per person"
        sub="A team shouldn't have to think about the bill before inviting the person who'd answer the question.">
        <CardGrid columns={2} items={[
          { icon: <UsersRound />, title: "What per-seat pricing does to a growing team", body: <p>Per-seat pricing charges for every person, so the bill grows with every hire, and every invitation becomes a small budget decision. The people most easily left out are the ones a team needs now and then: the contractor, the part-timer, the person in another team who answers the odd question. A workspace price stays the same as the team grows, until the workspace reaches its plan&apos;s limit.</p> },
          { icon: <Calculator />, title: "The cost at 10, 50 and 200 people", body: <p>Boredroom is priced for one workspace holding the whole team. Beside it, two per-seat prices as the vendors list them on their own pricing pages: ActivTrak&apos;s cheapest paid plan and Hubstaff&apos;s Team plan, both $10 a person a month billed annually (Hubstaff&apos;s Team plan is $12 billed monthly). They aren&apos;t like-for-like products, so the price is only part of the comparison; the comparison pages cover what each one does.</p> },
        ]} />
        <ComparisonTable className="mt-12" label="Monthly cost at 10, 50 and 200 people" rowHeader="People" layout="matrix" minWidth="48rem"
          caption="Monthly cost at 10, 50 and 200 people, as of 17 October 2026"
          columns={[
            { key: "monthly", label: "Boredroom, paid monthly", ours: true },
            { key: "yearly", label: "Boredroom, paid yearly (a month)", ours: true },
            ...PER_SEAT.map((v) => ({ key: v.vendor, label: `${v.vendor} ${v.plan} ($${v.perSeat / 100} ${v.basis})` })),
          ]}
          rows={TEAM_SIZES.map((n) => {
            const p = planFor(sorted, n);
            return {
              label: String(n),
              cells: {
                monthly: p ? `${isFree(p) ? "Free" : money(p.monthly_price, p.currency)} (${p.name})` : "Talk to us",
                yearly: p ? (isFree(p) ? "Free" : money(Math.round(p.annual_price / 12), p.currency)) : "Talk to us",
                ...Object.fromEntries(PER_SEAT.map((v) => [v.vendor, usd(v.perSeat * n)])),
              },
            };
          })}
          footnote={<Sources className="text-meta" items={[
            { title: "ActivTrak pricing", publisher: "ActivTrak", url: "https://www.activtrak.com/pricing/", asOf: "2026-10-17" },
            { title: "Hubstaff pricing (Team plan, monthly and annual billing)", publisher: "Hubstaff", url: "https://hubstaff.com/pricing", asOf: "2026-10-17" },
            { title: "Time Doctor pricing", publisher: "Time Doctor", url: "https://www.timedoctor.com/pricing", asOf: "2026-10-17" },
          ]} />} />
        <p className="lp-text mk-links mt-10 max-w-3xl">{pro ? `A ${pro.name} workspace holds up to ${pro.max_users} people, so 200 people in one workspace is an Enterprise workspace. ` : ""}ActivTrak also has a free plan for up to 3 workers, sells annual plans only, and asks for a paid support plan above 50 licences. Time Doctor prices per user too: {TIME_DOCTOR_PRICES}. See how Boredroom compares to <Link href="/compare/boredroom-vs-activtrak">ActivTrak</Link>, <Link href="/compare/boredroom-vs-hubstaff">Hubstaff</Link> and <Link href="/compare/boredroom-vs-time-doctor">Time Doctor</Link>, or <Link href="/compare/employee-monitoring-software">compare the alternatives</Link> side by side.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <PrimaryCta secondary={{ href: "/free-tools/end-of-day-report-generator", label: "Try the free report generator" }} />
        </div>
      </Section>

      <Section id="included" label="Every plan" align="center" title={same ? "What's included in every plan" : "What the plans include"} sub={same ? "The whole product on every plan: the limits are the only difference." : undefined}>
        <div className="grid gap-3 lg:grid-cols-3">
          <FeatureCard>
            <div className={PEEK}><AttendanceMock /></div>
            <FeatureText title="Attendance and timesheets">Clock-ins against the schedule you set, late arrivals by the minute, and timesheets that count only confirmed time. A correction counts once a lead approves it, and the CSV export adds up to the same totals.</FeatureText>
          </FeatureCard>
          <FeatureCard order={1}>
            <div className={PEEK}><FollowUpMock /></div>
            <FeatureText title="Brenda, the AI assistant">{every("AI_ASSISTANT") ? "Every person gets their own Brenda, on every plan." : "Every person on a plan with the AI assistant gets their own Brenda."} She knows their day, answers follow-ups from real work, and asks before acting unless they choose otherwise.</FeatureText>
          </FeatureCard>
          <FeatureCard order={2}>
            <div className={PEEK}><RecapMock /></div>
            <FeatureText title="Consent-based call notes">Calls, with screen sharing, are on every plan. Brenda takes notes only for the people who say yes, each choosing Include me or Not me, written down on their own device. The transcript is deleted 7 days after the recap.</FeatureText>
          </FeatureCard>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FeatureCard>
            <FeatureText title="End-of-day reports" className="mt-0">At the end of each day Brenda writes a report for every team lead: decisions waiting on them first, then what changed since yesterday, hours and attendance. Plain counts, nobody ranked. Try the <Link href="/free-tools/end-of-day-report-generator" className="link-inline">free end-of-day report generator</Link> to see the shape.</FeatureText>
          </FeatureCard>
          <FeatureCard order={1}>
            <FeatureText title="Privacy and security" className="mt-0">Each company&apos;s workspace is sealed from every other by row-level security. Everyone can read the monitoring notice in their profile. Chats with Brenda are private to their person, and a reviewer can&apos;t approve their own submission.</FeatureText>
          </FeatureCard>
        </div>
        <p className="lp-text mt-8 text-center">More on <Link href="/features/ai-assistant" className="link-inline">Brenda, the AI assistant for teams</Link>.</p>
      </Section>

      <Section id="never" label="Never" title="What's never included, at any price" sub="No plan, add-on or setting turns these on." align="center" tone="tint">
        <LimitsGrid columns={3} badge="At any price" items={[
          { icon: <Ban />, title: "No productivity score", body: <p>Timers, heartbeats and logins are never treated as proof of work. Reports give plain counts, and nobody is ranked. Read how <Link href="/solutions/monitoring-without-scores">monitoring without a productivity score</Link> works.</p> },
          { icon: <EyeOff />, title: "No screen recording", body: <p>Boredroom doesn&apos;t record screens. Where your organisation allows it, Brenda for Mac sees a screen only when its person asks her to, with her keys or her Look button, and never keeps what she sees.</p> },
          { icon: <VideoOff />, title: "No call recording", body: <p>Calls are never recorded. Their sound and video pass through our video provider only to reach the people on the call. See how <Link href="/features/call-notes">consent-based call notes</Link> work instead.</p> },
        ]} />
      </Section>

      <Section id="free-plan" label="Free" title="How the free plan works" align="center">
        <CardGrid columns={3} items={[
          { icon: <PackageOpen />, title: "What you get", body: <p>{free ? `${limitsSentence(free).replace(/^./, (c) => c.toUpperCase())}.` : "A workspace to start with."}{same ? " The same features as the paid plans, Brenda and calls included." : ""}</p> },
          { icon: <UserPlus />, title: "What happens when you outgrow it", body: <p>{free?.max_users ? `When a Free workspace has ${free.max_users} people, Boredroom won't add another and says which plan has room. ` : ""}The owner or HR moves the workspace to a paid plan in its settings; nothing needs to be set up again.</p> },
          { icon: <CreditCard />, title: "No card needed", body: <p>Free asks for no card and has no end date. A card comes in only when you choose a paid plan.</p> },
        ]} />
      </Section>

      <Section id="billing" label="Billing" title="Trials and billing" align="center" className="pt-0 sm:pt-0">
        <CardGrid columns={3} items={[
          { icon: <Hourglass />, title: `How the ${trials.map((p) => `${p.trial_days}-day`).join(" and ") || "free"} trials work`, body: <p>{trials.map((p) => `${p.name} comes with a ${p.trial_days}-day free trial`).join(", and ") || "Trials are arranged with us"}. During a trial the workspace has the plan&apos;s full limits, so you can try it with your real team.</p> },
          { icon: <CalendarClock />, title: "What happens at the end of a trial", body: <p>Owners are told before a trial or a paid plan ends. If it isn&apos;t paid for, the workspace moves to Free&apos;s limits after a short grace period. Nothing is deleted: the people, tasks, timesheets and documents stay, and paying later brings the plan back.</p> },
          { icon: <RotateCcw />, title: "Cancelling", body: <p>There&apos;s no contract. Paid plans are paid a month or a year at a time through Paystack, and owners are reminded 14, 7, 3 and 1 day before a plan renews or ends. The owner or HR can move the workspace back to Free in its settings at any time; Boredroom asks first, because the paid limits end at once.</p> },
        ]} />
      </Section>

      <FaqAccordion path={PATH} items={faq} label="Questions" />

      <RelatedLinks title="Before you choose" label="Keep exploring" links={[
        { href: "/features/ai-assistant", label: "AI assistant for teams" },
        { href: "/solutions/monitoring-without-scores", label: "No productivity score, at any price" },
        { href: "/compare/employee-monitoring-software", label: "Compare the alternatives" },
        { href: "/compare/boredroom-vs-activtrak", label: "How Boredroom compares to ActivTrak" },
        { href: "/compare/boredroom-vs-hubstaff", label: "How Boredroom compares to Hubstaff" },
        { href: "/compare/boredroom-vs-time-doctor", label: "How Boredroom compares to Time Doctor" },
        { href: "/free-tools/end-of-day-report-generator", label: "Try the free report generator" },
      ]} />
    </>
  );
}
