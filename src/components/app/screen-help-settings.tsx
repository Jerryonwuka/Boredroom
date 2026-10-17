"use client";

/**
 * Screen help on Brenda for Mac in Settings (owner decisions, 11 October 2026: "start building with your
 * recommendations"; contract D.5 and F.4). Two cards, each shown only while the workspace is in the pilot (`eligible`):
 *
 * - Settings › Brenda, "Screen help on Brenda for Mac" (`ScreenHelpWorkspaceSettings`, owners and HR edit): Allowed (the
 *   default) or Not allowed for everyone, the apps Brenda must never look at (on top of the fixed list, which can't be
 *   removed), and while the 14 days' notice runs, the date it starts with "Start it now". Saved the moment it changes.
 *   The owners' wording is the proposal's: they can switch it off and list apps, never see who uses it, when, or what she saw.
 * - Settings › Your assistant, "{name} on your Mac" (`ScreenHelpMySettings`, the person only): each of their Macs with
 *   what is on there, "Set up on my Mac", the person's own never-look list and "Turn off on all my Macs…" (phase 3, below).
 *
 * Both use the same add dialog: pick a common app (its bundle id filled in) or type the name as the menu bar shows it,
 * with an optional bundle id. Before migration 0057: disabled under "Screen help needs a database update first." No
 * orange of their own: the select, the buttons and the list are neutral (the accent rules; the page has its own one).
 *
 * Phase 2 (owner request and permission rule, 12 October 2026: "Brenda cannot take any action except I explicitly give an
 * instruction … Brenda should confirm, do you want me to do this? And then I'll say, yes"; contract 0b.5, 0b.12, E.5):
 * - the workspace's card gains "On-screen actions and file work", Allowed (the default) or Not allowed, owners and HR,
 *   which can only switch the new abilities off (shown once migration 0058 is applied; before it, disabled with "This
 *   needs a database update first.");
 * - the person's card says what Brenda for Mac can now do (look, point, and, only when they ask and say yes, do things on
 *   the Mac and work on files), says when the workspace has switched actions off, and lists the four switches that live
 *   in Brenda for Mac's menu (Show {name} by my pointer, Show me the picture first, Let {name} use my Mac, Let {name} work
 *   on files). Until 12 October 2026 they were shown, not switched, here and stored on the Mac only.
 *
 * Phase 3 (owner report and request, 12 October 2026, after trying phase 2: "when I turned this setting on, I stopped
 * seeing my Brenda". The card listed the switches as plain text and its only button was "Turn off on my Macs"; he pressed
 * it thinking it turned things on. Contract `companion2-spec` A.5, L.2, M.9, M.10): the person's card becomes
 * "{name} on your Mac". Each of their Macs shows what is on there as Brenda for Mac last reported it to Boredroom, for the
 * person alone (assistant_private.screen_help_macs, migration 0059; the employer still sees nothing: owner request, 12
 * October 2026, contract 0b.2, which reverses "stored on the Mac only" for the person's own view). The primary button is
 * "Set up on my Mac": it only asks their Macs to open the setup card at their next poll, and nothing turns on until they
 * press on the Mac (the owner's permission rule). "Turn off on all my Macs…" is the quiet danger outline behind a confirm.
 * Before 0059 the card lists the abilities without states and has no Set up. The words and the pure logic live in
 * `lib/mac-help`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, MonoChip } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm";
import { Alert } from "@/components/ui/states";
import { Dialog } from "@/components/ui/sheet";
import { SettingsAlert, SettingsFooter, SettingsGroup, SettingsRow, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { COMMON_APPS, SCREEN_HELP_WORDS, cleanAppRule, dedupeAppRules, longDate, type AppRule, type MacReport, type ScreenHelpMine, type ScreenHelpView } from "@/lib/screen-help";
import { MAC_HELP_WORDS, SETUP_POLL_FOR_MS, SETUP_POLL_MS, checkedWords, macRows, newestBinary, nothingToTurnOff, setupPolling, setupStatus, setupWords } from "@/lib/mac-help";

const W = SCREEN_HELP_WORDS;

/**
 * The words of phase 2's settings (contract E.5 and A.11): the workspace switch's and the person's switched-off line from
 * `SCREEN_HELP_WORDS` (the server's), and the Mac's own switches (A.11), which only this card lists on the web.
 */
export const ACTIONS_WORDS = {
  ...W.owner.actions,
  /** The person's card, when the workspace has switched them off. */
  switchedOff: W.personal.actionsSwitchedOff,
  /**
   * Phase 2's names for the switches that live on each Mac (A.11), by the person's assistant's name. The card no longer
   * lists them (phase 3, 12 October 2026: it shows each Mac's state from `lib/mac-help` instead); kept for the words' test.
   */
  onMac: {
    label: "In Brenda for Mac",
    hint: "Change these from Screen help in the menu bar of Brenda for Mac.",
    note: "Only you can see these, here and in Boredroom › Settings › Your assistant. Your workspace can't.",
    switches: (name: string) => [
      { title: `Show ${name} by my pointer`, hint: `A small ${name} follows your pointer and fades when you're still or typing.` },
      { title: "Show me the picture first", hint: "Check each picture before it's sent." },
      { title: `Let ${name} use my Mac`, hint: "Clicks and types for you when you ask and say yes." },
      { title: `Let ${name} work on files`, hint: `Makes a new file from one you give ${name === "Brenda" ? "her" : name}, when you ask and say yes.` },
    ],
  },
} as const;

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const RULE_WORDS = "Give the app's name (up to 80 characters) and, if you know it, its bundle ID, like com.example.app.";

type Save = { state: "idle" | "saving" | "saved" | "error"; message?: string };
/** The server's words for a refusal (4xx) or "needs a database update" (503); anything else plainly. */
const failure = (err: unknown) => (isApiFailure(err) && (err.error.status < 500 || err.error.code === "LOOK_NOT_READY" || err.error.code === "NOT_READY") ? err.error.message : OFFLINE);
const sameRules = (a: AppRule[], b: AppRule[]) => JSON.stringify(a) === JSON.stringify(b);

// ---- The list of apps and its add dialog ---------------------------------------------------------------------------

/** The add dialog: a common app to pick, or a name and an optional bundle id. */
function AddAppDialog({ open, onClose, onAdd, existing }: { open: boolean; onClose: () => void; onAdd: (rule: AppRule) => void; existing: AppRule[] }) {
  const id = useId();
  const [name, setName] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => { setName(""); setBundleId(""); setPick(""); setError(null); onClose(); };
  const submit = () => {
    const rule = cleanAppRule({ name, bundleId: bundleId || null });
    if (!rule) { setError(RULE_WORDS); return; }
    if (dedupeAppRules([...existing, rule]).length === existing.length) { setError(`${rule.name} is on the list already.`); return; }
    onAdd(rule);
    close();
  };
  return (
    <Dialog open={open} onClose={close} title={W.addDialog.title} description={W.addDialog.description}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form={`${id}-form`}>Add</Button></>}>
      <form id={`${id}-form`} className="grid gap-5" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Common apps" htmlFor={`${id}-pick`}>
          <Select id={`${id}-pick`} value={pick} onChange={(e) => {
            setPick(e.target.value);
            const app = COMMON_APPS.find((a) => a.name === e.target.value);
            if (app) { setName(app.name); setBundleId(app.bundleId ?? ""); setError(null); }
          }}>
            <option value="">Pick an app…</option>
            {COMMON_APPS.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={W.addDialog.name} htmlFor={`${id}-name`} error={error ?? undefined}>
          <Input id={`${id}-name`} value={name} maxLength={80} autoComplete="off" required onChange={(e) => { setName(e.target.value); setPick(""); setError(null); }} />
        </Field>
        <Field label={W.addDialog.bundleId} htmlFor={`${id}-bundle`} description={W.addDialog.bundleIdHint}>
          <Input id={`${id}-bundle`} value={bundleId} maxLength={255} autoComplete="off" spellCheck={false} autoCapitalize="off" className="font-mono"
            onChange={(e) => { setBundleId(e.target.value); setPick(""); setError(null); }} />
        </Field>
      </form>
    </Dialog>
  );
}

/** The apps on a never-look list, each with Remove, then Add app and the fixed list's line. */
function AppList({ rules, disabled, onChange, label }: { rules: AppRule[]; disabled: boolean; onChange: (next: AppRule[]) => void; label: string }) {
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="grid gap-3">
      {rules.length ? (
        <ul aria-label={label} className="divide-y divide-border rounded-xl border border-border">
          {rules.map((r, i) => (
            <li key={`${r.bundleId ?? ""}:${r.name}`} className="flex min-h-11 items-center gap-2 py-1.5 pl-3 pr-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.name}</span>
              {r.bundleId ? <MonoChip className="hidden min-w-0 truncate sm:inline-flex">{r.bundleId}</MonoChip> : null}
              <IconButton aria-label={`Remove ${r.name}`} disabled={disabled}
                onClick={() => { onChange(rules.filter((_, j) => j !== i)); addRef.current?.focus(); }}>
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm font-normal text-secondary">{W.owner.none}</p>}
      <div>
        <Button ref={addRef} size="sm" variant="secondary" disabled={disabled || rules.length >= 50} aria-haspopup="dialog" onClick={() => setAdding(true)}><Plus aria-hidden />{W.owner.add}</Button>
      </div>
      <p className="text-meta font-normal text-secondary">{W.owner.fixed}</p>
      <AddAppDialog open={adding} onClose={() => setAdding(false)} existing={rules} onAdd={(rule) => onChange([...rules, rule])} />
    </div>
  );
}

/** Saves one change at a time, the last one wins; says "Saving…", "Saved" or the server's words. */
function useSaver() {
  const [save, setSave] = useState<Save>({ state: "idle" });
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);
  const run = (work: () => Promise<void>) => {
    const mine = ++latest.current;
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      try { await work(); if (latest.current === mine) setSave({ state: "saved" }); }
      catch (err) { if (latest.current === mine) setSave({ state: "error", message: failure(err) }); throw err; }
    }).catch(() => undefined);
    return queue.current;
  };
  return { save, run, setSave };
}

function SaveFooter({ save, done }: { save: Save; done?: string | null }) {
  const shown = save.state === "saving" || save.state === "saved" || !!done;
  return (
    <SettingsFooter className={shown ? undefined : "sr-only"} busy={save.state === "saving" ? "Saving…" : undefined}
      status={save.state === "saved" ? (done ?? "Saved") : undefined} />
  );
}

// ---- Settings › Brenda: the workspace's card -----------------------------------------------------------------------

/** What the workspace's card shows, from `ScreenHelpView`. */
export function ScreenHelpWorkspaceSettings({ orgSlug, initial, timeZone }: { orgSlug: string; initial: ScreenHelpView; timeZone: string }) {
  const router = useRouter();
  const id = useId();
  const [view, setView] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setView(initial); }
  const { save, run } = useSaver();
  const locked = !view.ready || !view.canEdit;

  const put = (body: { allowed?: boolean; neverLook?: AppRule[]; startNow?: true; actionsAllowed?: boolean }, optimistic: Partial<ScreenHelpView>) => {
    const before = view;
    setView((v) => ({ ...v, ...optimistic }));
    void run(async () => {
      try {
        const r = await api<ScreenHelpView>(`/api/orgs/${orgSlug}/screen-help`, { method: "PUT", body, retries: 0 });
        if (r && typeof r === "object" && "ready" in r) setView(r);
        router.refresh(); // Brenda's log on the same page lists the change
      } catch (err) { setView(before); throw err; }
    });
  };

  const inNotice = view.ready && view.allowed && view.reason === "notice" && !!view.availableFrom;
  const on = view.ready && view.allowed;
  return (
    <SettingsSection id="screen-help" target="settings-screen-help" title={W.owner.title} description={W.owner.description}
      action={view.ready ? <Badge tone={view.available ? "success" : "neutral"} dot>{view.available ? "On" : on && inNotice ? "Starting soon" : "Off"}</Badge> : null}>
      <SettingsGroup>
        {!view.ready ? <SettingsAlert tone="info">{W.owner.notReady}</SettingsAlert>
          : view.reason === "no_key" ? <SettingsAlert tone="info">{W.owner.noKey}</SettingsAlert>
          : !view.allowed ? <SettingsAlert tone="info">{W.owner.switchedOff}</SettingsAlert>
          : inNotice ? (
            <div className="px-5 py-4">
              <Alert tone="info" action={view.canEdit ? <Button size="sm" variant="secondary" disabled={save.state === "saving"} onClick={() => put({ startNow: true }, { reason: null, available: true, availableFrom: new Date().toISOString() })}>{W.owner.startNow}</Button> : null}>
                {W.owner.notice(longDate(view.availableFrom!, timeZone))}
              </Alert>
            </div>
          ) : null}
        <SettingsRow label="Screen help" htmlFor={`${id}-allowed`} hint={view.ready && !view.canEdit ? W.errors.settingsForbidden : undefined}>
          <Select id={`${id}-allowed`} value={view.allowed ? "allowed" : "not_allowed"} disabled={locked} className="w-full sm:w-56"
            onChange={(e) => { const allowed = e.target.value === "allowed"; put({ allowed }, { allowed, available: allowed && view.available }); }}>
            <option value="allowed">{W.owner.allowed}</option>
            <option value="not_allowed">{W.owner.notAllowed}</option>
          </Select>
        </SettingsRow>
        <SettingsRow label={W.owner.listTitle} stacked>
          <AppList label={W.owner.listTitle} rules={view.neverLook} disabled={locked} onChange={(next) => { if (!sameRules(next, view.neverLook)) put({ neverLook: next }, { neverLook: next }); }} />
        </SettingsRow>
        {/* Phase 2 (owner rule, 12 October 2026; contract 0b.12): the second switch, which can only switch things off. */}
        {view.ready ? (
          <SettingsRow label={ACTIONS_WORDS.title} htmlFor={`${id}-actions`}
            hint={<>{ACTIONS_WORDS.description}{!view.actReady ? <span className="mt-1 block">{ACTIONS_WORDS.notReady}</span> : null}</>}>
            <Select id={`${id}-actions`} value={view.actionsAllowed ? "allowed" : "not_allowed"} disabled={locked || !view.actReady} className="w-full sm:w-56"
              onChange={(e) => { const actionsAllowed = e.target.value === "allowed"; put({ actionsAllowed }, { actionsAllowed }); }}>
              <option value="allowed">{ACTIONS_WORDS.allowed}</option>
              <option value="not_allowed">{ACTIONS_WORDS.notAllowed}</option>
            </Select>
          </SettingsRow>
        ) : null}
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        <SaveFooter save={save} />
      </SettingsGroup>
    </SettingsSection>
  );
}

// ---- Settings › Your assistant: the person's own card --------------------------------------------------------------

/** The ability names without states: before migration 0059, and while someone else is signed in as the person. */
function AbilityList({ name }: { name: string }) {
  const R = MAC_HELP_WORDS.rows;
  return (
    <ul className="space-y-1.5 text-sm font-normal text-foreground" aria-label={MAC_HELP_WORDS.abilitiesLabel}>
      {[R.look, R.mac, R.files, R.companion(name)].map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

/** One Mac as Brenda for Mac last reported it: its name, when it checked in, and the four rows with their words. */
function MacCard({ report, name, now, timeZone }: { report: MacReport; name: string; now: number; timeZone: string }) {
  const headId = useId();
  return (
    <li className="overflow-hidden rounded-xl border border-border" aria-labelledby={headId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2.5">
        <p id={headId} className="min-w-0 truncate text-sm font-medium text-foreground">{report.device}</p>
        <p className="shrink-0 text-meta font-normal text-secondary">{MAC_HELP_WORDS.checked(checkedWords(report.reportedAt, now, timeZone))}</p>
      </div>
      {report.state.supported === false ? <p className="border-t border-border px-3 py-2.5 text-meta font-normal text-secondary">{MAC_HELP_WORDS.unsupported}</p> : null}
      <dl className="divide-y divide-border border-t border-border">
        {macRows(report.state, name).map((r) => (
          <div key={r.key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <dt className="min-w-0 text-sm font-normal text-foreground">{r.label}</dt>
            <dd className="min-w-0">
              {r.tone ? <Badge tone={r.tone}>{r.value}</Badge> : <span className="text-meta font-normal text-secondary">{r.value}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * "Check with me before every task" (Brenda and her helpers, owner brief 12 October 2026; decision 9: "'Request is
 * permission' is the default for everyone on their own Mac, with 'Check with me before every task'; owners can't change
 * it"; contract F.3, N.2, S.9): the person's own switch, off by default, saved through `PUT /brenda/mac-permission` at
 * once (the switch shows its new state while it saves; an error puts it back with the card's error line). Disabled while
 * someone else is signed in as the person and before migration 0060. With it, "See your jobs" (the private Jobs list).
 * Switches stay white (the accent rules).
 */
export function CheckEveryRow({ orgSlug, name, initial, impersonated }: { orgSlug: string; name: string; initial: { ready: boolean; checkEveryTask: boolean }; impersonated: boolean }) {
  const id = useId();
  const [on, setOn] = useState(initial.checkEveryTask);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const disabled = !initial.ready || impersonated || state === "saving";
  const save = async (next: boolean) => {
    setOn(next);
    setState("saving");
    try {
      const r = await api<{ checkEveryTask: boolean }>(`/api/orgs/${orgSlug}/brenda/mac-permission`, { method: "PUT", body: { checkEveryTask: next } });
      setOn(r.checkEveryTask === true);
      setState("saved");
    } catch {
      setOn(!next);
      setState("error");
    }
  };
  const W2 = MAC_HELP_WORDS.checkEvery;
  return (
    <SettingsRow label={W2.label} htmlFor={`${id}-every`} hint={!initial.ready ? W2.notReady : W2.hint(name)}>
      <div className="grid justify-items-start gap-2 sm:justify-items-end">
        <Switch id={`${id}-every`} checked={on} disabled={disabled} aria-describedby={`${id}-every-status`} onChange={(e) => { void save(e.currentTarget.checked); }} />
        <p id={`${id}-every-status`} role="status" aria-live="polite" className={state === "saved" || state === "error" ? cn("text-meta font-normal", state === "error" ? "text-danger" : "text-secondary") : "sr-only"}>
          {state === "saved" ? W2.saved : state === "error" ? W2.failed : ""}
        </p>
        <Link href={`/app/${orgSlug}/home/jobs`} className="link-inline text-meta">{MAC_HELP_WORDS.seeJobs}</Link>
      </div>
    </SettingsRow>
  );
}

/**
 * The person's card, "{name} on your Mac" (phase 3, owner report and request, 12 October 2026; contract A.5, L.2, M.9).
 * `workspace`: the workspace's state as any member reads it (to say when it is switched off or still in notice). `name`:
 * the person's own assistant ("Max"). `now`: the server's clock at render, so "Checked …" reads the same on both sides.
 * Each Mac shows what is on there as Brenda for Mac last reported it, for the person alone; "Set up on my Mac" asks their
 * Macs to open the setup card (nothing turns on until they press on the Mac); "Turn off on all my Macs…" confirms first.
 * No orange: the accent rules give this card none (the white primary is Set up; Turn off is the quiet danger outline).
 */
export function ScreenHelpMySettings({ orgSlug, name, initial, workspace, impersonated, timeZone, now: renderedAt, macPermission }: {
  orgSlug: string; name: string; initial: ScreenHelpMine; workspace: Pick<ScreenHelpView, "allowed" | "reason" | "availableFrom" | "ready" | "actionsAllowed" | "actReady">; impersonated: boolean; timeZone: string;
  /** The server's clock at render (ms); the client's when left out. */
  now?: number;
  /** Brenda and her helpers (contract N.2): the person's "Check with me before every task"; left out by an older page. */
  macPermission?: { ready: boolean; checkEveryTask: boolean } | null;
}) {
  const id = useId();
  const url = `/api/orgs/${orgSlug}/screen-help/me`;
  const [first] = useState(() => renderedAt ?? Date.now());
  // A setup pressed in the last five minutes (this tab or another) carries on being followed after a reload.
  const resumeFrom = (m: ScreenHelpMine, at: number) => {
    const t = m.setupAt ? new Date(m.setupAt).getTime() : NaN;
    return Number.isFinite(t) && at - t >= 0 && at - t < SETUP_POLL_FOR_MS ? t : null;
  };
  const [mine, setMine] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [clock, setClock] = useState(first);
  const [pressedAt, setPressedAt] = useState<number | null>(() => resumeFrom(initial, first));
  const [openSeen, setOpenSeen] = useState<{ device: string; reportedAt: string } | null>(null);
  const [asking, setAsking] = useState(false);
  if (seen !== initial) { setSeen(initial); setMine(initial); }
  const { save, run, setSave } = useSaver();
  const [done, setDone] = useState<string | null>(null);
  const locked = !mine.ready || impersonated;

  const notice = workspace.ready && workspace.allowed && workspace.reason === "notice" && workspace.availableFrom;
  const workspaceOff = workspace.ready && !workspace.allowed;
  const status = setupStatus(mine, pressedAt, clock, openSeen);
  const polling = setupPolling(status, pressedAt, clock);

  // Follow the setup on the Mac (contract L.2): ask Boredroom every 5 s while it is waiting, open or late, for at most
  // five minutes from the press, stopping once it is done or the card goes. Only the Macs and the setup time are taken
  // from each answer, so a never-look edit on its way is never undone by a poll.
  useEffect(() => {
    if (!polling || pressedAt === null) return;
    let gone = false;
    const timer = setInterval(() => {
      void api<ScreenHelpMine>(url, { retries: 0 }).then((r) => {
        if (gone || !r || typeof r !== "object" || !("macs" in r)) return;
        const at = Date.now();
        setMine((m) => ({ ...m, macReady: r.macReady, macs: r.macs, linked: r.linked, setupAt: r.setupAt, offAt: r.offAt }));
        setClock(at);
        setOpenSeen((o) => {
          if (o) return o;
          const s = setupStatus(r, pressedAt, at, null);
          return s.kind === "open" ? { device: s.device, reportedAt: s.reportedAt } : null;
        });
      }, () => { if (!gone) setClock(Date.now()); });
    }, SETUP_POLL_MS);
    return () => { gone = true; clearInterval(timer); };
  }, [polling, pressedAt, url]);

  // "Checked 2 minutes ago" moves on by itself while the page stays open.
  useEffect(() => {
    if (polling) return;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [polling]);

  const put = (body: { neverLook?: AppRule[] }, optimistic: Partial<ScreenHelpMine>, doneWords: string | null) => {
    const before = mine;
    setMine((m) => ({ ...m, ...optimistic }));
    setDone(null);
    void run(async () => {
      try {
        const r = await api<ScreenHelpMine>(url, { method: "PUT", body, retries: 0 });
        if (r && typeof r === "object" && "neverLook" in r) setMine((m) => ({ ...m, ...r }));
        setDone(doneWords);
      } catch (err) { setMine(before); throw err; }
    });
  };

  /** "Set up on my Mac": records the press (PUT {setup: true}); each Mac opens its setup card at its next poll. */
  const setUp = async () => {
    setAsking(true);
    setDone(null);
    setSave({ state: "idle" });
    try {
      let r = await api<ScreenHelpMine>(url, { method: "PUT", body: { setup: true }, retries: 0 });
      if (!r || typeof r !== "object" || !("setupAt" in r) || !r.setupAt) r = await api<ScreenHelpMine>(url, { retries: 0 });
      const at = Date.now();
      setMine((m) => ({ ...m, ...r }));
      setOpenSeen(null);
      setPressedAt(at);
      setClock(at);
    } catch (err) {
      setSave({ state: "error", message: failure(err) });
    } finally {
      setAsking(false);
    }
  };

  /** "Turn off on all my Macs…", after its confirm: a failure stays in the dialog with the server's words. */
  const turnOff = async () => {
    const r = await api<ScreenHelpMine>(url, { method: "PUT", body: { off: true }, retries: 0 });
    setMine((m) => (r && typeof r === "object" && "neverLook" in r ? { ...m, ...r } : { ...m, offAt: new Date().toISOString(), setupAt: null }));
    setPressedAt(null);
    setOpenSeen(null);
    setDone(W.personal.turnedOff);
    setSave({ state: "saved" });
  };

  const statusWords = setupWords(status, name, newestBinary(mine));
  // Review, 12 October 2026: Turn off is not offered when every Mac reports nothing on (there is nothing to turn off).
  const offShown = !nothingToTurnOff(mine);
  const canSetUp = !locked && mine.macReady && !workspaceOff && !notice;
  return (
    <SettingsSection id="screen-help-mine" target="settings-screen-help-mine" title={MAC_HELP_WORDS.title(name)} description={MAC_HELP_WORDS.description(name)}>
      <SettingsGroup>
        {!mine.ready ? <SettingsAlert tone="info">{W.owner.notReady}</SettingsAlert>
          : impersonated ? <SettingsAlert tone="info">{W.errors.personalImpersonated}</SettingsAlert>
          : workspaceOff ? <SettingsAlert tone="info">{W.personal.switchedOff}</SettingsAlert>
          : notice ? <SettingsAlert tone="info">{W.personal.notice(longDate(workspace.availableFrom!, timeZone))}</SettingsAlert>
          : workspace.actReady && !workspace.actionsAllowed ? <SettingsAlert tone="info">{ACTIONS_WORDS.switchedOff}</SettingsAlert>
          : null}
        {/* Before 0059 (review, 12 October 2026): how to set it up on the Mac comes first, in the words of today's Brenda
            for Mac, then what it can do; never a bare list under "Your Macs" above a lone Turn off. */}
        {mine.ready && !mine.macReady && !impersonated ? (
          <SettingsRow label={MAC_HELP_WORDS.setup.label} stacked>
            <p className="text-sm font-normal text-foreground">{MAC_HELP_WORDS.howTo(name, null)}</p>
          </SettingsRow>
        ) : null}
        {/* Each Mac as it last reported (contract 0b.2: for the person alone), or the ability names while there is none. */}
        <SettingsRow label={!mine.macReady || impersonated ? MAC_HELP_WORDS.abilitiesLabel : MAC_HELP_WORDS.macsLabel} stacked>
          {!mine.macReady || impersonated ? (
            <div className="grid gap-3">
              <AbilityList name={name} />
              {!mine.macReady && mine.ready ? <p className="text-meta font-normal text-secondary">{MAC_HELP_WORDS.notReady}</p> : null}
            </div>
          ) : mine.macs.length || mine.linked.length ? (
            <ul className="grid gap-3" aria-label={MAC_HELP_WORDS.macsLabel}>
              {mine.macs.map((m) => <MacCard key={`r:${m.device}:${m.reportedAt}`} report={m} name={name} now={clock} timeZone={timeZone} />)}
              {mine.linked.map((l, i) => (
                <li key={`l:${l.device}:${i}`} className="rounded-xl border border-border px-3 py-2.5">
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">{l.device}</p>
                  <p className="mt-0.5 text-meta font-normal text-secondary">{MAC_HELP_WORDS.linkedNoReport}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm font-normal text-secondary">{MAC_HELP_WORDS.none}</p>}
        </SettingsRow>
        {mine.macReady ? (
          <SettingsRow label={MAC_HELP_WORDS.setup.label} labelId={`${id}-setup`} hint={MAC_HELP_WORDS.setup.hint}>
            <div className="grid justify-items-start gap-2">
              <Button size="sm" variant="primary" disabled={!canSetUp} loading={asking} aria-describedby={`${id}-setup-hint ${id}-setup-status`} onClick={() => void setUp()}>
                {asking ? MAC_HELP_WORDS.setup.pending : MAC_HELP_WORDS.setup.button}
              </Button>
              <p id={`${id}-setup-status`} role="status" aria-live="polite" className={statusWords ? "flex min-w-0 items-start gap-1.5 text-meta font-normal text-secondary" : "sr-only"}>
                {status.kind === "done" ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : null}
                <span className="min-w-0">{statusWords}</span>
              </p>
            </div>
          </SettingsRow>
        ) : null}
        {macPermission ? <CheckEveryRow orgSlug={orgSlug} name={name} initial={macPermission} impersonated={impersonated} /> : null}
        <SettingsRow label={W.personal.listTitle(name)} stacked>
          <AppList label={W.personal.listTitle(name)} rules={mine.neverLook} disabled={locked} onChange={(next) => { if (!sameRules(next, mine.neverLook)) put({ neverLook: next }, { neverLook: next }, null); }} />
        </SettingsRow>
        {offShown ? (
          <SettingsRow label={MAC_HELP_WORDS.off.label} labelId={`${id}-off`} hint={MAC_HELP_WORDS.off.hint}>
            <ConfirmButton variant="danger" size="sm" tone="danger" disabled={locked} aria-describedby={`${id}-off-hint`}
              title={MAC_HELP_WORDS.off.title} description={MAC_HELP_WORDS.off.description(name)}
              confirmLabel={MAC_HELP_WORDS.off.confirm} pendingLabel={MAC_HELP_WORDS.off.pending} onConfirm={turnOff}>
              {MAC_HELP_WORDS.off.button}
            </ConfirmButton>
          </SettingsRow>
        ) : null}
        <div className="px-5 py-4">
          <p className="text-meta font-normal text-secondary">{MAC_HELP_WORDS.privacy}</p>
        </div>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        <SaveFooter save={save} done={done} />
      </SettingsGroup>
    </SettingsSection>
  );
}
