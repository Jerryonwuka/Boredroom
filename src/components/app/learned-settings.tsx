"use client";

/**
 * "What Brenda has learned" (owner decision, 28 October 2026: "I want her to learn from the person's usage and
 * interaction with her and interact with the person based on that"), in Settings › Your assistant right after "How I
 * like things done": the switch "Learn from how I use {name}" (on by default, with one plain line on what it uses and
 * that only they see it), then the habits the person's assistant learned (each sentence with when it was last seen, and
 * Delete behind a centred confirm), and "Forget everything" (a ConfirmButton). Only the person sees it: owners, HR and
 * leads never do. While someone else is signed in as the person the list is hidden; before migration 0067 the card says
 * it is coming and nothing can change.
 *
 * No orange: the switch is the design system's (white), Delete is a ghost icon button and "Forget everything" a ghost
 * danger confirm; fits 400px (the footer wraps).
 */
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsAlert, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { LEARNING_WORDS as W, type LearnedHabit, type LearnedList } from "@/lib/learning";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const FAILED = "Something went wrong. Nothing was changed; try again.";
const told = (err: unknown) => (!isApiFailure(err) ? OFFLINE : err.error.status < 500 || err.error.code === "NOT_READY" ? err.error.message : FAILED);

/** "27 Oct" (or "27 Oct 2025" in another year), in the workspace's time zone. */
function seenWords(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const sameYear = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone }).format(d) === new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone }).format(new Date());
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone }).format(d);
}

export function LearnedSettings({ orgSlug, name, timeZone, initial }: {
  orgSlug: string; /** The person's own assistant ("Max"). */ name: string; timeZone: string;
  /** The list as the page read it; null when it could not, and the card reads it itself. */ initial: LearnedList | null;
}) {
  const [list, setList] = useState<LearnedList | null>(initial);
  const [seen, setSeen] = useState(initial);
  if (initial && initial !== seen) { setSeen(initial); setList(initial); }
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState("");
  const url = `/api/orgs/${orgSlug}/brenda/learned`;

  const load = useCallback(() => api<LearnedList>(url).then((l) => { setList(l); setLoadError(null); }, (err: unknown) => setLoadError(told(err))), [url]);
  const brought = !!initial;
  useEffect(() => { if (!brought) void load(); }, [brought, load]);

  const items = list?.items ?? [];
  const ready = list?.ready ?? false;
  const hidden = list?.hidden ?? false;
  const enabled = list?.enabled ?? true;

  async function toggle(on: boolean) {
    if (!ready || hidden || saving) return;
    setSaving(true); setSwitchError(null);
    try {
      const l = await api<LearnedList>(url, { method: "PATCH", body: { enabled: on } });
      setList(l); setSaid(on ? W.savedOn : W.savedOff); successToast(on ? W.savedOn : W.savedOff);
    } catch (err) { setSwitchError(told(err)); }
    finally { setSaving(false); }
  }

  async function remove(h: LearnedHabit) {
    await api(`${url}/${h.id}`, { method: "DELETE" }); // a refusal stays in the dialog, with why
    setList((cur) => (cur ? { ...cur, items: cur.items.filter((x) => x.id !== h.id) } : cur));
    setSaid(W.deleted);
  }

  async function forgetAll() {
    const l = await api<LearnedList>(url, { method: "DELETE" });
    setList(l); setSaid(W.forgotten); successToast(W.forgotten);
  }

  return (
    <SettingsSection id="learned" title={W.section(name)} description={W.description(name)}>
      <SettingsGroup aria-busy={!list && !loadError}>
        {loadError ? (
          <SettingsAlert>
            <span className="flex flex-wrap items-center justify-between gap-2">{loadError}<Button size="xs" variant="secondary" onClick={() => { setLoadError(null); void load(); }}>Try again</Button></span>
          </SettingsAlert>
        ) : !list ? (
          <div className="space-y-2 px-5 py-4" role="status" aria-label="Getting what was learned"><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="h-4 w-48" /></div>
        ) : !ready ? (
          <SettingsAlert tone="info">{W.coming(name)}</SettingsAlert>
        ) : hidden ? (
          <p className="px-5 py-4 text-sm font-normal text-secondary">{W.hidden}</p>
        ) : (
          <>
            <div className="border-b border-border px-5 py-2">
              <Switch checked={enabled} disabled={saving} hint={W.switchHint(name)} aria-describedby={switchError ? "learned-switch-error" : undefined}
                onChange={(e) => void toggle(e.target.checked)}>
                {W.switchLabel(name)}
              </Switch>
              {switchError ? <p id="learned-switch-error" role="alert" className="pb-2 text-meta font-medium text-danger">{switchError}</p> : null}
            </div>
            {items.length ? (
              <ul className="divide-y divide-border">
                {items.map((h) => {
                  const short = h.body.length > 60 ? `${h.body.slice(0, 59).trimEnd()}…` : h.body;
                  return (
                    <li key={h.id} className="flex min-h-12 items-start gap-2 px-5 py-3">
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="break-words text-sm font-normal text-foreground">{h.body}</p>
                        <p className="text-meta font-normal text-secondary">{W.lastSeen(seenWords(h.lastSeen, timeZone))}</p>
                      </div>
                      <ConfirmButton title={W.deleteTitle(short)} description={W.deleteBody(name)} confirmLabel={W.delete} pendingLabel="Deleting…" onConfirm={() => remove(h)}
                        variant="ghost" size="icon-sm" aria-label={W.deleteLabel(short)} className="text-secondary hover:text-foreground">
                        <Trash2 aria-hidden />
                      </ConfirmButton>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="px-5 py-4 text-sm font-normal text-secondary">{enabled ? W.empty(name) : W.off(name)}</p>}
            {items.length && !enabled ? <p className="px-5 py-3 text-meta font-normal text-secondary">{W.off(name)}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-[15px] bg-fill-0 px-5 py-3">
              <span className="text-meta font-normal tabular-nums text-secondary">{W.count(items.length)}</span>
              <ConfirmButton title={W.forgetTitle(name)} description={W.forgetBody(name)} confirmLabel={W.forgetConfirm} pendingLabel="Forgetting…" onConfirm={forgetAll}
                variant="ghost" size="sm">
                {W.forgetAll}
              </ConfirmButton>
            </div>
          </>
        )}
      </SettingsGroup>
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </SettingsSection>
  );
}
