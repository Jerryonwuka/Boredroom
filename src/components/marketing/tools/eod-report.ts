/**
 * The end-of-day report generator's template (owner request, 17 October 2026: SEO analysis, Content Plan page 14). Pure
 * functions, no AI and no network: a few bullet points in, a tidy report out, the same every time for the same input.
 * The page runs it in the browser; the examples on the page are built by it on the server, so they always match what
 * the tool would write. The sections follow the order Brenda's own report uses for a lead (decisions waiting first,
 * then what changed), plus what is blocked and tomorrow's plan.
 *
 * Tidying: one item per line; a leading list marker is dropped ("•" or "·" on its own; "-", "*", "–", "1." or "2)" only
 * when a space follows, so "2.0 release", "10.5 hours" and "-5% churn" keep their numbers: review fix, 17 October 2026);
 * the first letter is capitalised; one trailing full stop is dropped (list items read better without); blank lines and
 * lines that are only a marker are ignored.
 */

export type ReportInput = {
  name: string;
  team: string;
  date: string;
  hours: string;
  decisions: string;
  changed: string;
  blocked: string;
  tomorrow: string;
};

export type ReportKind = "eod" | "standup";
export type ReportFormat = "text" | "markdown";

export const EMPTY_INPUT: ReportInput = { name: "", team: "", date: "", hours: "", decisions: "", changed: "", blocked: "", tomorrow: "" };

/** The lines of a box as tidy list items. */
export function items(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(?:[•·]+\s*|[-*–]+(?:\s+|$)|\d{1,2}[.)](?:\s+|$))/, "").trim())
    .filter(Boolean)
    .map((l) => l.replace(/(?<!\.)\.$/, ""))
    .map((l) => l.charAt(0).toLocaleUpperCase("en-GB") + l.slice(1));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under the title: plain counts of what is in the report, nothing judged. */
export function summaryLine(input: ReportInput): string {
  const c = items(input.changed).length, d = items(input.decisions).length, b = items(input.blocked).length;
  const parts = [count(c, "change", "changes"), count(d, "decision waiting", "decisions waiting"), b ? count(b, "blocker", "blockers") : "nothing blocked"];
  return parts.join(", ") + ".";
}

type Section = { title: string; lines: string[]; empty: string };

function sections(input: ReportInput, kind: ReportKind): Section[] {
  if (kind === "standup") {
    return [
      { title: "Yesterday", lines: items(input.changed), empty: "Nothing to report" },
      { title: "Today", lines: items(input.tomorrow), empty: "Not planned yet" },
      { title: "Blockers", lines: items(input.blocked), empty: "None" },
      { title: "Waiting on a decision", lines: items(input.decisions), empty: "None" },
    ];
  }
  return [
    { title: "Decisions waiting on someone", lines: items(input.decisions), empty: "None" },
    { title: "What changed since yesterday", lines: items(input.changed), empty: "Nothing changed" },
    { title: "Blocked, and on whom", lines: items(input.blocked), empty: "Nothing blocked" },
    { title: "Tomorrow", lines: items(input.tomorrow), empty: "Not planned yet" },
  ];
}

/** The report, as plain text (headings with a colon) or Markdown (## headings), ready to paste. */
export function buildReport(input: ReportInput, kind: ReportKind = "eod", format: ReportFormat = "text"): string {
  const md = format === "markdown";
  const name = input.name.trim(), team = input.team.trim(), date = input.date.trim(), hours = input.hours.trim();
  const what = kind === "standup" ? "Standup update" : "End-of-day report";
  const who = [name, team].filter(Boolean).join(", ");
  const title = [what, who].filter(Boolean).join(": ") + (date ? `, ${date}` : "");
  const out: string[] = [md ? `# ${title}` : title];
  if (kind === "eod") out.push("", summaryLine(input) + (hours ? ` Hours today: ${hours}.` : ""));
  else if (hours) out.push("", `Hours yesterday: ${hours}.`);
  for (const s of sections(input, kind)) {
    out.push("", md ? `## ${s.title}` : `${s.title}:`);
    for (const l of s.lines.length ? s.lines : [s.empty]) out.push(`- ${l}`);
  }
  return out.join("\n") + "\n";
}

/** A file name for the download: "end-of-day-report-ada.md". */
export function reportFilename(input: ReportInput, kind: ReportKind, format: ReportFormat): string {
  const slug = input.name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${kind === "standup" ? "standup-update" : "end-of-day-report"}${slug ? `-${slug}` : ""}.${format === "markdown" ? "md" : "txt"}`;
}

/** Three worked examples (the brief: engineering, support, design). Made-up people and work, labelled as examples. */
export const EXAMPLES: readonly { id: "engineering" | "support" | "design"; label: string; input: ReportInput }[] = [
  {
    id: "engineering",
    label: "Engineering",
    input: {
      name: "Ada", team: "Payments", date: "16 October 2026", hours: "7.5",
      decisions: "Ship the retry fix on Friday or wait for Monday's freeze? Waiting on Sam\nSandbox keys for the new provider: waiting on Ifeoma",
      changed: "- Refund webhook merged and live in staging\n- Flaky checkout test fixed (timezone in the fixture)\n- Started the retry backoff change, about half done.",
      blocked: "Load test needs the staging database resized, on the platform team",
      tomorrow: "finish the retry backoff change\nreview Tunde's invoice PDF pull request",
    },
  },
  {
    id: "support",
    label: "Support",
    input: {
      name: "Kemi", team: "Customer support", date: "16 October 2026", hours: "8",
      decisions: "Refund for the double-charged annual plan (ticket 4182): over my limit, waiting on Dami",
      changed: "* 31 tickets closed, 6 still open\n* Wrote the help article on changing the billing email\n* Two reports of the export timing out: passed to engineering with steps",
      blocked: "",
      tomorrow: "Follow up the 6 open tickets\nCheck whether the export fix is in",
    },
  },
  {
    id: "design",
    label: "Design",
    input: {
      name: "Ben", team: "Design", date: "16 October 2026", hours: "",
      decisions: "Pick one of the two onboarding directions before Thursday's review: waiting on Olu",
      changed: "1. Onboarding screens: both directions ready to compare\n2. Empty states for the reports page finished and handed over\n3. Icon set moved to the shared library",
      blocked: "Final pricing copy, waiting on marketing",
      tomorrow: "Prototype the chosen onboarding direction\nSit in on two user interviews",
    },
  },
];
