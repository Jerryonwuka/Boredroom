/**
 * Brenda's research in the background (owner decision, 28 October 2026: "Brenda, research X and give me a PDF when you're
 * done": she works in the background while the person carries on, then tells them). The shapes, limits and words the
 * server, the Research page and Brenda share. Client-safe and pure.
 */

export const RESEARCH_FORMATS = ["pdf", "docx", "md"] as const;
export type ResearchFormat = (typeof RESEARCH_FORMATS)[number];
export const RESEARCH_STATUSES = ["queued", "running", "done", "failed", "stopped"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export const isResearchFormat = (v: unknown): v is ResearchFormat => typeof v === "string" && (RESEARCH_FORMATS as readonly string[]).includes(v);
export const researchLive = (s: ResearchStatus) => s === "queued" || s === "running";

/**
 * The limits (owner decision, 28 October 2026). Per job: about 15 web searches and 10 page fetches (the tools' max_uses,
 * counted across the job's model calls), at most 8 model calls (pause_turn continuations included), 20 minutes of the
 * model's own time in all (a worker that stopped does not use it up), and a report of at most 200,000 characters. Per
 * person: 5 a day by default (BRENDA_RESEARCH_DAILY), counted from local midnight in the workspace's time zone.
 */
export const RESEARCH_LIMITS = {
  topic: 500,
  focus: 1000,
  searches: 15,
  fetches: 10,
  steps: 8,
  /** Tries of one step (a model call that failed or a worker that stopped mid-call) before the report fails. */
  stepTries: 3,
  activeMs: 20 * 60_000,
  /** Per model call. Under the worker's 15 minutes before it takes a running job back. */
  callTimeoutMs: 8 * 60_000,
  maxTokens: 32_000,
  markdownChars: 200_000,
  /** A live report older than this is given up on by the purge (the worker never came back for it). */
  staleHours: 48,
  dailyDefault: 5,
  keepDays: 90,
  listMax: 50,
} as const;

export type ResearchSource = { n: number; url: string; title: string };
export type ResearchSection = { heading: string; body: string };
/** The finished report's structure (research_reports.report). Every string is the model's words, plain text or light Markdown. */
export type ResearchReport = {
  title: string;
  summary: string;
  keyFindings: string[];
  sections: ResearchSection[];
  sources: ResearchSource[];
  /** When it was written (ISO), and the question it answers. */
  writtenAt: string;
  topic: string;
};

/** One row of the person's list (the page, the route and research_status). Never anyone else's. */
export type ResearchItem = {
  id: string;
  topic: string;
  focus: string | null;
  format: ResearchFormat;
  status: ResearchStatus;
  title: string | null;
  error: string | null;
  searches: number;
  sources: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export const FORMAT_LABEL: Record<ResearchFormat, string> = { pdf: "PDF", docx: "Word", md: "Markdown" };
export const FORMAT_EXT: Record<ResearchFormat, string> = { pdf: ".pdf", docx: ".docx", md: ".md" };
export const FORMAT_TYPE: Record<ResearchFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
};

/** A safe file name from a title: letters, digits, spaces and dashes, at most 80 characters. */
export function fileNameOf(title: string, format: ResearchFormat): string {
  const base = title.normalize("NFKD").replace(/[^\p{L}\p{N} \-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim() || "Research";
  return `${base}${FORMAT_EXT[format]}`;
}

export const RESEARCH_WORDS = {
  title: "Research",
  description: (name: string) => `What you asked ${name} to look into on the web, and the reports ${name} wrote. Only you can see this.`,
  back: (name: string) => `Back to ${name}`,
  emptyTitle: "No research yet",
  emptyBody: (name: string) => `Ask ${name} to research something, like “research the best time-tracking tools for small teams and give me a PDF”.`,
  notReady: "Research shows here after a database update.",
  status: {
    queued: "Waiting to start",
    running: "Researching",
    done: "Ready",
    failed: "Couldn't finish",
    stopped: "Stopped",
  } satisfies Record<ResearchStatus, string>,
  queuedSlow: "Waiting to start: the background worker isn't running right now, so it starts when it does",
  started: (when: string) => `started ${when}`,
  asked: (when: string) => `asked ${when}`,
  finished: (when: string) => `finished ${when}`,
  sources: (n: number) => `${n} ${n === 1 ? "source" : "sources"}`,
  download: (f: ResearchFormat) => FORMAT_LABEL[f],
  downloadLabel: (f: ResearchFormat, title: string) => `Download ${title} as ${FORMAT_LABEL[f]}`,
  stop: "Stop",
  stopLabel: (title: string) => `Stop: ${title}`,
  stopped: "Stopped.",
  stopFailed: "That couldn't be stopped. Try again.",
  stopTitle: "Stop this research?",
  stopBody: "Nothing more is looked up and no report is written.",
  /** Brenda's own words (her tools and notifications). */
  brenda: {
    notReady: "Research isn't available yet: it needs a database update first.",
    off: "Research is switched off on Boredroom right now, so I can't start it.",
    noKey: "Research isn't available right now: Boredroom's AI isn't connected.",
    cap: (limit: number) => `You've asked for ${limit} pieces of research today, which is the most for one day. You can ask again tomorrow.`,
    tainted: "Not from this reply: other people's words are in it. Ask me again in a new message and I'll start it.",
    thread: "Ask me to research something in your own chat.",
    started: "Started. I'll tell you when it's ready.",
    stopped: "Stopped.",
    notFound: "I couldn't find that research.",
    alreadyEnded: "That research has already finished.",
  },
  notice: {
    readyTitle: (title: string) => `Your research is ready: ${title}`,
    readyBody: (format: ResearchFormat, sources: number) => `${FORMAT_LABEL[format]}, ${sources} ${sources === 1 ? "source" : "sources"}.`,
    failedTitle: (topic: string) => `Research couldn't finish: ${topic}`,
  },
  errors: {
    tooLong: "It took longer than research may take, so it stopped before a report was written.",
    tooManySteps: "It needed more steps than research may take, so it stopped before a report was written.",
    refused: "This topic couldn't be researched.",
    model: "The AI couldn't be reached for long enough to finish.",
    empty: "No report came back.",
    off: "Research was switched off on Boredroom before it finished.",
    noKey: "Boredroom's AI isn't connected, so it couldn't start.",
    stale: "The background worker didn't come back to it, so it was given up.",
  },
} as const;
