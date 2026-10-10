/**
 * A call's line in its thread (owner decisions, 8 October 2026: phase 8, calls; D11, contract D.7). Not a bubble: a
 * centred compact row with a phone (a crossed-out phone for a missed one), the words, the time and one action.
 *
 * - A group call: "Ada started a call", then while it runs the live mark and "Join"; once over, "Call ended, 12 min,
 *   3 people".
 * - A one-to-one call (its line is written when it ends): "Missed call from Ada", "Declined call from Ada" (fix review,
 *   10 October 2026: a declined call is not a missed one) or "Call, 12 min", with "Call back".
 *
 * The call's state comes with the thread (`MessageRow.call`), so the line is right on every refresh; the thread refreshes
 * on the calls tables' events only on the Calls pages, and the call's own components refresh themselves elsewhere. Works
 * in server and client components (its button is a client component).
 */
import Link from "next/link";
import { Phone, PhoneMissed, PhoneOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LiveIndicator } from "@/components/ui/status-dot";
import { CallButton } from "@/components/app/call-button";
import { CALL_WORDS, type CallLineView } from "@/lib/calls";
import { cn } from "@/lib/utils";

function secondsOf(line: Pick<CallLineView, "answeredAt" | "endedAt">): number | null {
  if (!line.answeredAt || !line.endedAt) return null;
  const s = (Date.parse(line.endedAt) - Date.parse(line.answeredAt)) / 1000;
  return Number.isFinite(s) ? Math.max(0, Math.round(s)) : null;
}

/** The line's words (pure; the thread's list preview uses the body the server wrote). */
export function callLineWords(line: CallLineView): { text: string; missed: boolean; declined: boolean; live: boolean } {
  const live = line.state !== "ended";
  if (line.kind === "group") {
    return live ? { text: CALL_WORDS.thread.started(line.startedBy.firstName), missed: false, declined: false, live } : { text: CALL_WORDS.thread.endedGroup(secondsOf(line), line.joinedCount), missed: false, declined: false, live };
  }
  if (!line.answeredAt && !live && line.endReason === "declined") return { text: CALL_WORDS.thread.declined(line.startedBy.firstName), missed: false, declined: true, live };
  if (!line.answeredAt && !live) return { text: CALL_WORDS.thread.missed(line.startedBy.firstName), missed: true, declined: false, live };
  return { text: live ? CALL_WORDS.thread.started(line.startedBy.firstName) : CALL_WORDS.thread.done(secondsOf(line)), missed: false, declined: false, live };
}

export function CallThreadLine({ line, orgSlug, time, callBack, available }: {
  line: CallLineView; orgSlug: string;
  /** The message's time, already formatted ("14:05"), with its full date as a title. */
  time: React.ReactNode;
  /** A one-to-one thread's other person (for "Call back"). */
  callBack: { membershipId: string; name: string } | null;
  available: boolean;
}) {
  const { text, missed, declined, live } = callLineWords(line);
  const Icon = missed ? PhoneMissed : declined ? PhoneOff : Phone;
  return (
    <div className="my-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-center text-meta">
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-fill-1", missed ? "text-danger" : "text-secondary")}><Icon className="size-3.5" aria-hidden /></span>
      <span className={cn("font-medium", missed ? "text-foreground" : "text-secondary")}>{text}</span>
      {live ? <LiveIndicator>{CALL_WORDS.thread.live}</LiveIndicator> : null}
      <span className="text-xs font-medium tabular-nums text-subtle">{time}</span>
      {live ? (
        <Link href={line.href} className={buttonVariants({ variant: "secondary", size: "xs" })}>{line.inRoom ? CALL_WORDS.joinCount(line.inRoom) : CALL_WORDS.join}</Link>
      ) : line.kind === "direct" && callBack ? (
        <CallButton orgSlug={orgSlug} target={{ kind: "person", membershipId: callBack.membershipId, name: callBack.name }} live={null} available={available} size="xs" variant="ghost" label={CALL_WORDS.callBack} />
      ) : (
        <Link href={line.href} className="link-inline text-xs font-medium text-secondary">{CALL_WORDS.thread.details}</Link>
      )}
    </div>
  );
}
