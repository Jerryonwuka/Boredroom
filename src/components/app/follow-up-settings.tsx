"use client";

/**
 * Settings → Your assistant → Follow-ups (owner decision, 8 October 2026: personal assistants, phase 4). When someone's
 * assistant asks about this person's work ("Where is Ben on the landing page?"), their own assistant answers from their
 * work and asks them once only when the work doesn't answer it. This card is the person's one choice about that:
 *
 * - "Answer from my work, ask me only if it can't" (`auto`, the default) or "Always ask me first" (`ask_first`), saved to
 *   their assistant profile the moment one is chosen (PUT /follow-ups/preference), as Voice's "When Max speaks" is: the
 *   choice shows at once and goes back, with the reason, if the save fails; choices made in a burst are saved in order,
 *   the last one winning. An administrator signed in as the person sees them disabled (the server refuses too).
 * - What is never shared, in words: their to-dos, private documents, messages and chats with their assistant.
 * - "Asked about you" in the footer: every follow-up about them and exactly what was shared.
 * Before migration 0039 the card shows, disabled, under an info alert (contract A.2). No orange of its own: the chosen
 * radio's ring is the primitive's (accent rules).
 */
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Radio } from "@/components/ui/switch";
import { SettingsSection, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import type { FollowUpPreference } from "@/lib/follow-ups";
import { cn } from "@/lib/utils";

const OFFLINE = "Could not save. Check your connection and try again.";
const NOT_READY = "Follow-ups need a database update first.";

export function FollowUpPreferenceSettings({ orgSlug, initial, name, impersonated = false }: {
  orgSlug: string; initial: { ready: boolean; preference: FollowUpPreference }; name: string; impersonated?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const { ready } = initial;
  const locked = impersonated || !ready;

  // What the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way,
  // shown at once.
  const [saved, setSaved] = useState(initial.preference);
  const [seen, setSeen] = useState(initial.preference);
  const [target, setTarget] = useState<FollowUpPreference | null>(null);
  if (seen !== initial.preference) { setSeen(initial.preference); setSaved(initial.preference); setTarget(null); }
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const chosen = target ?? saved;
  // One save at a time, in the order chosen; a choice overtaken before its turn is not sent.
  const wanted = useRef<FollowUpPreference | null>(null);
  const queue = useRef(Promise.resolve());

  const choose = (v: FollowUpPreference) => {
    if (locked || v === chosen) return;
    wanted.current = v;
    setTarget(v); setBusy(true); setStatus(null); setFailure(null);
    queue.current = queue.current.then(async () => {
      if (wanted.current !== v) return;
      try {
        const r = await api<{ preference: FollowUpPreference }>(`/api/orgs/${orgSlug}/follow-ups/preference`, { method: "PUT", body: { preference: v }, retries: 0 });
        setSaved(r.preference);
        if (wanted.current !== v) return;
        setTarget(null); setBusy(false); setStatus("Saved");
      } catch (err) {
        if (wanted.current !== v) return;
        setTarget(null); setBusy(false);
        // A refusal (4xx) and the server's "needs a database update" (503 NOT_READY) say why in words meant for the
        // person; any other fault, or no answer at all, is "Could not save".
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setFailure(told ? err.error.message : OFFLINE);
      }
    });
  };

  const options: { value: FollowUpPreference; label: string; hint: string }[] = [
    { value: "auto", label: "Answer from my work, ask me only if it can't", hint: `${name} shares only what the person asking can already see: the task's status, comments and time on shared work.` },
    { value: "ask_first", label: "Always ask me first", hint: "You get one request each time. If you don't reply in time, they get what your work shows." },
  ];

  return (
    <SettingsSection id="follow-ups" title="Follow-ups" description="When someone's assistant asks about your work">
      <div className={cn(SETTINGS_GROUP, "@container")}>
        {!ready ? <SettingsAlert tone="info">{NOT_READY}</SettingsAlert> : null}
        {/* A settings row as a fieldset: the legend names the group for screen readers, the same words stand in the
            label column for the eye (as Voice's "When Max speaks"). */}
        <fieldset aria-describedby={hintId} className="grid min-w-0 gap-x-8 gap-y-3 px-5 py-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start">
          <legend className="sr-only">How {name} answers</legend>
          <div className="min-w-0">
            <p aria-hidden className="text-sm font-medium text-foreground">How {name} answers</p>
            <p id={hintId} className="mt-0.5 text-meta font-normal text-secondary">Someone&apos;s assistant asks {name} where you are on your work, instead of asking you. An answer never changes your tasks.</p>
          </div>
          <div className="grid min-w-0 gap-3">
            {options.map((o) => (
              <Radio key={o.value} name="follow-up-preference" value={o.value} checked={chosen === o.value} disabled={locked} onChange={() => choose(o.value)} hint={o.hint}>
                {o.label}
              </Radio>
            ))}
            {impersonated ? <p className="text-meta font-normal text-secondary">Only the person can change this. It stays as it is while you are signed in as them.</p> : null}
          </div>
        </fieldset>
        <div className="flex items-start gap-3 px-5 py-4">
          <Lock className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
          <p className="min-w-0 text-sm font-normal text-secondary">Your to-dos, private documents, messages and your chats with {name} are never shared.</p>
        </div>
        {failure ? <SettingsAlert>{failure}</SettingsAlert> : null}
        {/* Before 0039 nothing can be saved and there is nothing about them to see, so the card ends at its last row. */}
        {ready ? (
          <SettingsFooter status={status ?? undefined} busy={busy ? "Saving…" : undefined}>
            <Link href={`/app/${orgSlug}/home/follow-ups/about-you`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Asked about you</Link>
          </SettingsFooter>
        ) : null}
      </div>
    </SettingsSection>
  );
}
