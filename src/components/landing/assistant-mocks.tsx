import { NotebookPen, SquareCheckBig } from "lucide-react";
import { BrendaFace } from "@/components/app/brenda-face";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { FAKE_BUTTON, Pane, arrive } from "@/components/landing/parts";
import type { AssistantColour, AssistantLook } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/**
 * Pictures of the assistants at work for the landing page (owner request, 10 October 2026: "communicate our updated
 * features"), drawn after the real parts: the follow-up exchange (components/app/follow-up-exchange), a noted
 * commitment, Brenda's notes from a call and Brenda desktop in the notch. Each is role="img" with a description of what
 * it shows; its insides are hidden from assistive technology. Server-rendered; only the faces are client islands, and
 * they never talk (`quiet`). Orange only where the app puts it: the running timer and its live dot, and the notch's one
 * button.
 *
 * Each acts out its story once as it arrives (owner request, 10 October 2026; arrival.tsx): Max's question, then Ben's
 * Brenda's answer and "Answered" lighting; Ada's line, its "Noted" chip, then the card asking to add it; the recap
 * filling in; the notch's card opening out of the bar. Delays are the story's beats in ms. A box that holds words only
 * ever scales evenly, so no letter is squashed on its way in (review fix, 10 October 2026). The server renders the
 * finished picture, which is all reduced motion and no-script visitors see.
 */

/** Every face here wears Brenda's own look (bean visor, pill eyes); only the colour changes. */
const look = (colour: AssistantColour): AssistantLook => ({ colour, visor: "bean", eyes: "pill" });

const BUBBLE = "w-fit max-w-full rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground";
const fake = (variant: "primary" | "secondary" | "ghost") => cn(buttonVariants({ variant, size: "xs" }), FAKE_BUTTON);

/** A follow-up between two assistants, answered from the work (the exchange card in the app). */
export function FollowUpMock({ className }: { className?: string }) {
  return (
    <Pane data-lp-arrive className={cn("lp-item p-4 sm:p-5", className)}>
      <div role="img" aria-label="A follow-up between assistants: Olu's Max asked Ben's Brenda where the landing page is, and Ben's Brenda answered from Ben's work that it is on track, 3 of 4 sections done, due Friday.">
        <div aria-hidden className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <BrendaFace size="sm" look={look("coral")} quiet className="shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">Olu&apos;s Max asked Ben&apos;s Brenda<span className="ml-1.5 font-normal tabular-nums text-subtle">15:40</span></p>
            <span className="lp-item lp-pop inline-flex" style={arrive(0, 2000)}><Badge tone="success">Answered</Badge></span>
          </div>
          <p className={cn(BUBBLE, "lp-item")} style={arrive(0, 250)}>Where is the landing page?</p>
          <span className="lp-item inline-flex h-7 w-fit items-center gap-1.5 rounded-lg border border-border-input px-2 text-xs font-medium text-foreground" style={arrive(0, 400)}>
            <SquareCheckBig className="size-3.5 text-secondary" />Landing page
          </span>
          <div className="lp-item mt-2 flex items-center gap-2.5 border-t border-border pt-4" style={arrive(0, 1100)}>
            <BrendaFace size="sm" look={look("blue")} quiet className="shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">Ben&apos;s Brenda<span className="ml-1.5 font-normal text-subtle">15:41, answered from Ben&apos;s work</span></p>
          </div>
          <p className={cn(BUBBLE, "lp-item")} style={arrive(0, 1400)}>On track: 3 of 4 sections done, due Friday.</p>
          <p className="lp-item text-xs font-normal text-subtle" style={arrive(0, 1600)}>Written by AI from Ben&apos;s work</p>
        </div>
      </div>
    </Pane>
  );
}

/** A promise in a channel, noted, and the card that asks before anything is added. */
export function CommitmentMock({ className }: { className?: string }) {
  return (
    <Pane data-lp-arrive className={cn("lp-item p-4 sm:p-5", className)}>
      <div role="img" aria-label="Brenda noted Ada's promise to send the deck on Thursday and asks Ada whether to add it to her to-dos.">
        <div aria-hidden>
          <p className="text-meta font-medium text-secondary">#Design</p>
          <div className="lp-item mt-3 flex gap-3" style={arrive(0, 200)}>
            <Avatar profileId="landing-Ada Obi" name="Ada Obi" size={28} />
            <div className="min-w-0 flex-1">
              <p className="text-sm"><span className="font-semibold text-foreground">Ada</span><span className="ml-2 text-xs font-normal tabular-nums text-subtle">10:14</span></p>
              <p className="mt-0.5 text-sm font-normal text-secondary">I&apos;ll send the deck Thursday.</p>
              <span className="lp-item lp-pop mt-2 block w-fit" style={arrive(0, 900)}><Badge><NotebookPen className="size-3" />Noted</Badge></span>
            </div>
          </div>
          <div className="lp-item mt-5 border-t border-border pt-5" style={{ ...arrive(0, 1450), "--lp-from": "translate3d(0, 20px, 0)" } as React.CSSProperties}>
            <div className="flex items-start gap-3">
              <BrendaFace size="sm" look={look("white")} quiet className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Brenda noted you said you&apos;d &ldquo;Send the deck&rdquo;</p>
                <p className="mt-0.5 text-meta font-normal text-secondary">Due Thursday, from #Design</p>
                <p className="mt-3 text-sm font-normal text-foreground">Add it to your to-dos?</p>
                <p className="mt-1 text-xs font-normal text-subtle">Nothing is added until you accept.</p>
                <div className="lp-item mt-4 flex flex-wrap gap-2" style={arrive(0, 1850)}>
                  <span className={fake("primary")}>Add to my to-dos</span>
                  <span className={fake("secondary")}>Decline</span>
                  <span className={fake("ghost")}>Not a commitment</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Pane>
  );
}

/** Brenda's notes after a call: the summary, a decision, and action items each waiting for its person. */
export function RecapMock({ className }: { className?: string }) {
  const items = [
    { who: "Ada", what: "Send the deck to the client", when: "Thursday", badge: <Badge>Waiting for Ada</Badge>, at: 1100 },
    { who: "Ben", what: "Update the pricing table", when: "Friday", badge: <span className="lp-item lp-pop inline-flex" style={arrive(0, 1900)}><Badge tone="success">Accepted</Badge></span>, at: 1250 },
  ];
  return (
    <Pane data-lp-arrive className={cn("lp-item p-4 sm:p-5", className)} style={arrive(0, 250)}>
      <div role="img" aria-label="Brenda's notes from a call in #Design: a summary, one decision and two action items, each waiting for its person to accept.">
        <div aria-hidden>
          <div className="flex items-center gap-2.5">
            <BrendaFace size="sm" look={look("white")} quiet />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">Notes from the call in #Design</p>
              <p className="truncate text-meta font-normal text-secondary">12 min, notes from Ada and Ben</p>
            </div>
          </div>
          <div className="lp-item" style={arrive(0, 550)}>
            <p className="mt-5 text-meta font-medium text-secondary">Summary</p>
            <p className="mt-1 text-sm font-normal text-foreground">Revision 2 is approved. The deck goes to the client on Friday.</p>
          </div>
          <div className="lp-item" style={arrive(0, 750)}>
            <p className="mt-4 text-meta font-medium text-secondary">Decisions</p>
            <p className="mt-1 text-sm font-normal text-foreground">Ship revision 2 on Friday</p>
          </div>
          <p className="lp-item mt-4 text-meta font-medium text-secondary" style={arrive(0, 950)}>Action items</p>
          <ul className="lp-item mt-1.5 divide-y divide-border rounded-xl border border-border" style={arrive(0, 950)}>
            {items.map((i) => (
              <li key={i.who} className="lp-item flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5" style={arrive(0, i.at)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{i.what}</span>
                  <span className="block truncate text-meta font-normal text-secondary">{i.who}, {i.when}</span>
                </span>
                {i.badge}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-normal text-subtle">Each person accepts their own.</p>
          <p className="mt-4 border-t border-border pt-3 text-meta font-normal text-subtle">Transcript: deleted on 17 October</p>
        </div>
      </div>
    </Pane>
  );
}

/**
 * Brenda desktop in a Mac's notch: the compact bar (her face, the task, the live timer) and the morning briefing open
 * under it. The island is always true black, as on the Mac, so it is drawn in the dark theme whatever the page's.
 */
export function NotchMock({ className }: { className?: string }) {
  const rows = [
    { t: "Homepage design", a: "due Friday" },
    { t: "Ben's Brenda asked about the deck", a: "Reply" },
    { t: "Your standup draft is ready", a: "Post" },
  ];
  return (
    <div data-lp-arrive className={cn("lp-item min-w-0 overflow-hidden rounded-2xl border border-border bg-fill-0", className)}>
      <div role="img" aria-label="Brenda desktop in a Mac's notch: the running timer for Homepage design and the morning briefing with three things waiting." className="flex justify-center px-3 pb-8 sm:px-6 sm:pb-10">
        <div aria-hidden data-theme="dark" className="w-full max-w-[360px] bg-transparent text-foreground">
          <div className="lp-item mx-auto flex h-8 w-fit max-w-full origin-top items-center gap-2 rounded-b-[18px] bg-black px-3.5" style={{ ...arrive(0, 250), "--lp-from": "translate3d(0, -6px, 0) scale(0.88)", "--lp-dur": "560ms" } as React.CSSProperties}>
            <BrendaFace size="sm" look={look("coral")} quiet className="shrink-0 scale-[0.8]" />
            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">Homepage design</span>
            <StatusDot tone="live" pulse={false} />
            <span className="font-mono text-[13px] tabular-nums text-accent-text">1:42:07</span>
          </div>
          {/* The briefing opens out of the bar, as on the Mac: the black card drops from under it and settles (evenly, so
              nothing in it is squashed), and its words arrive once it is in place (from 1450ms). */}
          <div className="lp-item mt-2 origin-top rounded-[22px] bg-black p-4 shadow-sheet" style={{ ...arrive(0, 800), "--lp-from": "translate3d(0, -24px, 0) scale(0.92)", "--lp-dur": "650ms" } as React.CSSProperties}>
            <div className="lp-item" style={arrive(0, 1450)}>
              <p className="text-sm font-semibold text-foreground">Good morning, Ada.</p>
              <p className="mt-0.5 text-[13px] font-normal text-secondary">3 things are waiting on you.</p>
            </div>
            <ul className="mt-3 space-y-1">
              {rows.map((r, n) => (
                <li key={r.t} className="lp-item flex h-8 items-center gap-3 rounded-lg bg-fill-0 px-2.5" style={arrive(0, 1580 + n * 110)}>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{r.t}</span>
                  <span className="shrink-0 text-xs font-normal text-secondary">{r.a}</span>
                </li>
              ))}
            </ul>
            <span className={cn(buttonVariants({ variant: "accent", size: "xs" }), FAKE_BUTTON, "lp-item mt-3 w-full rounded-full")} style={arrive(0, 1980)}>Start on the briefing</span>
          </div>
        </div>
      </div>
    </div>
  );
}
