/**
 * The end-of-day report template (owner request, 17 October 2026: SEO analysis; Content Plan page 2: "the template
 * itself, visible on the page in a copyable block, not gated behind an email form", with downloads). One source for the
 * page's copy blocks and the two download files (end-of-day-report-template.md and .txt, route handlers beside the
 * page), so what you copy and what you download never differ. Plain text, British English, no em dashes.
 */

export const TEMPLATE_PLAIN = `End-of-day report: [your name], [day]

Needs a decision: [what], from [name], by [when]. (Or: nothing needs a decision.)
Changed today: [what you finished, sent or started; what moved]
Blocked: [what], waiting on [name] for [the exact thing you need]. (Or: nothing is blocked.)
Tomorrow: [the first one or two things you will pick up]`;

export const TEMPLATE_STRUCTURED = `# End-of-day report: [your name], [day and date]

## Decisions waiting on someone
- [The decision], needed from [name] by [when], because [what it holds up]

## What changed since yesterday
- Finished: [task or piece of work, with a link]
- Sent for review: [what, and to whom]
- Moved: [started, unblocked, or a deadline that changed, and the new date]

## Blocked, and on whom
- [What is stuck]: waiting on [name] for [the exact thing you need]

## Tomorrow
- [First thing]
- [Second thing, if there is one]`;

export const TEMPLATE_ONE_LINE = `[Day]: finished [x]; blocked on [name] for [y]; tomorrow [z]; [nothing needs a decision / decision needed from name on w].`;

/** The filled-in examples on the template page (three roles), in the structured version. */
export const FILLED_EXAMPLES = [
  {
    role: "Support lead",
    heading: "A support lead's report",
    id: "example-support",
    text: `# End-of-day report: Olu, Tuesday

## Decisions waiting on someone
- Refund over the usual limit for a customer charged twice in September (£240), needed from David by Wednesday noon

## What changed since yesterday
- Finished: 41 tickets closed, queue down from 63 to 29
- Moved: the login-loop issue is now with engineering (ticket linked), no longer on us

## Blocked, and on whom
- Two enterprise account transfers: waiting on Ada for written approval from the account owner

## Tomorrow
- Clear the 9 tickets older than 48 hours
- Draft the help article for the login-loop workaround`,
  },
  {
    role: "Engineer",
    heading: "An engineer's report",
    id: "example-engineer",
    text: `# End-of-day report: Ben, Tuesday

## Decisions waiting on someone
- Keep or drop the old export format: needed from Max before I start the migration on Thursday

## What changed since yesterday
- Finished: password reset emails now send in the person's own language (merged)
- Sent for review: the rate limit on the sign-in form, to Chidi

## Blocked, and on whom
- Nothing is blocked.

## Tomorrow
- Fix the two review comments on the rate limit
- Start the export migration if Max has decided`,
  },
  {
    role: "Designer",
    heading: "A designer's report",
    id: "example-designer",
    text: `# End-of-day report: Ada, Tuesday

## Decisions waiting on someone
- Pick one of the two pricing page layouts (both in the design file): needed from David by Thursday so Ben can build it next week

## What changed since yesterday
- Finished: icon set for the settings pages, handed to Ben
- Moved: the onboarding illustrations are pushed to next Monday (the brand colours are changing)

## Blocked, and on whom
- Pricing page copy: waiting on Chidi for the client's final text

## Tomorrow
- Usability test with three customers at 14:00
- Write up what we learn by end of day`,
  },
] as const;

/**
 * The seven sample reports on /blog/sample-end-of-day-report (Content Plan page 3), line by line, in the plain-text
 * version. Made-up people and work. The bad one is shown with its rewrite on the page; both are in the download.
 */
export const SAMPLE_REPORTS = {
  engineering: [
    "End-of-day report: Ben, Wednesday",
    "Needs a decision: keep or drop the old CSV export, from Max, by Thursday 10:00 (the migration starts then)",
    "Changed today: merged the sign-in rate limit (5 tries a minute per address)",
    "Changed today: sent the password reset rework to Chidi for review",
    "Blocked: deploying to staging, waiting on Olu for the new database credentials",
    "Tomorrow: start the export migration, or the search fix if Max keeps the old export",
  ],
  support: [
    "End-of-day report: Kemi, Wednesday",
    "Needs a decision: a £240 refund outside policy for a customer billed twice, from David, by tomorrow noon",
    "Changed today: queue down from 58 to 22 open tickets",
    "Changed today: the invoice download bug is now with engineering (ticket linked, steps to reproduce included)",
    "Blocked: 3 account deletions, waiting on Ada for the legal team's sign-off",
    "Tomorrow: the 6 tickets older than 48 hours first, then the refunds macro",
  ],
  design: [
    "End-of-day report: Ada, Wednesday",
    "Needs a decision: none today",
    "Changed today: usability test with 3 customers done; 2 of 3 missed the plan switcher",
    "Changed today: settings icon set finished and handed to Ben",
    "Blocked: pricing page copy, waiting on Chidi for the client's final text",
    "Tomorrow: two new versions of the plan switcher, to test on Friday",
  ],
  sales: [
    "End-of-day report: Priya, Wednesday",
    "Needs a decision: a 15% discount on a 40-seat annual deal, from David, before Friday's call",
    "Changed today: two first demos done; one moved to a trial starting Monday",
    "Changed today: one renewal signed (12 months, same terms)",
    "Blocked: a security questionnaire, waiting on Ben for the data retention answers (due to the prospect Thursday)",
    "Tomorrow: send the trial set-up guide; prepare Friday's pricing call",
  ],
  agency: [
    "End-of-day report: Tunde, Wednesday",
    "Needs a decision: the client wants a fourth round of homepage changes, outside the agreed scope; quote it or absorb it, from David, by Friday",
    "Changed today: presented two homepage concepts; the client chose B",
    "Changed today: launch moved from 3 to 10 November at the client's request (confirmed in writing)",
    "Blocked: final logo files, waiting on the client's brand team (asked Monday and today; next reminder Thursday)",
    "Tomorrow: send the client the revised timeline and the scope note",
  ],
  bad: [
    "Hi all! Busy day today.",
    "Worked on lots of things: emails, meetings, the dashboard, some bugs.",
    "Online from 8 to 6, 47 messages sent.",
    "Still waiting on some stuff from people.",
    "Will keep going tomorrow.",
  ],
  rewrite: [
    "End-of-day report: Sam, Wednesday",
    "Needs a decision: ship the dashboard filter on Friday without the date picker, or wait a week; from Max, by Thursday",
    "Changed today: fixed the two dashboard bugs customers reported (both linked)",
    "Blocked: the export button, waiting on Ben for the new file format",
    "Tomorrow: the date picker, if Max wants it in this release",
  ],
  oneLine: [
    "Wednesday: finished the onboarding emails; blocked on Chidi for the pricing copy; tomorrow the usability test; nothing needs a decision.",
  ],
} as const;

const SAMPLE_TITLES: [keyof typeof SAMPLE_REPORTS, string][] = [
  ["engineering", "Engineering"], ["support", "Customer support"], ["design", "Design"], ["sales", "Sales"],
  ["agency", "Agency and client work"], ["bad", "A bad report"], ["rewrite", "The same report, rewritten"], ["oneLine", "The one-line version"],
];

/** The download: every version, the three examples and the seven samples, as Markdown (or the same text as plain text). */
export function templateDownload(): string {
  return [
    "End-of-day report template",
    "From Boredroom: https://www.boredroom.cc/blog/end-of-day-report-template",
    "Free to copy, change and share.",
    "",
    "----------------------------------------",
    "1. The plain-text version (for a chat message)",
    "----------------------------------------",
    "",
    TEMPLATE_PLAIN,
    "",
    "----------------------------------------",
    "2. The structured version (for a document or an email)",
    "----------------------------------------",
    "",
    TEMPLATE_STRUCTURED,
    "",
    "----------------------------------------",
    "3. The one-line version (for teams that hate reports)",
    "----------------------------------------",
    "",
    TEMPLATE_ONE_LINE,
    "",
    "----------------------------------------",
    "Filled-in examples",
    "----------------------------------------",
    ...FILLED_EXAMPLES.flatMap((e) => ["", `(${e.role})`, "", e.text]),
    "",
    "----------------------------------------",
    "Seven sample reports (notes on each: https://www.boredroom.cc/blog/sample-end-of-day-report)",
    "----------------------------------------",
    ...SAMPLE_TITLES.flatMap(([key, title]) => ["", `(${title})`, "", ...SAMPLE_REPORTS[key]]),
    "",
  ].join("\n");
}

export const DOWNLOAD_MD = "/blog/end-of-day-report-template/end-of-day-report-template.md";
export const DOWNLOAD_TXT = "/blog/end-of-day-report-template/end-of-day-report-template.txt";
