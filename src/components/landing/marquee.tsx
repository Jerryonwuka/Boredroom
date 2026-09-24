/** The questions a lead stops sending, sliding past where a logo strip would be. Pure CSS; pauses on hover and under reduced motion. */
const QUESTIONS = ["Are you online?", "What did you do yesterday?", "Any update on the homepage?", "Is it done yet?", "Did you see my message?", "How far with the deck?", "Can you send me a status?", "Why is this late?", "Who is on the invoice page?", "Did anyone start the audit?"];

export function QuestionsMarquee() {
  const row = (hidden: boolean) => QUESTIONS.map((q) => <li key={q} aria-hidden={hidden || undefined} className="lp-glass lp-muted mr-4 shrink-0 rounded-2xl px-6 py-4 font-display text-xl line-through decoration-1 decoration-[var(--border-strong)] md:text-2xl">{q}</li>);
  return (
    <div className="marquee overflow-hidden" style={{ "--marquee-duration": "70s" } as React.CSSProperties}>
      <ul className="marquee-track flex w-max items-center">{row(false)}{row(true)}</ul>
    </div>
  );
}
