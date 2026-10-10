import Link from "next/link";
import { CalendarDays, ChartPie, CircleQuestionMark, CreditCard, ListTodo, MessageSquare, ShieldCheck, Target, Timer, Users } from "lucide-react";
import { MotionRoot } from "@/components/ui/motion";
import { Badge } from "@/components/ui/badge";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { ToolSquare } from "@/components/ui/tool-tile";
import { Hero, heroButton } from "@/components/landing/hero";
import { QuestionsMarquee } from "@/components/landing/marquee";
import { JoinDemo } from "@/components/landing/join-demo";
import { DayDemo } from "@/components/landing/day-demo";
import { Panels } from "@/components/landing/panels";
import { AttendanceMock, MyDayMock, ReportsMock } from "@/components/landing/mocks";
import { MessagesDemo } from "@/components/landing/messages-demo";
import { DashboardDemo } from "@/components/landing/dashboard-demo";
import { Moments } from "@/components/landing/moments";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/footer";
import { FeatureCard, FeatureText, SectionTitle, WRAP } from "@/components/landing/parts";
import { publicPlans } from "@/server/services/pricing";
import { getCurrentUser } from "@/server/auth";
import { launchSettings, landingSettings } from "@/server/admin/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Boredroom · Know what your remote team is doing" };

/*
  The public landing page, design system v4 (owner request, 6 October 2026): the app's own language on the dark
  canvas. Display headlines in Geist 400, 18/28 secondary lines, hairline cards (r16–r28, 20–24px in), and product
  views built from the real v4 parts (the app frame on Brenda's home, stat cards, the analytics card with its orange
  highlight, a table, underline tabs, the segmented control) instead of screenshots or 3D icons. Orange follows the
  accent rules: the one standout per screen is the waitlist call to action (waitlist mode) or nothing; everything else
  orange is a live, active or chosen mark inside a product view. Light theme follows the toggle (the v4 tokens).
*/

const WAYS_IN = ["Join code", "Join link", "Email invitation", "Teams", "Team leads", "Owner", "HR", "Staff", "One workspace per company", "Sealed from every other"];

// The fairness rules (owner decisions, 8 October 2026: phase 8, A.3.2): screens and calls are never recorded; Brenda's
// notes on a call are each person's own choice, written on their own device, and gone 7 days after the recap.
const FAIR: { icon: Icon3DName; t: string; d: string }[] = [
  { icon: "shield-check", t: "Nothing is recorded", d: "Boredroom doesn't record screens, and calls are never recorded. Their sound and video only pass through to the people on the call." },
  { icon: "flag-alert", t: "No productivity score", d: "Timers, heartbeats and logins are never treated as proof of work." },
  { icon: "stopwatch", t: "Uncertain time gets a question", d: "A gap leads to a clarification request, not a penalty." },
  { icon: "video-people", t: "Notes only with consent", d: "Brenda takes notes on a call only for the people who say yes. Anyone can say \"Not me\" and their words are left out." },
  { icon: "person-laptop", t: "Words stay on your device", d: "Each person's own device writes down their words. No audio is sent for transcription or kept." },
  { icon: "calendar-clock", t: "Transcripts don't linger", d: "A call's transcript is deleted 7 days after the recap, and only the people on the call can read it." },
  { icon: "doc-link-check", t: "Corrections keep history", d: "A timesheet correction creates a new version. The approved one stays." },
  { icon: "card-check", t: "No self-approval", d: "A reviewer cannot approve their own submission. The database refuses it." },
  { icon: "people", t: "Organisations are sealed", d: "Row-level security keeps each company's data apart, even from privileged code." },
];

const CONTROL: { icon: Icon3DName; t: string; d: string }[] = [
  { icon: "eye-dashboard", t: "Workroom", d: "Who is working now, on what, for how long. Status comes from timers, nothing else." },
  { icon: "calendar-clock", t: "Attendance", d: "Clock-ins against your schedule, late arrivals by the minute, the month at a glance." },
  { icon: "chat", t: "Messages", d: "Ask for an update with the task attached. Direct threads stay between two people." },
];

const FAQ: [string, string][] = [
  ["Do my staff know what is tracked?", "Yes. Everyone can read the monitoring notice in their profile: the tasks they plan, the timers they start and the work they submit. Screens and calls are never recorded, and everyone is told when the notice changes."],
  ["Does Boredroom record calls?", "No. Calls are never recorded. If someone asks Brenda to take notes, each person chooses for themselves: only the words of people who agree are written down, on their own device, and the transcript is deleted 7 days after the recap."],
  ["Can a team lead read private messages?", "No. A direct thread is readable only by the two people in it. Team channels are readable by that team. Nothing crosses organisations."],
  ["What happens when someone's laptop sleeps?", "The session closes at the last heartbeat and the gap is marked uncertain. The person is asked what happened; the time is not counted and not held against them."],
  ["When does it launch?", "Boredroom is in a private pilot. Create an organisation account to start with your own team."],
];

const SECTION = "py-20 sm:py-28";

/** A 40px tool square with a line icon by its v3 name. */
function LineSquare({ name }: { name: Icon3DName }) {
  const Icon = LINE_ICON[name];
  return <ToolSquare><Icon aria-hidden /></ToolSquare>;
}

export default async function LandingPage() {
  // The public page never fails over the database: a slow or absent connection means the defaults (live mode).
  const [user, launch, copy, plans] = await Promise.all([getCurrentUser().catch(() => null), launchSettings().catch(() => ({ mode: "live" as const, waitlist_open: true, app_access: true })), landingSettings().catch(() => ({ headline: "", subheadline: "", cta: "" })), publicPlans().catch(() => [])]);
  const waitlist = launch.mode === "waitlist";
  return (
    <MotionRoot>
      <div className="lp min-h-dvh overflow-x-clip bg-background text-foreground">
        <SiteNav signedIn={!!user} waitlist={waitlist} />

        <main id="main">
          <Hero signedIn={!!user} waitlist={waitlist} copy={copy} />

          <section aria-labelledby="questions" className="pt-20 sm:pt-28">
            <p id="questions" className={cn(WRAP, "mb-6 text-center text-sm font-medium text-secondary")}>Questions leads stop sending once the room is visible.</p>
            <QuestionsMarquee />
          </section>

          <section id="how" aria-labelledby="how-title" className={SECTION}>
            <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
              <div className="min-w-0">
                <SectionTitle id="how-title" align="left" icon={<Users aria-hidden />} title="Get everyone in, in minutes"
                  sub="Create the organisation, make your teams, put a lead on each, then share one code. Staff can only join through it, and they land in the right team with the right role." />
                <ul className="lp-reveal mt-7 flex flex-wrap gap-2" aria-label="Ways in and roles">
                  {WAYS_IN.map((w) => <li key={w} className="inline-flex h-8 items-center rounded-full bg-fill-1 px-3 text-meta font-medium text-secondary">{w}</li>)}
                </ul>
              </div>
              <JoinDemo />
            </div>
          </section>

          <section id="product" aria-labelledby="product-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="product-title" icon={<ListTodo aria-hidden />} title="Built for the people doing the work"
                sub="A staff member's whole day is one card: type a to-do, press Start, press Done. Everything a lead needs to know comes from that, and reaches them live." />
              <div className="mt-14"><DayDemo /></div>
              <div className="mt-3"><Panels /></div>
            </div>
          </section>

          <section aria-labelledby="day-title" className={SECTION}>
            <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
              <div className="lp-reveal min-w-0">
                <ToolSquare className="mb-6"><Timer aria-hidden /></ToolSquare>
                <h2 id="day-title" className="lp-h2">A day planned in one line</h2>
                <p className="lp-sub mt-4 max-w-lg">No forms. Type what needs doing and it is planned for today with the right reviewer. The clock is the page: it runs on the task you started, pauses when you do, and Done hands the work over in one step.</p>
                <p className="lp-sub mt-4 max-w-lg">Dictate a note and the assistant turns it into to-dos you confirm. Leads can hand a to-do to anyone on their team the same way.</p>
              </div>
              <MyDayMock />
            </div>
          </section>

          <section aria-labelledby="beyond-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="beyond-title" icon={<ChartPie aria-hidden />} title="Go beyond the timer" sub="Attendance against the schedule you set, and reports that add up only confirmed time." />
              <div className="mt-14 grid gap-3 md:grid-cols-2">
                <FeatureCard>
                  <AttendanceMock />
                  <FeatureText title="Attendance">Set a clock-in time, a clock-out time and a grace period. Everyone clocks in and out; a late arrival is recorded by the minute, and the month view shows every person, every day.</FeatureText>
                </FeatureCard>
                <FeatureCard>
                  <ReportsMock />
                  <FeatureText title="Reports and timesheets">At the end of each day Brenda sends every supervisor a report of what their team did, so nobody writes one. Timesheets count only confirmed time, a correction counts once a lead approves it, and the CSV export adds up to the same totals.</FeatureText>
                </FeatureCard>
              </div>
            </div>
          </section>

          <section aria-labelledby="ask-title" className={SECTION}>
            <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
              <div className="lp-reveal min-w-0 md:order-2">
                <ToolSquare className="mb-6"><MessageSquare aria-hidden /></ToolSquare>
                <h2 id="ask-title" className="lp-h2">Ask, with the task attached</h2>
                <p className="lp-sub mt-4 max-w-lg">A direct thread with anyone, a channel per team, and one for everyone. &ldquo;Ask for an update&rdquo; opens the thread with the task attached and the question ready. Direct messages are readable only by the two people in them, not by the lead, not by the owner.</p>
              </div>
              <div className="min-w-0 md:order-1"><MessagesDemo /></div>
            </div>
          </section>

          <section id="fair" aria-labelledby="fair-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="fair-title" icon={<ShieldCheck aria-hidden />} title="Fair to the people being watched" sub="Monitoring only works when everyone knows the rules. These are written into the product, not the marketing." />
              {/* Hairline grid: 1px gaps over the border colour; the ninth rule spans both columns on two-column screens. */}
              <ul className="lp-reveal mt-14 grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                {FAIR.map((f) => (
                  <li key={f.t} className="bg-background p-6 sm:last:col-span-2 lg:last:col-span-1">
                    <LineSquare name={f.icon} />
                    <h3 className="mt-5 text-base font-semibold text-foreground">{f.t}</h3>
                    <p className="lp-text mt-1.5">{f.d}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-label="From the monitoring notice" className="py-16 sm:py-24">
            <figure className={cn(WRAP, "lp-reveal max-w-4xl text-center")}>
              <blockquote className="font-display text-[28px] font-normal leading-9 tracking-[-0.02em] text-balance text-foreground sm:text-[40px] sm:leading-[48px]">&ldquo;Timers, heartbeats and logins are never treated as proof of productivity. Unlogged or uncertain work leads to a question, not a penalty.&rdquo;</blockquote>
              <figcaption className="mt-6 text-sm font-normal text-secondary">From the monitoring notice every member can read</figcaption>
            </figure>
          </section>

          <section id="control" aria-labelledby="control-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="control-title" icon={<Target aria-hidden />} title="Everything in view" sub="The room, the day and the conversation, live, for owners, HR and team leads. Staff see their own day and nothing else's." />
              <div className="mt-14"><DashboardDemo /></div>
              <ul className="mt-3 grid gap-3 md:grid-cols-3">
                {CONTROL.map((c) => (
                  <li key={c.t} className="lp-reveal flex gap-4 rounded-[20px] border border-border bg-fill-0 p-5">
                    <LineSquare name={c.icon} />
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground">{c.t}</h3>
                      <p className="lp-text mt-1">{c.d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="week-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="week-title" icon={<CalendarDays aria-hidden />} title="A week in the room" sub="Not what people say about it. What it records, in the order it happens." />
              <div className="lp-reveal mt-14"><Moments /></div>
            </div>
          </section>

          <section id="pricing" aria-labelledby="pricing-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="pricing-title" icon={<CreditCard aria-hidden />} title="Pay per workspace, not per glance" sub="Start free with one workspace. Move to Pro when you run several teams, or talk to us when you run a company of them." />
              <div className="mt-12"><Pricing plans={plans} waitlist={waitlist} signedIn={!!user} /></div>
            </div>
          </section>

          <section id="faq" aria-labelledby="faq-title" className={SECTION}>
            <div className={cn(WRAP, "grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-16")}>
              <SectionTitle id="faq-title" align="left" icon={<CircleQuestionMark aria-hidden />} title="Questions, answered" sub="The ones owners and staff ask before a pilot." />
              <Faq items={FAQ} />
            </div>
          </section>

          <section aria-labelledby="close-title" className="pt-8 sm:pt-12">
            <div className={WRAP}>
              <div className="lp-reveal rounded-[22px] border border-border bg-fill-0 px-5 py-12 sm:rounded-[28px] sm:px-12 sm:py-20">
                {waitlist && !user ? (
                  /* Waitlist mode (owner decision, 25 September 2026): the closing section carries the form, copy on the left, form on the right. */
                  <div className="grid items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14">
                    <div className="min-w-0">
                      <h2 id="close-title" className="lp-h2 lg:text-[56px] lg:leading-[60px]">{copy.headline || <>Know what your<br className="max-sm:hidden" /> remote team is doing</>}</h2>
                      <p className="lp-sub mt-5 max-w-lg">{copy.subheadline || "Boredroom is opening soon. Leave your details and you get one email the morning it opens, with a code for your team."}</p>
                      <Badge size="lg" dot className="mt-6">Opening soon</Badge>
                    </div>
                    <div className="w-full min-w-0 rounded-[20px] border border-border bg-background p-5 shadow-chart sm:p-6 md:max-w-md md:justify-self-end">
                      <WaitlistForm cta={copy.cta || "Join the waitlist"} />
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl text-center">
                    <h2 id="close-title" className="lp-display">Know what your<br className="max-sm:hidden" /> remote team is doing</h2>
                    <p className="lp-lead mx-auto mt-6 max-w-xl">Create a workspace, add your team with one code, and watch the room fill up the first morning.</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      {waitlist ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link> : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
                      <Link href="/join" className={heroButton("secondary")}>Join with a code</Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </MotionRoot>
  );
}
