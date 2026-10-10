import Link from "next/link";
import { CalendarClock, CalendarDays, CircleCheck, CircleQuestionMark, CreditCard, ListTodo, Lock, MessageSquare, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { MotionRoot } from "@/components/ui/motion";
import { Badge } from "@/components/ui/badge";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { ToolSquare } from "@/components/ui/tool-tile";
import { Hero, heroButton } from "@/components/landing/hero";
import { QuestionsMarquee } from "@/components/landing/marquee";
import { JoinDemo } from "@/components/landing/join-demo";
import { DayDemo } from "@/components/landing/day-demo";
import { ChangesCard } from "@/components/landing/panels";
import { AttendanceMock, MyDayMock, ReportsMock } from "@/components/landing/mocks";
import { MessagesDemo } from "@/components/landing/messages-demo";
import { DashboardSection } from "@/components/landing/dashboard-section";
import { AssistantsSection, CallsSection, DesktopSection, HowSection, LoopsSection } from "@/components/landing/feature-sections";
import { Moments } from "@/components/landing/moments";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/footer";
import { FeatureCard, FeatureText, SectionTitle, WRAP, arrive } from "@/components/landing/parts";
import { ArrivalObserver } from "@/components/landing/arrival";
import { publicPlans } from "@/server/services/pricing";
import { FEATURE_LABELS, type PublicPlan } from "@/lib/plans";
import { getCurrentUser } from "@/server/auth";
import { launchSettings, landingSettings, type LaunchSettings } from "@/server/admin/settings";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Boredroom · Know what your remote team is doing",
  description: "Everyone on your team gets their own AI assistant, Brenda. She knows their day, answers follow-ups from their real work and writes the end-of-day report. Calls on every plan, and no productivity score.",
};

/*
  The public landing page, design system v4 (owner request, 6 October 2026): the app's own language on the dark
  canvas. Display headlines in Geist 400, 18/28 secondary lines, hairline cards (r16–r28, 20–24px in), and product
  views built from the real v4 parts (the app frame on Brenda's home, stat cards, the analytics card with its orange
  highlight, a table, underline tabs, the segmented control) instead of screenshots or 3D icons. Orange follows the
  accent rules: the one standout per screen is the waitlist call to action (waitlist mode) or nothing; everything else
  orange is a live, active or chosen mark inside a product view. Light theme follows the toggle (the v4 tokens).

  Rebuilt (owner request, 10 October 2026): the hero is Brenda in every colour on a backdrop of the one in front, with
  the flipping headline from the live site; "Everything in view" comes straight under it with the dashboard card that
  straightens as you scroll; then the questions strip and the assistant sections (each person's Brenda, assistants
  chasing for you, promises, calls with notes), the day, attendance and timesheets, messages, Brenda desktop, fairness,
  the week, getting everyone in, pricing, the FAQ and the close. Recording is gone everywhere except as "never
  recorded", and so is the unsupported "10k+ users" claim.

  Sticky pictures and arrivals (owner request, 10 October 2026): where a section's text runs longer than its picture,
  the picture holds still under the nav while the text scrolls; headings, points and cards arrive once, in sequence, as
  they come into view, and the product pictures act out their story (components/landing/arrival.tsx). The server
  renders every finished state; reduced motion and no-script visitors see only that.
*/

const WAYS_IN = ["Join code", "Join link", "Email invitation", "Teams", "Team leads", "Owner", "HR", "Staff", "One workspace per company", "Sealed from every other"];

// Review fixes, 10 October 2026: "Nothing is recorded" overclaimed (the notice records tasks, work sessions and
// submissions), the recap's short version in the call's thread is said, Anthropic is named where words go, and the
// launch answer follows maintenance and signed-in visitors.
// The fairness rules (owner decisions, 8 October 2026: phase 8, A.3.2; the assistants' rules added, owner request
// 10 October 2026): screens and calls are never recorded; Brenda's notes on a call are each person's own choice; an
// assistant works for its person; nothing lands on anyone's list without a yes.
const FAIR: { icon: Icon3DName | LucideIcon; t: string; d: string }[] = [
  { icon: "shield-check", t: "Screens and calls are never recorded", d: "Boredroom doesn't record screens, and calls are never recorded. Their sound and video pass through our video provider only to reach the people on the call." },
  { icon: "flag-alert", t: "No productivity score", d: "Timers, heartbeats and logins are never treated as proof of work. Reports give plain counts, and nobody is ranked." },
  { icon: "stopwatch", t: "Uncertain time gets a question", d: "A gap leads to a clarification request, not a penalty." },
  { icon: "video-people", t: "Call notes only with consent", d: "Brenda takes notes only for the people who say yes, written down on their own device. A short version of the recap goes into the call's thread; the transcript is deleted 7 days after the recap." },
  { icon: Lock, t: "Your assistant works for you", d: "Your chats with Brenda, your loose ends and your preferences are yours. Owners and HR see a plain log of what assistants did, never what was said." },
  { icon: CircleCheck, t: "Nothing lands without a yes", d: "Brenda asks before acting unless you choose otherwise. A request to someone else changes nothing until they accept it." },
  { icon: "doc-link-check", t: "Corrections keep history", d: "A timesheet correction creates a new version. The approved one stays." },
  { icon: "card-check", t: "No self-approval", d: "A reviewer cannot approve their own submission. The database refuses it." },
  { icon: "people", t: "Organisations are sealed", d: "Row-level security keeps each company's data apart, even from privileged code." },
];

/** The FAQ (owner request, 10 October 2026: the assistants' questions added); the last answer follows the launch mode. */
const faq = ({ waitlist, maintenance, signedIn, notice }: { waitlist: boolean; maintenance: boolean; signedIn: boolean; notice: string }): [string, string][] => [
  ["Do my staff know what is tracked?", "Yes. Everyone can read the monitoring notice in their profile: the tasks they plan, the timers they start and the work they submit. Screens and calls are never recorded, and everyone is told when the notice changes."],
  ["Does Boredroom record calls?", "No. Calls are never recorded. If someone asks Brenda to take notes, each person chooses for themselves: only the words of people who agree are written down, on their own device. Everyone who joined gets the recap, a short version goes into the call's thread, and the transcript is deleted 7 days after the recap."],
  ["Can Brenda do things without asking me?", "Only if you choose “Act without asking”. Even then she asks before messaging everyone, a whole team or a channel of more than 8 people, most of what she does can be undone for 10 minutes, and anything that lands on someone else's list waits for them to accept it."],
  ["What does someone else's assistant share about me?", "Only facts about your work that the person asking could already see. It never shares your to-dos, your day plan, your documents, your messages or your chats with your assistant. When your work doesn't answer the question, it asks you."],
  ["Can my lead read my chats with Brenda?", "No. Only you can read your chats with her: not your lead, not the owner, not HR. They see a plain log of what assistants did, never what was said."],
  ["Can a team lead read private messages?", "No. A direct thread is readable only by the two people in it. Team channels are readable by that team. Nothing crosses organisations."],
  ["Where do my words go when I talk to Brenda?", "In Brenda desktop, and for notes on a call, your speech is turned into text on your own computer. In the browser, dictation uses the browser's own speech service where it has one (Chrome's sends the audio to Google), or a model on your computer where it doesn't. She answers in your computer's own voice unless you choose a natural voice: then her words are sent to ElevenLabs to be spoken. Brenda runs on Claude: what you ask her, and what she reads to answer, is sent to Anthropic to write her reply, and on a call the notes of the people who agree are sent there to write the recap. Only what you are allowed to see is sent."],
  ["What happens when someone's laptop sleeps?", "The session closes at the last heartbeat and the gap is marked uncertain. The person is asked what happened; the time is not counted and not held against them."],
  ["When does it launch?", maintenance ? notice || "Boredroom is under maintenance, and new sign-ups are paused for now. Everyone with an account can log in as usual."
    : waitlist ? (signedIn ? "Boredroom is opening soon to everyone. You already have an account: open your workspace from the top of this page." : "Boredroom is opening soon. Join the waitlist and you get one email the morning it opens, with a code for your team.")
    : "Boredroom is in a private pilot. Create a workspace to start with your own team."],
];

const SECTION = "py-20 sm:py-28";

/** A 40px tool square with a line icon, by its v3 name or a lucide icon. */
function LineSquare({ name }: { name: Icon3DName | LucideIcon }) {
  const Icon = typeof name === "string" ? LINE_ICON[name] : name;
  return <ToolSquare><Icon aria-hidden /></ToolSquare>;
}

/**
 * Only the flags the page can label reach the browser (integration, 10 October 2026): a stored plan still carries
 * VIDEO_RECORDING and SCREEN_CAPTURE until migration 0055, and the pricing cards are a client component, so the whole
 * features object was serialised into the page.
 */
const forLanding = (plans: PublicPlan[]): PublicPlan[] =>
  plans.map((p) => ({ ...p, features: Object.fromEntries(Object.entries(p.features ?? {}).filter(([k]) => Object.hasOwn(FEATURE_LABELS, k))) }));

export default async function LandingPage() {
  // The public page never fails over the database: a slow or absent connection means the defaults (live mode).
  const [user, launch, copy, plans] = await Promise.all([getCurrentUser().catch(() => null), launchSettings().catch((): LaunchSettings => ({ mode: "live", waitlist_open: true, app_access: true })), landingSettings().catch(() => ({ headline: "", subheadline: "", cta: "" })), publicPlans().catch(() => [])]);
  const waitlist = launch.mode === "waitlist";
  // Maintenance closes sign-ups (registrationOpen() is live only): the page asks people to log in instead (review fix, 10 October 2026).
  const maintenance = launch.mode === "maintenance";
  const notice = launch.message?.trim() ?? "";
  return (
    <MotionRoot>
      <div className="lp min-h-dvh overflow-x-clip bg-background text-foreground">
        <SiteNav signedIn={!!user} waitlist={waitlist} maintenance={maintenance} />

        <main id="main">
          <Hero signedIn={!!user} waitlist={waitlist} maintenance={maintenance} notice={notice} copy={copy} />

          <DashboardSection />

          <section aria-labelledby="questions" className="pt-4 pb-4 sm:pt-8">
            <p id="questions" className={cn(WRAP, "mb-6 text-center text-sm font-medium text-secondary")}>Questions leads stop sending. Brenda answers them from the work.</p>
            <QuestionsMarquee />
          </section>

          <HowSection />
          <AssistantsSection />
          <LoopsSection />
          <CallsSection />

          <section id="product" aria-labelledby="product-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="product-title" icon={<ListTodo aria-hidden />} title="Built for the people doing the work"
                sub="A staff member's whole day is one card: type a to-do, press Start, press Done. Everything a lead needs to know comes from that, and reaches them live." />
              <div className="mt-14"><DayDemo /></div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <FeatureCard>
                  <MyDayMock />
                  <FeatureText title="A day planned in one line">No forms. Type what needs doing and it is planned for today with the right reviewer. The clock runs on the task you started and pauses when you do, and Done hands the work over in one step. Dictate a note and Brenda turns it into to-dos you confirm.</FeatureText>
                </FeatureCard>
                <FeatureCard order={1}>
                  <ChangesCard />
                  <FeatureText title="Every change, the second it happens">Clock-ins, starts, pauses, submissions and decisions reach every open screen within seconds. Reconnect and the page refetches the truth, so nothing shown is stale.</FeatureText>
                </FeatureCard>
              </div>
            </div>
          </section>

          <section id="time" aria-labelledby="time-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="time-title" icon={<CalendarClock aria-hidden />} title="Attendance and timesheets that add up" sub="Clock-ins against the schedule you set, and timesheets that count only confirmed time." />
              <div className="mt-14 grid gap-3 md:grid-cols-2">
                <FeatureCard>
                  <AttendanceMock />
                  <FeatureText title="Attendance">Set a clock-in time, a clock-out time and a grace period. A late arrival is recorded by the minute, and the month view shows every person, every day. Brenda desktop can clock people in when they start work, if the workspace and the person allow it.</FeatureText>
                </FeatureCard>
                <FeatureCard order={1}>
                  <ReportsMock />
                  <FeatureText title="Timesheets">Timesheets count only confirmed time. A correction counts once a lead approves it, the approved version stays, and the CSV export adds up to the same totals.</FeatureText>
                </FeatureCard>
              </div>
            </div>
          </section>

          <section id="messages" aria-labelledby="ask-title" className={SECTION}>
            <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
              <div data-lp-arrive className="min-w-0 md:order-2">
                <div className="lp-item mb-6" style={arrive(0)}><ToolSquare><MessageSquare aria-hidden /></ToolSquare></div>
                <h2 id="ask-title" className="lp-h2 lp-item" style={arrive(1)}>Ask, with the task attached</h2>
                <p className="lp-sub lp-item mt-4 max-w-lg" style={arrive(2)}>A direct thread with anyone, a channel per team, and one for everyone. &ldquo;Ask for an update&rdquo; opens the thread with the task attached and the question ready. Direct messages are readable only by the two people in them, not by the lead, not by the owner.</p>
                <p className="lp-sub lp-item mt-4 max-w-lg" style={arrive(3)}>Send a voice note. Ask Brenda &ldquo;What did I miss in #design?&rdquo; and she catches you up without marking anything as read. Write briefs, SOPs and notes in Docs, alone or with her, for yourself, one team or everyone.</p>
              </div>
              <div className="min-w-0 md:order-1"><MessagesDemo /></div>
            </div>
          </section>

          <DesktopSection />

          <section id="fair" aria-labelledby="fair-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="fair-title" icon={<ShieldCheck aria-hidden />} title="Fair to the people being watched" sub="Monitoring only works when everyone knows the rules. These are written into the product, not the marketing." />
              {/* Hairline grid: 1px gaps over the border colour; the ninth rule spans both columns on two-column screens. The
                  rules' words arrive in reading order; the cells stay put, so the hairlines never flash. */}
              <ul data-lp-arrive className="mt-14 grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                {FAIR.map((f, i) => (
                  <li key={f.t} className="bg-background p-6 sm:last:col-span-2 lg:last:col-span-1">
                    <div className="lp-item" style={arrive(0, i * 60)}>
                      <LineSquare name={f.icon} />
                      <h3 className="mt-5 text-base font-semibold text-foreground">{f.t}</h3>
                      <p className="lp-text mt-1.5">{f.d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* The quote is the exact sentence of the standard notice (DEFAULT_NOTICE, server/services/orgs.ts). */}
          <section aria-label="From the monitoring notice" className="py-16 sm:py-24">
            <figure className={cn(WRAP, "lp-reveal max-w-4xl text-center")}>
              <blockquote className="font-display text-[28px] font-normal leading-9 tracking-[-0.02em] text-balance text-foreground sm:text-[40px] sm:leading-[48px]">&ldquo;Unlogged or uncertain time leads to a clarification request, not an automatic penalty.&rdquo;</blockquote>
              <figcaption className="mt-6 text-sm font-normal text-secondary">From Boredroom&apos;s standard monitoring notice, which every member can read in their profile</figcaption>
            </figure>
          </section>

          <section aria-labelledby="week-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="week-title" icon={<CalendarDays aria-hidden />} title="A week in the room" sub="Not what people say about it. What it records, in the order it happens." />
              <div className="lp-reveal mt-14"><Moments /></div>
            </div>
          </section>

          <section id="start" aria-labelledby="start-title" className={SECTION}>
            <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
              <div className="min-w-0">
                <SectionTitle id="start-title" align="left" icon={<Users aria-hidden />} title="Get everyone in, in minutes"
                  sub="Create the organisation, make your teams and put a lead on each. Then share one code, a link or an email invitation: people land in the right team with the right role, and each meets their own Brenda the first time they come in." />
                <ul data-lp-arrive className="mt-7 flex flex-wrap gap-2" aria-label="Ways in and roles">
                  {WAYS_IN.map((w, i) => <li key={w} className="lp-item lp-pop inline-flex h-8 items-center rounded-full bg-fill-1 px-3 text-meta font-medium text-secondary" style={arrive(0, 150 + i * 45)}>{w}</li>)}
                </ul>
              </div>
              <JoinDemo />
            </div>
          </section>

          <section id="pricing" aria-labelledby="pricing-title" className={SECTION}>
            <div className={WRAP}>
              <SectionTitle id="pricing-title" icon={<CreditCard aria-hidden />} title="Pay per workspace, not per glance" sub="Start free with one workspace. Move to Pro when you run several teams, or talk to us when you run a company of them." />
              <div className="mt-12"><Pricing plans={forLanding(plans)} waitlist={waitlist} maintenance={maintenance} signedIn={!!user} /></div>
            </div>
          </section>

          <section id="faq" aria-labelledby="faq-title" className={SECTION}>
            {/* The title holds at the top while the nine answers scroll past (owner request, 10 October 2026). */}
            <div className={cn(WRAP, "grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-16")}>
              <div className="min-w-0"><SectionTitle id="faq-title" align="left" className="lp-sticky" icon={<CircleQuestionMark aria-hidden />} title="Questions, answered" sub="The ones owners and staff ask before a pilot." /></div>
              <Faq items={faq({ waitlist, maintenance, signedIn: !!user, notice })} />
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
                    <p className="lp-lead mx-auto mt-6 max-w-xl">Create a workspace, share one code, and everyone meets their own Brenda the first time they come in.</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      {user ? <Link href="/app" className={heroButton("primary")}>Open your workspace</Link>
                        : maintenance ? <Link href="/login" className={heroButton("primary")}>Log in</Link>
                        : <Link href="/signup?intent=org" className={heroButton("primary")}>Get started</Link>}
                      {maintenance && !user ? null : <Link href="/join" className={heroButton("secondary")}>Join with a code</Link>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>

        <SiteFooter waitlist={waitlist} />
        <ArrivalObserver />
      </div>
    </MotionRoot>
  );
}
