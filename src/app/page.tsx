import Link from "next/link";
import { Logo } from "@/components/logo";
import { MotionRoot } from "@/components/ui/motion";
import { Hero } from "@/components/landing/hero";
import { QuestionsMarquee } from "@/components/landing/marquee";
import { JoinDemo } from "@/components/landing/join-demo";
import { DayDemo } from "@/components/landing/day-demo";
import { Panels } from "@/components/landing/panels";
import { AttendanceMock, MessagesMock, MyDayMock, ReportsMock } from "@/components/landing/mocks";
import { Moments } from "@/components/landing/moments";
import { LitTile } from "@/components/landing/lit-tile";
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { SectionTitle } from "@/components/landing/section-title";
import { GlassCard } from "@/components/landing/glass-card";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteBackground } from "@/components/landing/site-background";
import { getCurrentUser } from "@/server/auth";
import { launchSettings, landingSettings } from "@/server/admin/settings";

export const metadata = { title: "Boredroom · Know what your remote team is doing" };

const WAYS_IN = ["Join code", "Join link", "Email invitation", "Teams", "Team leads", "Owner", "HR", "Staff", "One workspace per company", "Sealed from every other"];

const FAIR = [
  { icon: "shield-check", t: "A notice everyone acknowledges", d: "Each person reads exactly what is recorded about them before their first session." },
  { icon: "flag-alert", t: "No productivity score", d: "Timers, heartbeats, logins and recordings are never treated as proof of work." },
  { icon: "stopwatch", t: "Uncertain time gets a question", d: "A gap leads to a clarification request, not a penalty." },
  { icon: "screen-record", t: "Recording needs a press", d: "Off by default, video only, explicit each time, with an indicator that never hides." },
  { icon: "eye-checklist", t: "Playback is granted, not assumed", d: "Every play is logged. Sensitive footage can be flagged and locked." },
  { icon: "calendar-clock", t: "Short retention", d: "Recordings expire on a schedule and leave a record of their own deletion." },
  { icon: "doc-link-check", t: "Corrections keep history", d: "A timesheet correction creates a new version. The approved one stays." },
  { icon: "card-check", t: "No self-approval", d: "A reviewer cannot approve their own submission. The database refuses it." },
  { icon: "people", t: "Organisations are sealed", d: "Row-level security keeps each company's data apart, even from privileged code." },
];

const CONTROL = [
  { icon: "eye-dashboard", t: "Workroom", d: "Who is working now, on what, for how long. Status comes from timers, nothing else." },
  { icon: "clock-in", t: "Attendance", d: "Clock-ins against your schedule, late arrivals by the minute, the month at a glance." },
  { icon: "chat", t: "Messages", d: "Ask for an update with the task attached. Direct threads stay between two people." },
];

const FAQ = [
  ["Do my staff know they are being tracked?", "Yes. Every member reads and acknowledges a versioned monitoring notice before working, and can open it at any time to see exactly what is recorded about them."],
  ["Is screen recording mandatory?", "No. It is off until an owner turns it on. Even then nothing records until the person presses Record screen and picks what to share, and a visible indicator runs the whole time."],
  ["Can a team lead read private messages?", "No. A direct thread is readable only by the two people in it. Team channels are readable by that team. Nothing crosses organisations."],
  ["What happens when someone's laptop sleeps?", "The session closes at the last heartbeat and the gap is marked uncertain. The person is asked what happened; the time is not counted and not held against them."],
  ["When does it launch?", "Boredroom is in a private pilot. Create an organisation account to start with your own team."],
];

export default async function LandingPage() {
  // The public page never fails over the database: a slow or absent connection means the defaults (live mode).
  const [user, launch, copy] = await Promise.all([getCurrentUser().catch(() => null), launchSettings().catch(() => ({ mode: "live" as const, waitlist_open: true, app_access: true })), landingSettings().catch(() => ({ headline: "", subheadline: "", cta: "" }))]);
  const waitlist = launch.mode === "waitlist";
  return (
    <MotionRoot>
      <SiteBackground />
      <div className="lp relative z-[1]">
        <SiteNav signedIn={!!user} waitlist={waitlist} />

        <main id="main">
          <Hero signedIn={!!user} waitlist={waitlist} copy={copy} />

          <section aria-labelledby="questions" className="py-10 md:py-14">
            <Reveal><p id="questions" className="lp-muted mb-8 text-center text-[15px]">Questions leads stop sending once the room is visible.</p></Reveal>
            <QuestionsMarquee />
          </section>

          <section id="how" className="py-24 md:py-36">
            <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 md:grid-cols-2 md:gap-16">
              <Reveal>
                <span className="lp-icon mb-8"><img src="/icons/people.png" alt="" loading="lazy" /></span>
                <h2 className="text-balance font-display text-4xl leading-[1.06] tracking-[-0.02em] md:text-[56px]">Get everyone in, in minutes</h2>
                <p className="lp-muted mt-5 max-w-lg text-pretty text-lg leading-relaxed">Create the organisation, make your teams, put a lead on each, then share one code. Staff can only join through it, and they land in the right team with the right role.</p>
                <ul className="mt-7 flex flex-wrap gap-2" aria-label="Ways in and roles">
                  {WAYS_IN.map((w) => <li key={w} className="lp-card-sm px-3 py-1.5 text-sm lp-muted">{w}</li>)}
                </ul>
              </Reveal>
              <Reveal delay={0.15}><JoinDemo /></Reveal>
            </div>
          </section>

          <section id="product" className="py-24 md:py-36">
            <div className="mx-auto max-w-6xl px-6">
              <SectionTitle icon="day-checklist" title="Built for the people doing the work" sub="A staff member's whole day is one card: type a to-do, press Start, press Done. Everything a lead needs to know comes from that, and reaches them live." />
              <Reveal className="mt-16" delay={0.1}><DayDemo /></Reveal>
              <Reveal className="mt-4" delay={0.1}><Panels /></Reveal>
            </div>
          </section>

          <section className="py-24 md:py-36">
            <div className="mx-auto max-w-6xl px-6">
              <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
                <Reveal>
                  <span className="lp-icon mb-8"><img src="/icons/stopwatch.png" alt="" loading="lazy" /></span>
                  <h2 className="text-balance font-display text-4xl leading-[1.06] tracking-[-0.02em] md:text-[56px]">A day planned in one line</h2>
                  <p className="lp-muted mt-5 max-w-lg text-pretty text-lg leading-relaxed">No forms. Type what needs doing and it is planned for today with the right reviewer. The clock is the page: it runs on the task you started, pauses when you do, and Done hands the work over in one step.</p>
                  <p className="lp-muted mt-4 max-w-lg text-pretty text-lg leading-relaxed">Dictate a note and the assistant turns it into to-dos you confirm. Leads can hand a to-do to anyone on their team the same way.</p>
                </Reveal>
                <Reveal delay={0.15}><MyDayMock /></Reveal>
              </div>

              <div className="mt-28 md:mt-36">
                <SectionTitle icon="chart-ring" title="Go beyond the timer" sub="Attendance against the schedule you set, and reports that add up only confirmed time." />
                <RevealGroup className="mt-14 grid gap-4 md:grid-cols-2" stagger={0.12}>
                  <RevealItem>
                    <GlassCard bodyClassName="p-6 md:p-8">
                      <AttendanceMock />
                      <h3 className="mt-6 font-display text-2xl">Attendance</h3>
                      <p className="lp-muted mt-2 text-pretty leading-relaxed">Set a clock-in time, a clock-out time and a grace period. Everyone clocks in and out; a late arrival is recorded by the minute, and the month view shows every person, every day.</p>
                    </GlassCard>
                  </RevealItem>
                  <RevealItem>
                    <GlassCard bodyClassName="p-6 md:p-8">
                      <ReportsMock />
                      <h3 className="mt-6 font-display text-2xl">Reports and timesheets</h3>
                      <p className="lp-muted mt-2 text-pretty leading-relaxed">Time by person, team and task for any period. Daily reports with blockers, corrections that keep the approved version, and a CSV export that matches the approved snapshots.</p>
                    </GlassCard>
                  </RevealItem>
                </RevealGroup>
              </div>

              <div className="mt-28 grid items-center gap-12 md:mt-36 md:grid-cols-2 md:gap-16">
                <Reveal className="md:order-2">
                  <span className="lp-icon mb-8"><img src="/icons/chat.png" alt="" loading="lazy" /></span>
                  <h2 className="text-balance font-display text-4xl leading-[1.06] tracking-[-0.02em] md:text-[56px]">Ask, with the task attached</h2>
                  <p className="lp-muted mt-5 max-w-lg text-pretty text-lg leading-relaxed">A direct thread with anyone, a channel per team, and one for everyone. &ldquo;Ask for an update&rdquo; opens the thread with the task attached and the question ready. Direct messages are readable only by the two people in them, not by the lead, not by the owner.</p>
                </Reveal>
                <Reveal className="md:order-1" delay={0.15}><MessagesMock /></Reveal>
              </div>
            </div>
          </section>

          <section id="fair" className="py-24 md:py-36">
            <div className="mx-auto max-w-6xl px-6">
              <SectionTitle icon="shield-check" title="Fair to the people being watched" sub="Monitoring only works when everyone knows the rules. These are written into the product, not the marketing." />
              <RevealGroup as="ul" className="lp-table mt-16 sm:grid-cols-2 lg:grid-cols-3" stagger={0.05}>
                {FAIR.map((f) => (
                  <RevealItem as="li" key={f.t} className="lp-cell">
                    <img src={`/icons/${f.icon}.png`} alt="" className="h-14 w-14 object-contain" loading="lazy" />
                    <h3 className="mt-5 text-lg font-semibold">{f.t}</h3>
                    <p className="lp-muted mt-2 text-pretty leading-relaxed">{f.d}</p>
                  </RevealItem>
                ))}
              </RevealGroup>
            </div>
          </section>

          <section className="py-16 md:py-24">
            <Reveal className="mx-auto max-w-4xl px-6 text-center">
              <p className="text-balance font-display text-3xl leading-[1.2] md:text-[44px]">&ldquo;Timers, heartbeats, recordings and logins are never treated as proof of productivity. Unlogged or uncertain work leads to a question, not a penalty.&rdquo;</p>
              <p className="lp-muted mt-8 text-[15px]">From the monitoring notice every member reads and acknowledges</p>
            </Reveal>
          </section>

          <section id="control" className="py-24 md:py-36">
            <div className="mx-auto max-w-6xl px-6">
              <SectionTitle icon="focus-target" title="Everything in view" sub="The room, the day and the conversation, live, for owners, HR and team leads. Staff see their own day and nothing else's." />
              <RevealGroup className="mt-14 grid gap-4 md:grid-cols-3" stagger={0.1}>
                {CONTROL.map((c, i) => (
                  <RevealItem key={c.t}>
                    <LitTile duration={6500 + i * 900} className="h-full">
                      <div className="flex items-center gap-4 p-6">
                        <img src={`/icons/${c.icon}.png`} alt="" className="h-12 w-12 shrink-0 object-contain" loading="lazy" />
                        <div><p className="text-lg font-semibold">{c.t}</p><p className="lp-muted mt-1 text-pretty text-sm leading-relaxed">{c.d}</p></div>
                      </div>
                    </LitTile>
                  </RevealItem>
                ))}
              </RevealGroup>

            </div>
          </section>

          <section className="py-24 md:py-36">
            <div className="mx-auto max-w-6xl px-6">
              <SectionTitle icon="desk" title="A week in the room" sub="Not what people say about it. What it records, in the order it happens." />
              <Reveal className="mt-14" delay={0.1}><Moments /></Reveal>
            </div>
          </section>

          <section id="faq" className="py-24 md:py-36">
            <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[1fr_1.4fr] md:gap-16">
              <SectionTitle align="left" icon="eye-checklist" title="Questions, answered" sub="The ones owners and staff ask before a pilot." />
              <Reveal delay={0.1}>
                <div className="lp-faq lp-glass divide-y lp-line rounded-2xl px-6">
                  {FAQ.map(([q, a]) => (
                    <details key={q} className="group py-1">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left text-[17px] font-semibold">
                        <span>{q}</span>
                        <span aria-hidden className="relative h-4 w-4 shrink-0 lp-muted transition-transform duration-300 group-open:rotate-45"><span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-current" /><span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current" /></span>
                      </summary>
                      <p className="lp-muted pb-5 pr-10 text-pretty leading-relaxed">{a}</p>
                    </details>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>

          <section className="relative isolate overflow-hidden py-32 md:py-44">
            <div aria-hidden className="lp-grid absolute inset-0 opacity-70" />
            <div aria-hidden className="lp-glow absolute left-1/2 top-full h-[600px] w-[1100px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
            {waitlist && !user ? (
              /* Waitlist mode (owner decision, 25 September 2026): the closing section carries the form, copy on the left, form on the right. */
              <Reveal className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 md:grid-cols-[1.05fr_0.95fr] md:gap-14">
                <div className="text-left">
                  <p className="text-balance font-display text-[48px] leading-[0.98] tracking-[-0.03em] md:text-[72px]">{copy.headline || <>Know what your<br />remote team is doing</>}</p>
                  <p className="lp-muted mt-7 max-w-lg text-pretty text-lg leading-relaxed">{copy.subheadline || "Boredroom is opening soon. Leave your details and you get one email the morning it opens, with a code for your team."}</p>
                  <p className="lp-faint mt-6 inline-flex items-center gap-2 lp-glass rounded-full px-3 py-1.5 text-xs"><span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />Opening soon</p>
                </div>
                <div className="w-full md:max-w-md md:justify-self-end"><WaitlistForm cta={copy.cta || "Join the waitlist"} /></div>
              </Reveal>
            ) : (
              <Reveal className="relative mx-auto max-w-5xl px-6 text-center">
                <p className="text-balance font-display text-[52px] leading-[0.98] tracking-[-0.03em] md:text-[96px]">Know what your<br />remote team is doing</p>
                <p className="lp-muted mx-auto mt-7 max-w-xl text-pretty text-lg leading-relaxed">Create a workspace, add your team with one code, and watch the room fill up the first morning.</p>
                <div className="mt-9 flex flex-wrap justify-center gap-3">
                  {waitlist ? <Link href="/app" className="lp-btn lp-btn-primary">Open your workspace</Link> : <Link href="/signup?intent=org" className="lp-btn lp-btn-primary">Get started</Link>}
                  <Link href="/join" className="lp-btn lp-btn-secondary">Join with a code</Link>
                </div>
              </Reveal>
            )}
          </section>
        </main>

        <footer className="lp-glass mt-8 rounded-t-[32px] border-b-0">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 text-sm md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="max-w-xs">
              <Logo />
              <p className="lp-muted mt-4 text-pretty leading-relaxed">A live view of what your remote team plans, works on and delivers. No status meeting required.</p>
              <p className="mt-6 inline-flex items-center gap-2 lp-glass rounded-full px-3 py-1.5 text-xs lp-muted"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Private pilot, accepting workspaces</p>
            </div>
            <nav aria-label="Product" className="space-y-3"><p className="font-semibold">Product</p><a href="#how" className="lp-muted block hover:text-fg">How it works</a><a href="#product" className="lp-muted block hover:text-fg">The day</a><a href="#control" className="lp-muted block hover:text-fg">Everything in view</a><a href="#fair" className="lp-muted block hover:text-fg">Fairness</a></nav>
            <nav aria-label="Account" className="space-y-3"><p className="font-semibold">Account</p><Link href="/login" className="lp-muted block hover:text-fg">Log in</Link><Link href="/signup?intent=org" className="lp-muted block hover:text-fg">Create an organisation</Link><Link href="/join" className="lp-muted block hover:text-fg">Join with a code</Link><Link href="/recover" className="lp-muted block hover:text-fg">Recover a password</Link></nav>
            <nav aria-label="Help" className="space-y-3"><p className="font-semibold">Help</p><a href="#faq" className="lp-muted block hover:text-fg">FAQ</a><a href="#fair" className="lp-muted block hover:text-fg">What is recorded</a><a href="mailto:jonwuka@xsitecapital.com" className="lp-muted block hover:text-fg">Contact</a></nav>
          </div>
          <div className="border-t lp-line-soft"><p className="lp-faint mx-auto max-w-6xl px-6 py-6 text-xs">Boredroom, 2026. Built for teams that are out of sight, not out of the loop.</p></div>
        </footer>
      </div>
    </MotionRoot>
  );
}
