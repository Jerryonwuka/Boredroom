"use client";

/**
 * Brenda's pieces outside the chat (owner decision, 3 October 2026):
 * - BrendaPresence: the first sign of work today (the app open and touched) tells the server, which clocks the person
 *   in when the organisation and the person allow it, and says so in a toast.
 * - BrendaOrgSettings: what the organisation allows (owners and HR), with the action log.
 * - BrendaMyPrefs: the person's own switches, with their own action log.
 *
 * v4 (6 October 2026): the toast is the v4 toast surface (components/ui/toast.tsx) signed with her face; the action
 * logs are calm rows separated by space, never lines, with a 24px status disc; their labels are 14/20 medium in the
 * secondary grey, not tracked capitals.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, ShieldCheck, AlarmClock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { BrendaFace } from "@/components/app/brenda-face";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

const DAY_KEY = (orgSlug: string) => `brenda-presence:${orgSlug}:${new Date().toISOString().slice(0, 10)}`;

/** Reports the first interaction of the day once per browser per workspace. Nothing happens if Brenda may not clock in. */
export function BrendaPresence({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  useEffect(() => {
    let done = false;
    try { if (localStorage.getItem(DAY_KEY(orgSlug))) return; } catch { /* storage blocked: try anyway */ }
    const fire = async () => {
      if (done || document.visibilityState !== "visible") return;
      done = true; cleanup();
      try { localStorage.setItem(DAY_KEY(orgSlug), "1"); } catch { /* ignore */ }
      try {
        const r = await api<{ clockedIn: boolean; at?: string; late?: boolean }>(`/api/orgs/${orgSlug}/brenda/presence`, { method: "POST", retries: 0 });
        if (!r.clockedIn) return;
        // The v4 toast (ToastCard's surface and type), signed with her face where ToastCard has its status dot: Brenda
        // never shows a generic AI icon (owner decision, 5 October 2026).
        toast.custom(() => (
          <div role="status" className="toast-surface flex w-[340px] max-w-[calc(100vw-2rem)] items-start gap-3 px-4 py-3">
            <BrendaFace size="sm" mood="happy" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Looks like you&apos;ve started work. I&apos;ve clocked you in.</p>
              <p className="mt-0.5 text-sm font-normal text-[var(--toast-description)]">Brenda{r.late ? ", recorded as late" : ""}. You can switch this off on your profile.</p>
            </div>
          </div>
        ), { duration: 7000 });
        router.refresh();
      } catch { /* not allowed or offline: nothing to show */ }
    };
    const events = ["pointerdown", "keydown"] as const;
    const cleanup = () => events.forEach((e) => window.removeEventListener(e, fire));
    events.forEach((e) => window.addEventListener(e, fire, { passive: true }));
    return cleanup;
  }, [orgSlug, router]);
  return null;
}

type Action = { id: string; tool: string; summary: string; outcome: string; source: string; created_at: string; display_name: string };
type Overview = { settings: { autoClockIn: boolean; reminders: boolean }; prefs: { autoClockIn: boolean; reminders: boolean }; actions: Action[] };

function ActionLog({ actions, showWho }: { actions: Action[]; showWho: boolean }) {
  if (!actions.length) return <p className="py-2 text-sm font-normal text-secondary">Nothing yet. Every action Brenda takes is listed here.</p>;
  return (
    <ul className="space-y-1">
      {actions.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-2 text-sm">
          <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${a.outcome === "refused" || a.outcome === "failed" ? "bg-danger/12 text-danger" : a.source === "automatic" ? "bg-fill-1 text-secondary" : "bg-success/12 text-success"}`}>
            {a.outcome === "refused" || a.outcome === "failed" ? <X className="size-3.5" aria-hidden /> : a.source === "automatic" ? <AlarmClock className="size-3.5" aria-hidden /> : a.outcome === "confirmed" ? <ShieldCheck className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{a.summary}</span>
            <span className="block text-meta font-normal text-secondary">{showWho ? `For ${a.display_name}, ` : ""}{formatDateTime(a.created_at)}, {a.source === "automatic" ? "automatic" : a.outcome === "confirmed" ? "confirmed by them" : a.outcome}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Settings card for owners and HR: what Brenda may do in this workspace, and everything she did. */
export function BrendaOrgSettings({ orgSlug, initial, canEdit }: { orgSlug: string; initial: Overview; canEdit: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(initial.settings);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<typeof s>) => {
    const prev = s; setS({ ...s, ...patch }); setError(null);
    try { setS(await api(`/api/orgs/${orgSlug}/brenda/settings`, { method: "PATCH", body: patch, retries: 0 })); router.refresh(); }
    catch (err) { setS(prev); setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  };
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Switch checked={s.autoClockIn} disabled={!canEdit} onChange={(e) => void save({ autoClockIn: e.target.checked })} hint="When staff and team leads open Boredroom on a working day, Brenda clocks them in and tells them. Each person can switch it off for themselves. Recorded as clocked in by Brenda.">
          <span className="flex items-center gap-2">Automatic clock-in <Badge tone={s.autoClockIn ? "success" : "neutral"}>{s.autoClockIn ? "on" : "off"}</Badge></span>
        </Switch>
        <Switch checked={s.reminders} disabled={!canEdit} onChange={(e) => void save({ reminders: e.target.checked })} hint="Daily nudges from real data: tasks due tomorrow, work waiting for review since yesterday, assignments nobody picked up, a started task without its timer. Personal reminders people set always go out.">
          <span className="flex items-center gap-2">Reminders <Badge tone={s.reminders ? "success" : "neutral"}>{s.reminders ? "on" : "off"}</Badge></span>
        </Switch>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium text-secondary">What Brenda did</h3>
        <ActionLog actions={initial.actions} showWho />
      </div>
    </div>
  );
}

/** Profile card: the person's own switches and their own action log. */
export function BrendaMyPrefs({ orgSlug, initial, worker }: { orgSlug: string; initial: Overview; worker: boolean }) {
  const router = useRouter();
  const [p, setP] = useState(initial.prefs);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<typeof p>) => {
    const prev = p; setP({ ...p, ...patch }); setError(null);
    try { setP(await api(`/api/orgs/${orgSlug}/brenda/prefs`, { method: "PATCH", body: patch, retries: 0 })); router.refresh(); }
    catch (err) { setP(prev); setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
  };
  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        {worker ? <Switch checked={p.autoClockIn} disabled={!initial.settings.autoClockIn} onChange={(e) => void save({ autoClockIn: e.target.checked })} hint={initial.settings.autoClockIn ? "Brenda clocks you in when you start work on a working day." : "Your organisation has not switched automatic clock-in on."}>Let Brenda clock me in</Switch> : null}
        <Switch checked={p.reminders} disabled={!initial.settings.reminders} onChange={(e) => void save({ reminders: e.target.checked })} hint={initial.settings.reminders ? "Daily nudges about deadlines, reviews and follow-ups." : "Your organisation has switched Brenda's daily reminders off."}>Daily reminders from Brenda</Switch>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium text-secondary">What Brenda did for you</h3>
        <ActionLog actions={initial.actions.slice(0, 10)} showWho={false} />
      </div>
    </div>
  );
}
