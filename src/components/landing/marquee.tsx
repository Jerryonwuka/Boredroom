import { PauseMotion } from "@/components/landing/pause-motion";

/**
 * The questions a lead stops sending, sliding past where a logo strip would be: quiet v4 chips (r12, a hairline,
 * fill-0, 15px in the secondary grey, struck through). Pure CSS (globals.css §6 `.marquee`); pauses on hover or with the
 * Pause button under it (which stops every strip on the page), and stops under reduced motion. The second copy of the list is hidden from assistive technology.
 */
const QUESTIONS = ["Are you online?", "What did you do yesterday?", "Any update on the homepage?", "Is it done yet?", "Did you see my message?", "How far with the deck?", "Can you send me a status?", "Why is this late?", "Who is on the invoice page?", "Did anyone start the audit?"];

export function QuestionsMarquee() {
  const row = (hidden: boolean) => QUESTIONS.map((q) => (
    <li key={q} aria-hidden={hidden || undefined} className="mr-3 flex h-11 shrink-0 items-center rounded-xl border border-border bg-fill-0 px-4 text-[15px] font-normal text-secondary line-through decoration-subtle decoration-1">{q}</li>
  ));
  return (
    <div>
      <div className="marquee overflow-hidden" style={{ "--marquee-duration": "70s" } as React.CSSProperties}>
        <ul className="marquee-track flex w-max items-center">{row(false)}{row(true)}</ul>
      </div>
      <div className="mt-2 flex justify-end"><PauseMotion /></div>
    </div>
  );
}
