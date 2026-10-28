/**
 * What Brenda did on the person's Mac lately, as Boredroom for Mac records it (owner report, 28 October 2026: "open a new
 * tab in Brave" got "Opened Brave Browser"; then, keys held, "Are you alright, are you okay?" went to a look, which
 * answered "I did not open any tab in Brave. I can't control your browser, so my earlier 'Opened Brave Browser' replies
 * were wrong"). The look knew neither what the front desk had just done nor what Brenda for Mac can do.
 *
 * The Mac sends its own record with a look (`recent`) and with the notch's chat (`macRecent`): at most six done lines from
 * the last ten minutes, each with how many minutes ago, written by Rust from its fixed lines (front.rs `remember`), never
 * screen text. Here they are checked (zod, bounded), kept only when they are one of the fixed lines (`frontLineOk`), and
 * said to the model as Boredroom's record, quoted. Both fields are optional: a Mac that doesn't send them is unchanged.
 *
 * Pure; no I/O. Shared by screen-help.ts (the look body), copilot.ts (the situation) and the chat schema.
 */
import { z } from "zod";
import { frontLineOk } from "@/lib/front";
import { neutralise, oneLine } from "@/server/services/copilot-excerpt";

export const MAC_RECENT_LIMITS = { count: 6, lineChars: 200, minutes: 10 } as const;

/** The field as the Mac sends it; anything over the bounds refuses the body (as any other bad field does). */
export const macRecentSchema = z.array(z.object({
  line: z.string().trim().min(1).max(MAC_RECENT_LIMITS.lineChars),
  minutesAgo: z.number().int().min(0).max(MAC_RECENT_LIMITS.minutes),
})).max(MAC_RECENT_LIMITS.count);
export type MacRecent = z.infer<typeof macRecentSchema>;

/** Only Brenda's own fixed done lines ("Opened Brave Browser."), oldest first; anything else is dropped. */
export function cleanMacRecent(v: MacRecent | undefined | null): MacRecent {
  return (v ?? []).filter((r) => frontLineOk(r.line)).slice(-MAC_RECENT_LIMITS.count).map((r) => ({ line: r.line.trim(), minutesAgo: r.minutesAgo }));
}

const ago = (m: number) => (m <= 0 ? "just now" : m === 1 ? "1 minute ago" : `${m} minutes ago`);

/** The situation's line: what she did on their Mac lately, as facts; "" when there is nothing. */
export function macRecentLine(v: MacRecent | undefined | null): string {
  const r = cleanMacRecent(v);
  if (!r.length) return "";
  return `What you did on their Mac in the last few minutes (Boredroom's record): ${r.map((x) => `${JSON.stringify(neutralise(oneLine(x.line)))} (${ago(x.minutesAgo)})`).join("; ")}. These are facts: you did them, through Brenda for Mac. If they ask about one, say what it did, in these words; never say it didn't happen.`;
}

/**
 * What Brenda for Mac can do, for a look from a Mac with the front desk (owner report, 28 October 2026: "I can't control
 * your browser"). Never "ask again": NEVER_ASK_AGAIN_LINE stands (tests/unit/key-held-loop.test.ts).
 */
export const MAC_CAN_DO_LINE = "Brenda for Mac (you) opens apps, files, folders and web pages for them, a page in the browser they name, a new browser tab or window, and Google searches, when they ask, and acts after their yes. Never say you can't control their browser or their Mac.";
