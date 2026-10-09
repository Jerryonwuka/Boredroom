import Link from "next/link";
import { Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { whenLabel } from "@/lib/follow-ups";
import { LOOP_WORDS, type WaitingOnList } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const P = LOOP_WORDS.page;

/**
 * "Waiting on" (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed", blocked on whom; contract
 * E.2 and H.4): who is blocked on whom, from the open "blocked on" questions the viewer may see (their own, as the
 * blocked person or the one waited on; a lead's teams; the owner and HR, everyone's), oldest first. Above it, the
 * summary by the person waited on as a compact list ("Ada Employee: 3", most first). Each row: "Ben Okafor is waiting on
 * Ada Employee", the question as typed (plain text in “ ”), the task (a link only when the viewer may open it), and
 * "since Tue 6 Oct 09:14". Rendered on the server: no buttons (the person waited on answers in "Between assistants").
 */
export function WaitingOnView({ list, timeZone, now, className }: { list: WaitingOnList; timeZone: string; now: number; className?: string }) {
  if (!list.items.length) return <EmptyState icon={Hourglass} title={P.emptyWaiting.title} description={P.emptyWaiting.body} className={className} />;
  const at = (iso: string) => whenLabel(iso, timeZone, new Date(now));
  return (
    <div className={cn("space-y-8", className)}>
      {list.byPerson.length > 1 ? (
        <section aria-labelledby="waiting-by-person">
          <h2 id="waiting-by-person" className="mb-2 text-sm font-medium text-secondary">Waited on most</h2>
          <ul className="flex flex-wrap gap-2">
            {list.byPerson.map((p) => (
              <li key={p.waitingOn.membershipId} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-meta font-medium text-foreground">
                {p.waitingOn.name}:<span className="tabular-nums">{p.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul aria-label={P.tabs.waitingOn} className="space-y-2">
        {list.items.map((b) => {
          const blocked = b.viewer === "blocked" ? "You" : b.blocked.name;
          const waitingOn = b.viewer === "waiting_on" ? "you" : b.waitingOn.name;
          return (
            <li key={b.id} className="card-panel flex min-w-0 flex-col gap-1.5 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-medium text-foreground">{blocked === "You" ? `You are waiting on ${waitingOn}` : P.waitingRow(blocked, waitingOn)}</p>
                <Badge tone={b.badge.tone} className="shrink-0">{b.badge.label}</Badge>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm font-normal text-secondary">“{b.question}”</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta font-normal text-secondary">
                {b.taskHref ? <Link href={b.taskHref} prefetch={false} className="link-inline min-w-0 break-words">{b.taskTitle}</Link> : <span className="min-w-0 break-words">{b.taskTitle}</span>}
                <span>{P.since(at(b.createdAt))}</span>
                {b.viewer === "waiting_on" ? <Link href={b.href} prefetch={false} className="link-inline">Answer in Between assistants</Link> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
