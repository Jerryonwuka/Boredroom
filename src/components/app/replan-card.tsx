"use client";

/**
 * A re-plan suggested to the lead (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed", stalled
 * re-plan; contract F and H.6): when the chase routine finds a task stalled a second time, its follow-up answer comes
 * with a new due date to confirm. Shown on the follow-up's page under the answer, to the lead who asked only.
 *
 * "“Landing page” stalled again. Suggested new due date: Tue 13 Oct, 17:00.", then **Confirm new date** (white: the one
 * primary), "Change date" (a date picker, then Confirm with that date) and "Not now". Nothing on the task changes until
 * the lead confirms; confirming changes the due date as the lead, with their own permission (a task changed since is
 * refused with the server's words). Once answered: "Due date moved to …", "Kept the due date as it is.", or, when the task
 * changed meanwhile, "The task changed since, so this suggestion no longer applies."
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert } from "@/components/ui/states";
import { failureText } from "@/components/app/assistant-item-card";
import { fromLocalInput, QuietLink, toLocalInput } from "@/components/app/commitment-card";
import { api } from "@/lib/api-client";
import { dateTimeLabel } from "@/lib/assistant-items";
import { clip } from "@/lib/follow-ups";
import { LOOP_WORDS, type ReplanView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const R = LOOP_WORDS.replan;

export function ReplanCard({ orgSlug, replan: given, timeZone, className }: { orgSlug: string; replan: ReplanView; timeZone: string; className?: string }) {
  const router = useRouter();
  const uid = useId();
  const [local, setLocal] = useState<ReplanView | null>(null);
  const r = local && local.id === given.id && given.status === "proposed" ? local : given;
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [changing, setChanging] = useState(false);
  const [date, setDate] = useState(() => toLocalInput(given.proposedDueAt));
  const title = clip(r.taskTitle, 80);

  async function press(action: "confirm" | "dismiss") {
    if (busy) return;
    const body = action === "confirm" && changing ? { dueAt: fromLocalInput(date) } : action === "confirm" ? {} : undefined;
    if (action === "confirm" && changing && !body?.dueAt) { setError("Pick the new due date."); return; }
    setBusy(action); setError(null); setSaid("");
    try {
      const res = await api<{ replan: ReplanView }>(`/api/orgs/${orgSlug}/replans/${r.id}/${action}`, { method: "POST", ...(body ? { body } : {}), retries: 1 });
      setLocal(res.replan);
      setChanging(false);
      setSaid(action === "confirm" ? R.confirmed(res.replan.confirmedDueAt ? dateTimeLabel(res.replan.confirmedDueAt, timeZone) : res.replan.proposedLabel) : R.dismissed);
      router.refresh();
    } catch (err) {
      setError(failureText(err));
    } finally { setBusy(null); }
  }

  const outcome = r.status === "confirmed" ? R.confirmed(r.confirmedDueAt ? dateTimeLabel(r.confirmedDueAt, timeZone) : r.proposedLabel)
    : r.status === "dismissed" ? R.dismissed : r.status === "stale" ? R.stale : null;

  return (
    <section aria-labelledby={`${uid}-t`} className={cn("card-panel flex min-w-0 flex-col gap-3 p-4", className)}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary"><CalendarClock className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id={`${uid}-t`} className="text-sm font-semibold text-foreground">{R.title}</h2>
          <p className="mt-0.5 break-words text-sm font-normal text-foreground">{R.line(title, r.proposedLabel)}</p>
          {r.previousDueAt ? <p className="mt-0.5 text-meta font-normal text-secondary">It was due <span className="tabular-nums">{dateTimeLabel(r.previousDueAt, timeZone)}</span>.</p> : null}
          <p className="mt-1"><QuietLink href={r.taskHref}>Open the task</QuietLink></p>
          {outcome ? <p className={cn("mt-1.5 text-meta font-normal", r.status === "confirmed" ? "text-success" : "text-secondary")}>{outcome}</p>
            : <p className="mt-1.5 text-meta font-normal text-secondary">Nothing changes until you confirm.</p>}
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {r.status === "proposed" && r.canConfirm ? (
        <div className="space-y-3">
          {changing ? (
            <div className="min-[440px]:pl-9">
              <label htmlFor={`${uid}-date`} className="mb-1.5 block text-meta font-medium text-foreground">New due date</label>
              <DatePicker mode="datetime" id={`${uid}-date`} size="sm" value={date} onChange={setDate} disabled={!!busy} className="max-w-xs" />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" loading={busy === "dismiss"} disabled={!!busy} onClick={() => void press("dismiss")}>{R.notNow}</Button>
            {changing ? <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { setChanging(false); setDate(toLocalInput(r.proposedDueAt)); }}>Back</Button>
              : <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setChanging(true)}>{R.change}</Button>}
            <Button variant="primary" size="sm" loading={busy === "confirm"} disabled={!!busy} onClick={() => void press("confirm")}>{changing ? "Confirm" : R.confirm}</Button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </section>
  );
}
