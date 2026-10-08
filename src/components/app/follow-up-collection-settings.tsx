"use client";

/**
 * Settings → Brenda → "Updates before the report" (owner decision, 8 October 2026: personal assistants, phase 4). Owners
 * and HR can have the workspace's own assistant collect an update from everyone's assistant before the end-of-day team
 * report: at the chosen time before the report it asks each person's assistant, for everyone with work today, what they
 * worked on, answered from their work; with "Ask people with no update today" on, people whose work shows nothing today
 * are asked once, until 5 minutes before the report. The answers go in the report under Updates.
 *
 * Off by default. Each change saves at once through PATCH /follow-ups/settings; a failed save falls back to what the
 * server last confirmed and says why; an older answer never overwrites a newer choice. The rows are disabled while the
 * daily report is off (the updates go in it), outside a plan with the assistant, and before migration 0039 (an info
 * alert says so); the lead time and the ask switch also while collecting is off. The status badge reads Off, "On, 1 hour
 * before 18:00", "Needs the daily report" or "Not in your plan". The workspace assistant's name comes from context (it
 * signs the collection); the card itself carries no orange (accent rules).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAssistant } from "@/components/app/assistant-context";
import { SettingsSection, SettingsGroup, SettingsRow, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import type { FollowUpCollectionSettings as CollectionSettings } from "@/server/services/follow-ups";

type LeadMinutes = CollectionSettings["leadMinutes"];
type Choice = Omit<CollectionSettings, "ready">;

const LEADS: { value: LeadMinutes; label: string }[] = [
  { value: 30, label: "30 minutes" }, { value: 60, label: "1 hour" }, { value: 90, label: "1 hour 30 minutes" }, { value: 120, label: "2 hours" },
];
const leadLabel = (m: LeadMinutes) => LEADS.find((l) => l.value === m)?.label ?? `${m} minutes`;
const pick = (r: CollectionSettings | Choice): Choice => ({ collect: r.collect, collectAsk: r.collectAsk, leadMinutes: r.leadMinutes });
const NOT_READY = "Follow-ups need a database update first.";
const OFFLINE = "Cannot reach the server. Nothing was changed.";

/** "HH:MM" minus some minutes, on a 24-hour clock ("18:00" less 90 is "16:30"). */
function before(time: string, minutes: number): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return null;
  const at = (((Number(m[1]) * 60 + Number(m[2]) - minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
}

export function FollowUpCollectionSettings({ orgSlug, initial, reportEnabled, reportTime, inPlan, canEdit }: {
  orgSlug: string; initial: CollectionSettings; reportEnabled: boolean; reportTime: string; inPlan: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  // The collection is signed by the workspace's own assistant (owner decision, 7 October 2026: personal assistants).
  const { workspace } = useAssistant();
  const [s, setS] = useState(() => pick(initial));
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  // What the server last confirmed (a failed save falls back to it) and the newest save (older answers are ignored).
  const confirmed = useRef(pick(initial));
  const latest = useRef(0);

  const persist = async (patch: Partial<Choice>) => {
    const n = ++latest.current;
    setSave({ state: "saving" });
    try {
      const r = pick(await api<CollectionSettings>(`/api/orgs/${orgSlug}/follow-ups/settings`, { method: "PATCH", body: patch, retries: 0 }));
      confirmed.current = r;
      if (n !== latest.current) return;
      setS(r); setSave({ state: "saved" });
      router.refresh(); // the action log on the same page lists the change
    } catch (err) {
      if (n !== latest.current) return;
      setS(confirmed.current);
      const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
      setSave({ state: "error", message: told ? err.error.message : OFFLINE });
    }
  };
  const change = (patch: Partial<Choice>) => {
    setS((x) => ({ ...x, ...patch }));
    void persist(patch);
  };

  const { ready } = initial;
  const locked = !canEdit || !ready || !inPlan || !reportEnabled;
  const at = before(reportTime, s.leadMinutes);
  const badge = !ready ? <Badge tone="neutral" dot>Off</Badge>
    : !inPlan ? <Badge tone="neutral" dot>Not in your plan</Badge>
    : !reportEnabled ? <Badge tone={s.collect ? "warning" : "neutral"} dot>Needs the daily report</Badge>
    : s.collect ? <Badge tone="success" dot><span>On, {leadLabel(s.leadMinutes)} before <span className="tabular-nums">{reportTime}</span></span></Badge>
    : <Badge tone="neutral" dot>Off</Badge>;

  return (
    <SettingsSection id="follow-up-collection" title="Updates before the report"
      description={`${workspace.name} gathers an update on each person's day from their own assistant, for the end-of-day team report.`} action={badge}>
      <SettingsGroup>
        {!ready ? <SettingsAlert tone="info">{NOT_READY}</SettingsAlert>
          : inPlan && !reportEnabled ? <SettingsAlert tone="info">Switch on the daily report first. The updates go in it.</SettingsAlert>
          : null}
        <Switch className="px-5 py-4" checked={s.collect} disabled={locked} onChange={(e) => change({ collect: e.target.checked })}
          hint={`${workspace.name} asks each person's assistant what they worked on today, from their work. The answers go in the report under Updates.`}>
          Before the team report, collect updates from everyone&apos;s assistant
        </Switch>
        <SettingsRow label="Collect" htmlFor="follow-up-collect-lead"
          hint={at ? <>At <span className="tabular-nums">{at}</span> on working days, for the report at <span className="tabular-nums">{reportTime}</span>.</> : undefined}>
          <Select id="follow-up-collect-lead" value={String(s.leadMinutes)} disabled={locked || !s.collect} className="sm:max-w-72"
            onChange={(e) => change({ leadMinutes: Number(e.target.value) as LeadMinutes })}>
            {LEADS.map((l) => <option key={l.value} value={l.value}>{l.label} before the report</option>)}
          </Select>
        </SettingsRow>
        <Switch className="px-5 py-4" checked={s.collectAsk} disabled={locked || !s.collect} onChange={(e) => change({ collectAsk: e.target.checked })}
          hint="They get one request from their own assistant and can reply until 5 minutes before the report.">
          Ask people with no update today
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined} />
      </SettingsGroup>
    </SettingsSection>
  );
}
