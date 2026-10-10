import { CalendarX2, Handshake, Laptop, ListChecks, MessageSquareReply, Mic, Repeat, Sunrise, Undo2, UserCheck, Video, type LucideIcon } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { ToolSquare } from "@/components/ui/tool-tile";
import { BrendaHomeFrame } from "@/components/landing/hero-frame";
import { CallCard } from "@/components/landing/panels";
import { CommitmentMock, FollowUpMock, NotchMock, RecapMock } from "@/components/landing/assistant-mocks";
import { SectionTitle, WRAP, arrive } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

/**
 * The assistant sections of the landing page (owner request, 10 October 2026: "update the landing page information to
 * communicate our updated features and solutions"): Brenda for each person (#how), the assistants chasing for you
 * (#assistants), promises kept (#loops), calls with Brenda's notes (#calls) and Brenda on your computer (#desktop).
 * Every claim is built (the copy audit of 10 October 2026). Server-rendered and quiet: no motion beyond the arrivals
 * (owner request, 10 October 2026: headings and points in sequence, each picture acting out its story once; see
 * arrival.tsx) and the faces' own idle breathing.
 *
 * Where the text runs longer than its picture (#assistants, #loops, #desktop), the picture sticks under the nav while
 * the text scrolls past and leaves with the end of the section (owner request, 10 October 2026: "let the card stick to
 * the top of that section … do similar for the second"; globals.css §6, "Sticky pictures"). Stacked on phones.
 */

const SECTION = "py-20 sm:py-28";

type Point = { icon: LucideIcon; t: string; d: React.ReactNode };

/**
 * Four cells in one hairline grid (the fairness grid's style): one column, two from 640px, four from 1024px. Each
 * cell's words arrive in turn; the cells themselves stay put, so the hairlines never flash.
 */
function PointGrid({ points, className }: { points: Point[]; className?: string }) {
  return (
    <ul data-lp-arrive className={cn("grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4", className)}>
      {points.map(({ icon: Icon, t, d }, i) => (
        <li key={t} className="bg-background p-6">
          <div className="lp-item" style={arrive(i)}>
            <ToolSquare><Icon aria-hidden /></ToolSquare>
            <h3 className="mt-5 text-base font-semibold text-foreground">{t}</h3>
            <p className="lp-text mt-1.5">{d}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A two-column section's text: the 40px tool square, the title, a lead (arriving in that order), then points split by
 * hairlines, each arriving as it scrolls into view (the text is longer than a screen next to a sticky picture).
 */
function Opener({ id, icon, title, lead, points }: { id: string; icon: React.ReactNode; title: string; lead: string; points: [string, React.ReactNode][] }) {
  return (
    <div className="min-w-0">
      <div data-lp-arrive>
        <div className="lp-item mb-6" style={arrive(0)}><ToolSquare>{icon}</ToolSquare></div>
        <h2 id={id} className="lp-h2 lp-item" style={arrive(1)}>{title}</h2>
        <p className="lp-sub lp-item mt-4 max-w-lg" style={arrive(2)}>{lead}</p>
      </div>
      <ul className="mt-7 max-w-lg divide-y divide-border border-t border-border">
        {points.map(([t, d], i) => (
          <li key={t} className="py-4">
            <div data-lp-arrive className="lp-item" style={arrive(i)}>
              <h3 className="text-base font-semibold text-foreground">{t}</h3>
              <p className="lp-text mt-1">{d}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The picture beside an Opener: its column stretches to the row and the picture sticks while the text scrolls. */
function StickyPicture({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("lp-sticky-col min-w-0", className)}>
      <div className="lp-sticky">{children}</div>
    </div>
  );
}

const HOW: Point[] = [
  { icon: Sunrise, t: "She knows your day", d: "Each morning she opens with what is waiting on you. Ask her to plan your day, set a reminder, start your timer or write a doc with you." },
  { icon: Undo2, t: "She asks first, or acts with Undo", d: <>Choose &ldquo;Ask me before acting&rdquo;, or &ldquo;Act without asking&rdquo; and undo most of it for 10 minutes. She still asks before messaging everyone, a whole team or a channel of more than 8 people.</> },
  { icon: Mic, t: "Talk to her", d: "Type, dictate, or hold a key on your computer and speak. She answers in your computer's own voice, or in one of eight natural voices if you choose one." },
  { icon: Repeat, t: "Routines, on your terms", d: <>&ldquo;Every weekday at 9, brief me.&rdquo; &ldquo;Every Friday at 4pm, send me what&apos;s still owed.&rdquo; Preview a routine, then switch it on. Quiet hours hold everything until they end.</> },
];

/** #how: Brenda works for each person. Her home in today's app frame, then what she does. */
export function HowSection() {
  return (
    <section id="how" aria-labelledby="how-title" className={SECTION}>
      <div className={WRAP}>
        <SectionTitle id="how-title" icon={<BrendaGlyph aria-hidden />} title="Brenda works for each person"
          sub="Everyone names theirs and picks her colour. She knows their day, reminds them, drafts with them and does things for them, with their permission." />
        <div className="mt-14"><BrendaHomeFrame /></div>
        <PointGrid className="mt-3" points={HOW} />
        <p className="mt-6 text-center text-sm font-normal text-secondary">Tell her how you like things done, in your own words, and she follows it. Only you see that list.</p>
      </div>
    </section>
  );
}

/** #assistants: the assistants do the chasing. Text left, the follow-up exchange right. */
export function AssistantsSection() {
  return (
    <section id="assistants" aria-labelledby="assistants-title" className={SECTION}>
      <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
        <Opener id="assistants-title" icon={<MessageSquareReply aria-hidden />} title="The assistants do the chasing"
          lead="Ask yours what Ben is working on. Ben's Brenda answers from his work, and asks Ben once if it can't."
          points={[
            ["Follow-ups, answered from real work.", "Ben's Brenda shares only what you could already see, never his to-dos, day plan, documents, messages or chats with her."],
            ["Messages and requests, passed on.", <>&ldquo;Tell Ada&apos;s assistant the client moved the deadline.&rdquo; &ldquo;Ask Ada&apos;s assistant to add Review pricing to her to-dos.&rdquo; Nothing lands on Ada&apos;s list until she accepts.</>],
            ["Ask any assistant in Messages.", <>Put @ before your assistant&apos;s name in a thread and it answers there. Ask &ldquo;@Ben&apos;s Brenda, where is the deck?&rdquo; and Ben&apos;s assistant answers in the thread.</>],
            ["A standup that writes itself.", "At the time the lead sets, Brenda drafts each person's update from their own work. Nothing is posted until they press Post. The lead gets one rollup, and nobody is chased."],
          ]} />
        <StickyPicture><FollowUpMock /></StickyPicture>
      </div>
    </section>
  );
}

/** #loops: promises don't get lost in the chat. The noted commitment left, text right. */
export function LoopsSection() {
  return (
    <section id="loops" aria-labelledby="loops-title" className={SECTION}>
      <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
        <div className="min-w-0 md:order-2">
          <Opener id="loops-title" icon={<Handshake aria-hidden />} title="Promises don't get lost in the chat"
            lead="Brenda notices what people say they'll do, and puts it on their list only when they say yes."
            points={[
              ["Commitments.", "When the workspace switches it on, Brenda notes promises made in channels and team chats and asks each person whether to add them to their to-dos. Direct messages are never tracked."],
              ["Loose ends.", "Your own Brenda finds promises you made, things asked of you and things you asked of others that never became a to-do. Only you see them."],
              ["Blocked on whom.", "Mark a task blocked and name who it waits on. Their assistant brings them your question."],
              ["The end-of-day report.", "Every lead gets one, written from what they may see: decisions waiting on them, what changed since yesterday, hours and attendance. Nobody writes it, and nobody is scored."],
            ]} />
        </div>
        <StickyPicture className="md:order-1"><CommitmentMock /></StickyPicture>
      </div>
    </section>
  );
}

const CALLS: Point[] = [
  { icon: UserCheck, t: "Notes only with consent", d: "Each person chooses Include me or Not me. No answer counts as no, and only the words of people who agree are written down." },
  { icon: Laptop, t: "Written on your own device", d: "Each person's browser turns their own words into text. No audio is sent for transcription, and calls are never recorded." },
  { icon: ListChecks, t: "A recap with action items", d: "After the call, everyone who joined gets a summary, the decisions and the action items, and a short version goes into the call's thread. Each item waits for its person to accept it." },
  { icon: CalendarX2, t: "Transcripts gone in 7 days", d: "Only the people on the call can read the transcript, and it is deleted 7 days after the recap." },
];

/** #calls: calls, with Brenda's notes. The call and its recap side by side, then the four rules. */
export function CallsSection() {
  return (
    <section id="calls" aria-labelledby="calls-title" className={SECTION}>
      <div className={WRAP}>
        <SectionTitle id="calls-title" icon={<Video aria-hidden />} title="Calls, with Brenda's notes"
          sub="Call anyone you can message, or ring the whole team from its channel, and share your screen. On every plan, ringing in the browser and in Brenda desktop." />
        <div className="mt-14 grid gap-3 md:grid-cols-[1.15fr_1fr]">
          <CallCard />
          <RecapMock />
        </div>
        <PointGrid className="mt-3" points={CALLS} />
      </div>
    </section>
  );
}

/** #desktop: Brenda on your computer. Text left, the notch right. No download link exists, so none is offered. */
export function DesktopSection() {
  return (
    <section id="desktop" aria-labelledby="desktop-title" className={SECTION}>
      <div className={cn(WRAP, "grid items-center gap-12 md:grid-cols-2 lg:gap-16")}>
        <Opener id="desktop-title" icon={<Laptop aria-hidden />} title="Brenda on your computer"
          lead="Brenda desktop sits in your Mac's notch, or at the top of the screen on Windows: your timer, the morning briefing and notifications you can read at a glance, without opening a tab."
          points={[
            ["Hold to talk.", "Hold Option and Space (Alt and Space on Windows) and speak. Your words are turned into text on your computer, and no audio leaves it."],
            ["Calls ring there too.", "Accept or decline a call without finding the tab."],
            ["Quiet when you are.", "During quiet hours no card opens and nothing makes a sound."],
          ]} />
        <StickyPicture><NotchMock /></StickyPicture>
      </div>
    </section>
  );
}
