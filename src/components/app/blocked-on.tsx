"use client";

/**
 * Blocked on whom (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"; contract E and H.5): when a
 * task is blocked, the person holding it can say who it waits on and what they need from them; that person's own
 * assistant brings it to them in "Between assistants" ("Ben is blocked on you"), where they answer (posted as their
 * comment on the task, and the task back in progress if they say it unblocks it) or say "Not me".
 *
 * Two parts:
 * - `WaitingOnFields`: "Waiting on" (`Select`: "Nobody in particular" first, then the workspace's active members but the
 *   person) and, once someone is chosen, "Your question to them" (`Textarea`, up to 500 characters, with "{first}'s
 *   assistant brings them this to answer."). Used by Mark blocked (task-forms) and by Change here.
 * - `BlockedOn`: the lines under the task page's Blocked alert: "Waiting on Ada: “Can you send the logo files?”", or once
 *   answered "Ada answered: “…”", or "Ada says it isn't theirs. Name someone else?"; the holder gets "Change" (the same
 *   fields in a popover) and "Stop waiting" (a ConfirmButton), or "Waiting on someone?" when nobody is named.
 *
 * PUT/DELETE /api/orgs/{org}/tasks/{task}/block; refusals show in the server's words. Hidden before migration 0048 (the
 * page passes `ready: false`). The question is the holder's own words: plain text, never Markdown, never a link.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { ConfirmButton } from "@/components/ui/confirm";
import { Popover } from "@/components/ui/menu";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { firstName } from "@/lib/follow-ups";
import { LOOP_LIMITS, LOOP_WORDS, type TaskBlockView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const B = LOOP_WORDS.block;
const OFFLINE = "Cannot reach the server. Check your connection and try again.";

export type BlockPerson = { membershipId: string; name: string };
/** What the task page reads for the block (task-blocks `blockFor`). */
export type BlockInfo = { ready: boolean; block: TaskBlockView | null; last: TaskBlockView | null; people: BlockPerson[] };

/** The server's words for a refusal, or how to recover. */
export function blockFailure(err: unknown): string {
  if (isApiFailure(err)) return err.error.status >= 500 && err.error.code !== "NOT_READY" ? "Something went wrong. Try again." : err.error.message;
  return OFFLINE;
}

export function WaitingOnFields({ people, waitingOn, onWaitingOn, question, onQuestion, error, disabled }: {
  people: BlockPerson[]; waitingOn: string; onWaitingOn: (v: string) => void; question: string; onQuestion: (v: string) => void;
  error?: { waitingOn?: string; question?: string }; disabled?: boolean;
}) {
  const id = useId();
  const chosen = people.find((p) => p.membershipId === waitingOn);
  return (
    <>
      <Field label={B.waitingOn} htmlFor={`${id}-who`} error={error?.waitingOn}>
        <Select id={`${id}-who`} fieldSize="sm" value={waitingOn} disabled={disabled} onChange={(e) => onWaitingOn(e.target.value)}>
          <option value="">{B.nobody}</option>
          {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
        </Select>
      </Field>
      {chosen ? (
        <Field label={B.question} htmlFor={`${id}-q`} hint={B.questionHint(firstName(chosen.name))} error={error?.question}>
          <Textarea id={`${id}-q`} className="min-h-20" value={question} maxLength={LOOP_LIMITS.questionMax} disabled={disabled} onChange={(e) => onQuestion(e.target.value)} />
        </Field>
      ) : null}
    </>
  );
}

/** Names who the task waits on (PUT …/block). Throws the refusal's words. */
export async function putBlock(orgSlug: string, taskId: string, waitingOn: string, question: string): Promise<TaskBlockView> {
  const r = await api<{ block: TaskBlockView }>(`/api/orgs/${orgSlug}/tasks/${taskId}/block`, { method: "PUT", body: { waitingOn, question } });
  return r.block;
}

export function BlockedOn({ orgSlug, taskId, holder, info, reason, className }: {
  orgSlug: string; taskId: string;
  /** The viewer holds the task (only they say who it waits on). */ holder: boolean;
  info: BlockInfo;
  /** The task's blocked reason, to start the question from. */ reason: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [waitingOn, setWaitingOn] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  if (!info.ready) return null;
  const { block, last } = info;

  const start = () => {
    setWaitingOn(block?.waitingOn.membershipId ?? "");
    setQuestion(block?.question ?? (reason ?? "").slice(0, LOOP_LIMITS.questionMax));
    setError(null);
  };
  const save = async (close: () => void) => {
    const q = question.trim();
    if (!waitingOn) { setError("Choose who it waits on."); return; }
    if (!q) { setError(LOOP_WORDS.errors.emptyQuestion); return; }
    setBusy(true); setError(null);
    try {
      const b = await putBlock(orgSlug, taskId, waitingOn, q);
      setSaid(B.shown(b.waitingOn.firstName, b.question));
      close();
      router.refresh();
    } catch (err) { setError(blockFailure(err)); }
    finally { setBusy(false); }
  };

  const form = (close: () => void) => (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(close); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <WaitingOnFields people={info.people} waitingOn={waitingOn} onWaitingOn={(v) => {
        setWaitingOn(v);
        if (v && !question.trim()) setQuestion((reason ?? "").slice(0, LOOP_LIMITS.questionMax));
      }} question={question} onQuestion={setQuestion} disabled={busy} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
        <Button size="sm" type="submit" loading={busy} disabled={!waitingOn}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
  const popover = (label: string) => (
    <Popover label={label} align="start" width={320} open={open} onOpenChange={(o) => { if (o) start(); setOpen(o); }}
      trigger={<Button size="xs" variant="secondary">{label}</Button>}>
      {(close) => form(close)}
    </Popover>
  );

  let line: React.ReactNode = null;
  if (block) line = B.shown(block.waitingOn.firstName, block.question);
  else if (last?.status === "answered" && last.answer) line = B.answeredLine(last.waitingOn.firstName, last.answer);
  else if (last?.status === "not_me") {
    line = last.viewer === "waiting_on" ? B.notMeLineMine : holder ? B.notMeLine(last.waitingOn.firstName) : B.notMeLineOthers(last.waitingOn.firstName);
  }

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      {line ? <p className="whitespace-pre-wrap break-words text-sm font-normal text-foreground">{line}</p> : null}
      {holder ? (
        <div className="flex flex-wrap items-center gap-2">
          {block ? (
            <>
              {popover(B.change)}
              <ConfirmButton size="xs" variant="ghost" tone="primary" title={`${B.stop}?`}
                description={`${block.waitingOn.firstName} won't be asked any more. The task stays blocked until you unblock it.`}
                confirmLabel={B.stop} pendingLabel="Stopping…"
                onConfirm={async () => {
                  await api(`/api/orgs/${orgSlug}/tasks/${taskId}/block`, { method: "DELETE", retries: 1 });
                  setSaid(`${block.waitingOn.firstName} won't be asked any more.`);
                  router.refresh();
                }}>
                {B.stop}
              </ConfirmButton>
            </>
          ) : info.people.length ? popover(B.add) : null}
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}
