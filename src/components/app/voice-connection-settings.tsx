"use client";

/**
 * Settings → Brenda → Natural voice, for owners and HR (owner decision, 9 October 2026: natural voice (ElevenLabs),
 * contract F.3; "entered by owners/HR"). Two cards under the section title the Settings page draws:
 *
 * - The connection, as the AI connection's form: which key natural voices use ("Connected" for the workspace's own key,
 *   with its last four characters and when it was connected; "Boredroom's key" when the server's key stands in; "Not
 *   connected", when assistants use the computer voice), the form to add or replace the workspace's key (tested with one
 *   free request to ElevenLabs before it is stored; the server's refusal shows on the field) and Remove, through a
 *   confirm. The key is never shown again: only its hint comes back.
 * - Usage this month, from the workspace's own key's subscription (characters used of the allowance, with a bar, and
 *   the reset date), which key is in use, this workspace's characters today against today's share and this month, and
 *   the daily limit for each person. On Boredroom's key only this workspace's own counters show: the key's usage is every
 *   workspace's together (review, 9 October 2026), so a warning says when it is nearly used up this month or today's
 *   shared allowance is gone. Under 10% of the allowance left, a warning says assistants use the computer voice until it
 *   resets; a subscription that could not be read says so; a key that cannot delete what was said from its ElevenLabs
 *   history says so too (its holder could read it there), and so does what could not be deleted in the last 30 days (fix
 *   review, 9 October 2026). Both for the workspace's own key only: Boredroom's key is Boredroom's to fix.
 *
 * Before migration 0053 an info alert says natural voices need a database update and the form is disabled (the server
 * refuses too). Plain words throughout; the only colour is the badge's status tone (accent rules).
 */
import { useId, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-arc";
import { Alert } from "@/components/ui/states";
import { SETTINGS_GROUP, SettingsAlert, SettingsFooter, SettingsGroup, SettingsRow } from "@/components/app/settings-forms";
import { NATURAL_WORDS, formatResetDate } from "@/lib/assistant-speech/natural-words";
import type { VoiceConnectionStatus } from "@/lib/natural-voices";
import { api, isApiFailure } from "@/lib/api-client";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const W = NATURAL_WORDS.connection;

export function VoiceConnectionSettings({ orgSlug, status: initial, timeZone }: { orgSlug: string; status: VoiceConnectionStatus; /** The organisation's, for the dates. */ timeZone?: string }) {
  // The page's status, then each answer's (POST and DELETE return the new one); a refresh brings a new page value.
  const [status, setStatus] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setStatus(initial); }
  const [open, setOpen] = useState(initial.source !== "organisation");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const keyId = useId();
  const path = `/api/orgs/${encodeURIComponent(orgSlug)}/settings/voice`;

  const connect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const apiKey = String(new FormData(form).get("apiKey") ?? "").trim();
    setError(null); setOk(null);
    if (apiKey.length < 20) { setFieldError(W.tooShort); return; }
    setFieldError(null); setPending(true);
    try {
      // One test call to ElevenLabs per press: never retried on its own.
      const next = await api<VoiceConnectionStatus>(path, { method: "POST", body: { apiKey }, retries: 0 });
      form.reset();
      setStatus(next); setOpen(false); setOk(W.success);
    } catch (err) {
      if (isApiFailure(err)) {
        const onField = err.error.fieldErrors?.apiKey?.[0];
        if (onField) setFieldError(onField); else setError(err.error.message);
      } else setError(OFFLINE);
    } finally { setPending(false); }
  };

  // ConfirmButton keeps its dialog open with the reason when this throws.
  const remove = async () => {
    const next = await api<VoiceConnectionStatus>(path, { method: "DELETE" });
    setStatus(next); setOpen(true); setError(null); setFieldError(null); setOk(W.removed);
  };

  const connectedOn = formatResetDate(status.connectedAt, timeZone);
  const badge = status.source === "organisation" ? <Badge tone="success" dot>{W.connected}</Badge>
    : status.source === "environment" ? <Badge tone="neutral" dot>{W.boredroom}</Badge>
      : <Badge tone="warning" dot>{W.none}</Badge>;
  const line = status.source === "organisation" ? W.organisationLine(status.hint, connectedOn)
    : status.source === "environment" ? W.environmentLine : W.noneLine;

  return (
    <div className="space-y-3">
      {!status.ready ? <Alert tone="info">{W.notReady}</Alert> : null}
      <div className={SETTINGS_GROUP}>
        {error ? <SettingsAlert>{error}</SettingsAlert> : null}
        <SettingsRow label={W.row} align="text">
          <span className="flex flex-wrap items-center gap-2">{badge}<span className="text-secondary">{line}</span></span>
        </SettingsRow>
        {open ? (
          <form className="divide-y divide-border" onSubmit={connect} noValidate>
            <SettingsRow label={W.keyLabel} hint={W.keyHint} htmlFor={keyId} error={fieldError ?? undefined}>
              <Input id={keyId} name="apiKey" type="password" autoComplete="off" spellCheck={false} required minLength={20} maxLength={200} className="font-mono" disabled={!status.ready || pending} />
            </SettingsRow>
            <SettingsFooter status={ok ?? undefined} busy={pending ? W.testing : undefined}>
              {status.source === "organisation" ? <Button type="button" size="md" variant="ghost" onClick={() => { setOpen(false); setFieldError(null); }}>{W.cancel}</Button> : null}
              <Button type="submit" size="md" loading={pending} disabled={!status.ready}>{pending ? W.testing : W.connect}</Button>
            </SettingsFooter>
          </form>
        ) : (
          <SettingsFooter status={ok ?? undefined}>
            <ConfirmButton size="md" variant="danger" disabled={!status.ready} title={W.removeTitle} description={W.removeDescription} confirmLabel={W.remove} pendingLabel={W.removing} onConfirm={remove}>{W.remove}</ConfirmButton>
            <Button size="md" variant="secondary" onClick={() => { setOpen(true); setOk(null); }}>{W.replace}</Button>
          </SettingsFooter>
        )}
      </div>
      {/* No counters before 0053, and nothing to count without a key. */}
      {status.ready && status.source !== "none" ? <VoiceUsage status={status} timeZone={timeZone} /> : null}
    </div>
  );
}

/** Usage this month: the key's allowance, which key, this workspace today and this month, each person's limit. */
function VoiceUsage({ status, timeZone }: { status: VoiceConnectionStatus; timeZone?: string }) {
  const titleId = useId();
  const { month } = status;
  const resets = formatResetDate(month?.resetAt, timeZone);
  return (
    <SettingsGroup role="group" aria-labelledby={titleId}>
      <div className="px-5 py-3"><h3 id={titleId} className="text-sm font-medium text-foreground">{W.usage}</h3></div>
      {status.low ? <SettingsAlert tone="warning">{status.source === "environment" ? W.lowShared : W.low(resets)}</SettingsAlert> : null}
      {!status.low && status.sharedFull ? <SettingsAlert tone="warning">{W.sharedFull}</SettingsAlert> : null}
      {status.historyBlocked ? <SettingsAlert tone="warning">{W.historyBlocked}</SettingsAlert> : null}
      {status.historyLeft > 0 ? <SettingsAlert tone="warning">{W.historyLeft(status.historyLeft)}</SettingsAlert> : null}
      {status.monthError ? <SettingsAlert tone="warning">{status.monthError === "key_rejected" ? W.monthRejected : W.monthUpstream}</SettingsAlert> : null}
      {month ? (
        <>
          <SettingsRow label={W.used} align="text">
            <div className="grid gap-2">
              <span className="tabular-nums">{W.usedValue(month.used, month.limit)}</span>
              {/* Neutral: a meter, not progress to celebrate (and the Brenda section has plenty of orange already). */}
              <ProgressBar value={month.used} max={Math.max(1, month.limit)} label={W.usedLabel} valueText={W.usedText(month.used, month.limit)} size="sm" tone="neutral" doneTone="accent" />
            </div>
          </SettingsRow>
          <SettingsRow label={W.resets} align="text">{resets ?? "—"}</SettingsRow>
        </>
      ) : null}
      <SettingsRow label={W.keyInUse} align="text">{status.source === "organisation" ? W.organisationKey : W.boredroomKey}</SettingsRow>
      <SettingsRow label={W.workspace} align="text"><span className="tabular-nums">{W.workspaceValue(status.today.used, status.today.share, status.workspaceMonth)}</span></SettingsRow>
      <SettingsRow label={W.person} align="text"><span className="tabular-nums">{W.personValue(status.personDailyLimit)}</span></SettingsRow>
    </SettingsGroup>
  );
}
