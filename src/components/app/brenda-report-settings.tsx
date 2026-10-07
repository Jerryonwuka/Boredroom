"use client";

/**
 * Settings card for Brenda's daily team report (owner decision, 5 October 2026: the Reports page is removed; Brenda
 * sends supervisors what their team did at the end of every day, at a time set here). Owners and HR switch it on or
 * off, pick the local time and choose whether they also get the whole organisation; each change saves at once through
 * /brenda/settings (the time a moment after the last pick, so choosing hour then minute is one save). "Send me today's
 * report now" has Brenda write today's report for the person viewing (/brenda/daily-report) and links to it. Outside a
 * plan with Brenda nothing goes out, and the card says so instead of offering the button.
 * v4: a settings section (title, description, status badge) over a card of form rows: two switch rows and the time,
 * with what happened and "Send me today's report now" in the footer.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimePicker } from "@/components/ui/time-picker";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { useAssistant } from "@/components/app/assistant-context";
import { SettingsSection, SettingsGroup, SettingsRow, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";

export type DailyReportSettings = { dailyReportEnabled: boolean; dailyReportTime: string; dailyReportOrgWide: boolean };
type SendResult =
  | { status: "saved" | "existing"; title: string; headline: string; href: string; endOfDay: boolean }
  | { status: "nothing"; message: string };

const TIME_SAVE_DELAY = 700;
const pick = (r: DailyReportSettings): DailyReportSettings => ({ dailyReportEnabled: r.dailyReportEnabled, dailyReportTime: r.dailyReportTime, dailyReportOrgWide: r.dailyReportOrgWide });

export function BrendaReportSettings({ orgSlug, initial, timezone, canEdit = true, inPlan = true }: { orgSlug: string; initial: DailyReportSettings; timezone: string; canEdit?: boolean; inPlan?: boolean }) {
  const router = useRouter();
  // The report goes out signed by the workspace's own assistant; "Send me today's report now" keeps the glyph of the
  // person's own, who is the one asking (owner decision, 7 October 2026: personal assistants).
  const { workspace } = useAssistant();
  const [s, setS] = useState(() => pick(initial));
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const [send, setSend] = useState<{ pending: boolean; result: SendResult | null; error: string | null }>({ pending: false, result: null, error: null });
  // What the server last confirmed (a failed save falls back to it), the newest save (older answers are ignored), and a
  // time still waiting for its save.
  const confirmed = useRef(pick(initial));
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTime = useRef<string | null>(null);

  const persist = async (patch: Partial<DailyReportSettings>) => {
    const n = ++latest.current;
    setSave({ state: "saving" });
    try {
      const r = pick(await api<DailyReportSettings>(`/api/orgs/${orgSlug}/brenda/settings`, { method: "PATCH", body: patch, retries: 0 }));
      confirmed.current = r;
      if (n !== latest.current) return;
      setS(r); setSave({ state: "saved" });
      router.refresh(); // the action log on the same page lists the change
    } catch (err) {
      if (n !== latest.current) return;
      setS(confirmed.current);
      setSave({ state: "error", message: isApiFailure(err) ? err.error.message : "Cannot reach the server. Nothing was changed." });
    }
  };
  const flushTime = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const t = pendingTime.current; pendingTime.current = null;
    if (t) void persist({ dailyReportTime: t });
  };
  // Leaving the page with a time just picked still saves it.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); const t = pendingTime.current; if (t) void api(`/api/orgs/${orgSlug}/brenda/settings`, { method: "PATCH", body: { dailyReportTime: t }, retries: 0 }).catch(() => undefined); } }, [orgSlug]);

  const toggle = (key: "dailyReportEnabled" | "dailyReportOrgWide", value: boolean) => {
    setS((x) => ({ ...x, [key]: value }));
    void persist({ [key]: value });
  };
  const chooseTime = (v: string) => {
    setS((x) => ({ ...x, dailyReportTime: v }));
    pendingTime.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushTime, TIME_SAVE_DELAY);
  };
  const sendNow = async () => {
    setSend({ pending: true, result: null, error: null });
    try { setSend({ pending: false, result: await api<SendResult>(`/api/orgs/${orgSlug}/brenda/daily-report`, { method: "POST", retries: 0 }), error: null }); }
    catch (err) { setSend({ pending: false, result: null, error: isApiFailure(err) ? err.error.message : "Cannot reach the server. Try again." }); }
  };

  const off = !s.dailyReportEnabled;
  const r = send.result;
  return (
    <SettingsSection id="daily-report" title="Daily team report"
      description={`At the end of each working day ${workspace.name} sends every team lead what their team did, saved privately in their Docs under Daily reports.`}
      action={<Badge tone={!inPlan || off ? "neutral" : "success"} dot>{!inPlan ? "Not in your plan" : off ? "Off" : <>On, at <span className="tabular-nums">{s.dailyReportTime}</span></>}</Badge>}>
      <SettingsGroup>
        {!inPlan ? <SettingsAlert tone="info">Brenda is not on this workspace&apos;s plan, so no reports go out. Plans with Brenda are under <Link href="?section=billing#billing" className="font-medium text-foreground underline underline-offset-2">Plan and billing</Link>.</SettingsAlert> : null}
        <Switch className="px-5 py-4" checked={s.dailyReportEnabled} disabled={!canEdit} onChange={(e) => toggle("dailyReportEnabled", e.target.checked)} hint="Days with nothing to report send nothing.">
          Send the daily report
        </Switch>
        <SettingsRow label="Send at" hint={`In the organisation's time zone, ${timezone}.`} htmlFor="daily-report-time">
          <TimePicker id="daily-report-time" size="sm" value={s.dailyReportTime} onChange={chooseTime} disabled={!canEdit || off} aria-label={`Send the daily report at ${s.dailyReportTime}`} className="sm:max-w-64" />
        </SettingsRow>
        <Switch className="px-5 py-4" checked={s.dailyReportOrgWide} disabled={!canEdit || off} onChange={(e) => toggle("dailyReportOrgWide", e.target.checked)} hint="At the same time, owners and HR get one report on everyone who holds work.">
          Owners and HR get the whole organisation
        </Switch>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {send.error ? <SettingsAlert>{send.error}</SettingsAlert> : null}
        {r && r.status === "nothing" ? <SettingsAlert tone="info">{r.message}</SettingsAlert> : null}
        {r && r.status !== "nothing" ? (
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0 flex-[1_1_16rem]">
              <p className="text-sm font-medium text-foreground">{r.headline}</p>
              <p className="mt-0.5 text-meta font-normal text-secondary">{r.endOfDay ? "Today's end-of-day report has already gone out; this is it." : "Saved privately in your Docs. The end-of-day report brings it up to date."}</p>
            </div>
            <Link href={r.href} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-border-input bg-background px-2.5 text-meta font-medium text-foreground transition-colors duration-75 hover:border-border-input-hover hover:bg-fill-0">Open {r.title}<ArrowUpRight className="size-3.5 text-secondary" aria-hidden /></Link>
          </div>
        ) : null}
        <SettingsFooter busy={save.state === "saving" ? "Saving…" : undefined} status={save.state === "saved" ? "Saved" : undefined}>
          {inPlan ? (
            <Button variant="secondary" size="md" onClick={() => void sendNow()} loading={send.pending}>
              {send.pending ? null : <BrendaGlyph size={16} aria-hidden />}{send.pending ? "Writing today's report…" : "Send me today's report now"}
            </Button>
          ) : null}
        </SettingsFooter>
      </SettingsGroup>
    </SettingsSection>
  );
}
