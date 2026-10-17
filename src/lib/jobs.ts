/**
 * The web's private Jobs list (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "a private Jobs
 * list on the web (only the person)"; contract N.1, S.9): its words and how a job's status reads. Client-safe and pure.
 */
import type { JobItem } from "@/lib/front";

export const JOB_WORDS = {
  title: "Jobs",
  description: (name: string) => `What ${name} did for you in the background on your Mac. Only you can see this.`,
  back: (name: string) => `Back to ${name}`,
  emptyTitle: "No jobs yet",
  emptyBody: (name: string) => `Hold ⌃ ⌘ on your Mac and ask ${name} to organise your Desktop or rename some photos.`,
  notReady: "Jobs show here after a database update.",
  status: {
    running: "Running",
    asking: "Waiting for your answer",
    paused: "Paused while your Mac sleeps",
    done: "Done",
    stopped: "Stopped",
    said_no: "Stopped",
    expired: "Stopped",
    failed: "Couldn't finish",
    undone: "Undone",
  },
  asked: (words: string) => `You asked: “${words}”`,
  undoOnMac: "Undo is on the Mac where it ran.",
  helper: { files: "Files helper", operator: "Mac operator" },
  of: (done: number, of: number) => `${done} of ${of}`,
  forget: "Forget",
  forgetLabel: (title: string) => `Forget: ${title}`,
  forgotten: "Forgotten.",
  forgetFailed: "That couldn't be forgotten. Try again.",
  live: "Stop it on your Mac first.",
  seeJobs: "See your jobs",
  newFiles: (names: string) => `New: ${names}`,
} as const;

const dateParts = (iso: string, tz: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { d, day };
};

/** "today at 14:05", "yesterday at 09:12", "8 October" ("8 October 2025" in another year), in `tz`. */
export function whenWords(iso: string | null, tz: string, now = new Date()): string {
  if (!iso) return "";
  const { d, day } = dateParts(iso, tz);
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const yesterday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - 86_400_000));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  if (day === today) return `today at ${time}`;
  if (day === yesterday) return `yesterday at ${time}`;
  const sameYear = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric" }).format(d) === new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric" }).format(now);
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

/** Whether a job is still going (its row is live). */
export const jobLive = (j: Pick<JobItem, "status">) => j.status === "running" || j.status === "asking" || j.status === "paused";

/**
 * The status line of a row (S.9): "Running, 23 of 64", "Paused while your Mac sleeps", "Done, today at 14:05", "Stopped,
 * yesterday at 09:12", "Couldn't finish, 8 October", "Undone, today at 14:20". Status words always beside any colour.
 */
export function jobStatusWords(j: Pick<JobItem, "status" | "progress" | "endedAt" | "startedAt" | "undo">, tz: string, now = new Date()): string {
  const W = JOB_WORDS.status;
  if (j.status === "running" || j.status === "asking") {
    const word = j.status === "asking" ? W.asking : W.running;
    return j.progress.of > 0 ? `${word}, ${JOB_WORDS.of(j.progress.done, j.progress.of)}` : word;
  }
  if (j.status === "paused") return W.paused;
  if (j.undo.undoneAt) return `${W.undone}, ${whenWords(j.undo.undoneAt, tz, now)}`;
  const word = W[j.status] ?? W.stopped;
  const when = whenWords(j.endedAt ?? j.startedAt, tz, now);
  return when ? `${word}, ${when}` : word;
}

/** The status's tone for a dot: live (orange, working), paused (amber), done (green), failed (red), else neutral. */
export function jobTone(j: Pick<JobItem, "status" | "undo">): "live" | "paused" | "done" | "failed" | "neutral" {
  if (j.status === "running" || j.status === "asking") return "live";
  if (j.status === "paused") return "paused";
  if (j.undo.undoneAt) return "neutral";
  if (j.status === "done") return "done";
  if (j.status === "failed") return "failed";
  return "neutral";
}
