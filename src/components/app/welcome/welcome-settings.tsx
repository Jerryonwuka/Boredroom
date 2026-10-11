"use client";

/**
 * Settings → Your assistant → "Welcome and setup" (owner request, 11 October 2026: the first-run welcome; contract 6.5).
 * The last card of the section: the two-minute welcome can be gone through again ("Replay the welcome": nothing about
 * progress is saved, and nothing changes unless the person changes it), or finished if it was left part way ("Finish
 * setting up"). Next steps, once hidden on the assistant's page, can be brought back here. Someone signed in as the
 * person (support) sees why they cannot do either.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsRow, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { WELCOME_WORDS, type WelcomeState } from "@/lib/welcome";

const S = WELCOME_WORDS.settings;

export function WelcomeSettings({ orgSlug, name, state, impersonated }: { orgSlug: string; name: string; state: WelcomeState; impersonated: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const href = state.done ? `/app/${orgSlug}/welcome?replay=1` : `/app/${orgSlug}/welcome`;

  const showNext = async () => {
    setStatus("saving"); setFailure(null);
    try {
      await api(`/api/orgs/${orgSlug}/welcome`, { method: "PATCH", body: { nextStepsHidden: false }, retries: 1 });
      setStatus("saved");
      router.refresh();
    } catch (err) {
      setStatus("idle");
      setFailure(isApiFailure(err) ? err.error.message : WELCOME_WORDS.errors.offline);
    }
  };

  return (
    <SettingsSection id="welcome" title={S.section} description={S.description}>
      <SettingsGroup>
        {impersonated ? (
          <SettingsRow label={S.row} align="text"><span className="text-secondary">{S.impersonated}</span></SettingsRow>
        ) : (
          <>
            <SettingsRow label={S.row} align="text">
              <Link href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}>{state.done ? S.replay : S.finish}</Link>
            </SettingsRow>
            {state.ready && state.nextStepsHidden && status !== "saved" ? (
              <SettingsRow label={WELCOME_WORDS.nextSteps.title} hint={S.nextHidden(name)} align="text">
                <Button variant="secondary" size="sm" loading={status === "saving"} onClick={() => void showNext()}>{S.showNext}</Button>
              </SettingsRow>
            ) : null}
          </>
        )}
        {failure ? <SettingsAlert>{failure}</SettingsAlert> : null}
        {/* Only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={status === "idle" ? "sr-only" : undefined} busy={status === "saving" ? "Saving…" : undefined} status={status === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
