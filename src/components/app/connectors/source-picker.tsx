"use client";

/**
 * Choose what Boredroom reads from a workspace connection (owner decisions, 22 October 2026: connectors; spec §11.1): a
 * checkbox per team, project, repository or page root (orange when checked), and per checked one who sees its items in
 * Boredroom (everyone, or one team). Saved with Save; unselected sources' copies are deleted by the server.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/switch";
import { Select } from "@/components/ui/input";
import { Alert, Skeleton } from "@/components/ui/states";
import { SettingsFooter } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import type { SourceView } from "@/lib/connectors/types";

const W = CONNECTOR_WORDS.sources;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

export function SourcePicker({ orgSlug, connectionId, app, teams, kinds, onChanged, name = "Brenda", note }: {
  orgSlug: string; connectionId: string; app: string; teams: { id: string; name: string }[]; kinds?: SourceView["kind"][]; onChanged?: () => void;
  /** The workspace's assistant name. */ name?: string;
  /** A line under the list (Slack: how a channel gets here; fix, 22 October 2026). */ note?: string;
}) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceView[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "refresh" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const base = `/api/orgs/${orgSlug}/connectors/connections/${connectionId}/sources`;
  const take = (list: SourceView[]) => {
    const shown = list.filter((s) => !s.archived && (!kinds || kinds.includes(s.kind)));
    setSources(shown);
    setChosen(Object.fromEntries(shown.filter((s) => s.selected).map((s) => [s.id, s.audienceTeamId])));
  };
  useEffect(() => {
    let alive = true;
    api<{ sources: SourceView[] }>(base).then((r) => { if (alive) take(r.sources); }, (err) => { if (alive) setError(isApiFailure(err) ? err.error.message : OFFLINE); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  async function refresh() {
    setBusy("refresh"); setError(null);
    try { take((await api<{ sources: SourceView[] }>(`${base}?refresh=1`)).sources); onChanged?.(); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); }
    finally { setBusy(null); }
  }
  async function save() {
    setBusy("save"); setError(null); setDone(null);
    try {
      const r = await api<{ sources: SourceView[] }>(base, { method: "PUT", body: { selected: Object.entries(chosen).map(([id, audienceTeamId]) => ({ id, audienceTeamId })) } });
      // The channel picker below reads the selected channels again (integration fix, 22 October 2026).
      take(r.sources); setDone("Saved."); onChanged?.(); router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); }
    finally { setBusy(null); }
  }
  return (
    <div>
      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-foreground">{kinds?.includes("channel") ? CONNECTOR_WORDS.routes.channel : W.title}</p>
        <p className="mt-0.5 text-meta font-normal text-secondary">{kinds?.includes("channel") ? W.channelHint(app) : W.hint(app, name)}</p>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </div>
      <div className="px-5 py-3">
        {sources === null ? <Skeleton className="h-16 w-full" /> : sources.length === 0 ? <p className="text-sm font-normal text-secondary">{W.none}</p> : (
          <ul className="space-y-2">
            {sources.map((s) => {
              const on = Object.hasOwn(chosen, s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <Checkbox checked={on} onChange={(e) => {
                    const next = { ...chosen };
                    if (e.currentTarget.checked) next[s.id] = null; else delete next[s.id];
                    setChosen(next);
                  }}>{s.label}{s.members !== null ? <span className="text-secondary">, {s.members} {s.members === 1 ? "person" : "people"}</span> : null}</Checkbox>
                  {on && s.kind !== "channel" ? (
                    <Select fieldSize="sm" aria-label={`${W.audience}: ${s.label}`} value={chosen[s.id] ?? ""} onChange={(e) => setChosen({ ...chosen, [s.id]: e.currentTarget.value || null })} className="w-48">
                      <option value="">{W.everyone}</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {note ? <p className="mt-2 text-meta font-normal text-secondary">{note}</p> : null}
      </div>
      <SettingsFooter status={done}>
        <Button variant="ghost" size="sm" loading={busy === "refresh"} onClick={refresh}>{W.refresh}</Button>
        <Button variant="secondary" size="sm" loading={busy === "save"} onClick={save} disabled={sources === null}>{W.save}</Button>
      </SettingsFooter>
    </div>
  );
}
