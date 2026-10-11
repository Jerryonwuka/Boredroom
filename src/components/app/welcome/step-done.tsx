"use client";

/**
 * "You're all set" (owner request, 11 October 2026: "then maybe after, a 'you're all set up' message"; contract 5.7). Shown
 * only once the server has recorded the welcome as finished, so the celebration is never ahead of it. The person gets
 * what they now have (the summary card: them, their assistant's look, voice, how it acts, their theme, the invitations
 * they sent) and ONE thing to do next for their role: the flow's only orange button ("Plan today", "Assign a first task",
 * "Invite your team"…, from firstActionFor), its hint under it, and a quiet "Skip this for now". Then, on a Mac, Brenda
 * for Mac. A replay ends with "That's the welcome" and a white "Back to Settings" instead: no orange, no Mac card. When
 * the workspace's plan has no assistant, the screen promises nothing about her: the lede says she joins in once the plan
 * includes her, and there is no Voice row and no Mac card (review, 11 October 2026).
 *
 * `DoneSummary` is the card: on the stage from 860px (she perches on it), in the column under the action on phones.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, ShieldCheck, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { LazyFace } from "@/components/app/welcome/lazy-face";
import { MacCard } from "@/components/app/welcome/mac-card";
import { PALETTE, type AssistantProfile } from "@/lib/assistant-look";
import type { ActMode } from "@/lib/act-mode";
import { WELCOME_WORDS, type FirstAction, type WelcomeRole } from "@/lib/welcome";
import { cn } from "@/lib/utils";

const D = WELCOME_WORDS.done;
const C = D.card;

export type DoneSummaryProps = {
  profileId: string; displayName: string; avatarKey: string | null; role: WelcomeRole; org: string;
  assistant: AssistantProfile;
  /** The natural voice's name, or null for the computer voice; undefined: no Voice row (the plan has no voice). */
  voice: string | null | undefined;
  /** How the assistant acts now; null: no row (the plan has no assistant). */
  acting: ActMode | null;
  theme: "dark" | "light";
  /** Invitations sent on the Team step; null: no row. */
  invites: number | null;
  /** Room at the top for her perched on it (the stage from 860px). */
  perch?: boolean;
  className?: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm font-normal text-secondary">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function DoneSummary(p: DoneSummaryProps) {
  const colour = PALETTE[p.assistant.colour].label;
  return (
    <div className={cn("card-panel w-full max-w-[360px] text-left", p.perch && "pt-14", p.className)}>
      <div className="flex items-center gap-3">
        <Avatar profileId={p.profileId} name={p.displayName} avatarKey={p.avatarKey} size={56} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{p.displayName}</p>
          <p className="truncate text-sm font-normal text-secondary">{C.at(p.role, p.org)}</p>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-border border-t border-border">
        <Row label={C.assistant}><LazyFace size="sm" look={p.assistant} quiet /><span className="truncate">{C.look(p.assistant.name, colour)}</span></Row>
        {p.voice !== undefined ? <Row label={C.voice}><span className="truncate">{p.voice ?? C.computer}</span></Row> : null}
        {p.acting ? (
          <Row label={C.acting}>
            {p.acting === "auto"
              ? <><Zap aria-hidden className="size-4 shrink-0 text-warning" />{C.acts}</>
              : <><ShieldCheck aria-hidden className="size-4 shrink-0 text-secondary" />{C.asks}</>}
          </Row>
        ) : null}
        <Row label={C.theme}>{p.theme === "light" ? WELCOME_WORDS.you.light : WELCOME_WORDS.you.dark}</Row>
        {p.invites !== null ? <Row label={C.invites}>{C.sent(p.invites)}</Row> : null}
      </dl>
    </div>
  );
}

/** A status region that is in the page first, then gets its words, so screen readers announce them (once). */
function LiveOnce({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  useEffect(() => { const t = setTimeout(() => setSaid(text), 150); return () => clearTimeout(t); }, [text]);
  return <p role="status" className="sr-only">{said}</p>;
}

export function StepDone({ slug, org, first, name, replay, aiPlan, action, focusTitle, summary, mac }: {
  slug: string; org: string; first: string; name: string; replay: boolean;
  /** The workspace's plan includes the assistant. */
  aiPlan: boolean;
  action: FirstAction; focusTitle: boolean;
  summary: DoneSummaryProps;
  /** The Mac card's facts; null in a replay and without the assistant in the plan. */
  mac: { look: AssistantProfile; downloadUrl: string | null } | null;
}) {
  const href = replay ? `/app/${slug}/settings?section=assistant` : action.href;
  return (
    <StepFrame stepLabel={null} focusTitle={focusTitle} staticFooter
      note={<span className="inline-flex items-center gap-1.5 text-sm font-medium text-success"><CircleCheck aria-hidden className="size-4" />{D.badge}</span>}
      title={replay ? D.replayTitle : D.title(first)} lede={replay ? D.replayLede : aiPlan ? D.lede(name) : D.ledeNoPlan(name, org)}
      onSubmit={() => undefined}
      primary={replay ? { label: WELCOME_WORDS.buttons.backToSettings, href } : { label: action.label, href, accent: true }}
      below={replay ? null : (
        <div className="grid gap-1">
          <p className="text-meta font-normal text-secondary">{action.hint}</p>
          {action.note ? <p className="text-meta font-normal text-secondary">{action.note}</p> : null}
          <Link href={`/app/${slug}/home`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 mt-2 w-fit")}>{WELCOME_WORDS.buttons.skipThis}</Link>
        </div>
      )}
      after={
        <>
          {/* "You're all set." once, for screen readers (the step's one status). */}
          <LiveOnce text={D.live} />
          <DoneSummary {...summary} className="mt-8 min-[860px]:hidden" />
          {mac ? <MacCard name={name} look={mac.look} downloadUrl={mac.downloadUrl} /> : null}
          {replay ? null : <p className="mt-8 text-meta font-normal text-secondary">{D.again}</p>}
        </>
      } />
  );
}
