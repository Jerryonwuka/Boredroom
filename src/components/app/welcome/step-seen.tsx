"use client";

/**
 * "What's seen" (owner request, 11 October 2026: the honest part of the pitch; contract 5.5). What the person's lead, HR
 * and the owner can see about them, and what nobody sees, specific and checked against the code (fairnessFor), side by
 * side from 560px of card width. Owners and HR read the supervisor's version: exactly what their team is told on day one.
 * The workspace's monitoring notice opens in a sheet. A notice the workspace wrote itself must be opened before "Got it"
 * (the primary reads "Read {org}'s notice" until then); a notice that still describes screen recording drops the screen
 * line, so the page never contradicts the notice in force, and owners are pointed to publishing the new one.
 */
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Eye, EyeOff, Minus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Alert } from "@/components/ui/states";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { WELCOME_WORDS, type Fairness, type WelcomeNotice } from "@/lib/welcome";

const S = WELCOME_WORDS.seen;

export function StepSeen({ orgSlug, org, isOwner, fairness, notice, stepLabel, note, focusTitle, error, busy, onBack, onContinue }: {
  orgSlug: string; org: string; isOwner: boolean; fairness: Fairness; notice: WelcomeNotice;
  stepLabel: string | null; note?: ReactNode; focusTitle: boolean; error: string | null; busy: boolean;
  onBack: () => void; onContinue: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(false);
  const hasNotice = !!notice.text;
  // A notice of the workspace's own must be opened once before "Got it".
  const mustRead = hasNotice && !notice.standard && !read;
  const never = notice.outdated ? fairness.never.slice(1) : fairness.never;
  const openNotice = () => { setOpen(true); setRead(true); };

  return (
    <StepFrame stepLabel={stepLabel} title={fairness.title} lede={fairness.lede} note={note} focusTitle={focusTitle} error={error} wide
      onSubmit={() => (mustRead ? openNotice() : onContinue())} onBack={onBack}
      primary={{ label: mustRead ? S.noticeLink(org) : WELCOME_WORDS.buttons.gotIt, loading: busy }}
      after={
        // Outside the step's form, so nothing in the sheet can submit it.
        <Sheet open={open} onClose={() => setOpen(false)} size="md" title={S.noticeTitle(org)} description={notice.version ? S.noticeVersion(notice.version) : undefined}>
          <div className="whitespace-pre-wrap rounded-xl border border-border bg-fill-0 px-4 py-3 text-sm font-normal text-secondary">{notice.text}</div>
        </Sheet>
      }>
      {notice.outdated && isOwner ? (
        <Alert tone="info" className="mb-5">
          {S.outdatedOwner}{" "}<Link href={`/app/${orgSlug}/settings?section=notice`} className="link-inline">Settings</Link>
        </Alert>
      ) : null}
      <div className="@container">
        <div className="grid gap-3 @[560px]:grid-cols-2">
          <section aria-labelledby={`${id}-seen`} className="rounded-2xl border border-border p-4">
            <h2 id={`${id}-seen`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Eye aria-hidden className="size-4 text-secondary" />{fairness.seenHeading}
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {fairness.seen.map((s) => (
                <li key={s} className="flex items-start gap-2.5 py-2.5 text-sm font-normal text-secondary">
                  <Check aria-hidden className="mt-[3px] size-3.5 shrink-0 text-secondary" />
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={`${id}-never`} className="rounded-2xl border border-border p-4">
            <h2 id={`${id}-never`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <EyeOff aria-hidden className="size-4 text-secondary" />{fairness.neverHeading}
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {never.map((n) => (
                <li key={n.strong} className="flex items-start gap-2.5 py-2.5 text-sm font-normal">
                  <Minus aria-hidden className="mt-[3px] size-3.5 shrink-0 text-secondary" />
                  <span className="min-w-0"><strong className="font-medium text-foreground">{n.strong}</strong>{n.rest ? <span className="text-secondary"> {n.rest}</span> : null}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {/* Presence is every colleague's, so it is said apart from the lists (review, 11 October 2026). */}
      {fairness.colleagues ? <p className="mt-5 text-sm font-normal text-secondary">{fairness.colleagues}</p> : null}
      <p className={fairness.colleagues ? "mt-2 text-sm font-normal text-secondary" : "mt-5 text-sm font-normal text-secondary"}>{fairness.footer}</p>
      {hasNotice ? (
        <p className="mt-2 text-sm">
          <button type="button" className="link-inline" onClick={openNotice} aria-haspopup="dialog">{S.noticeLink(org)}</button>
        </p>
      ) : <p className="mt-2 text-sm font-normal text-secondary">{S.noNotice(org)}</p>}
    </StepFrame>
  );
}
